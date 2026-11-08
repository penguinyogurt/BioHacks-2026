"""als-research MCP server: drug-, trial- and literature-level tools for sub-agents.

There is deliberately no patient tool here. Anything a sub-agent can reach
through this server is public or drug-level data. The pipeline tool strips
the patient-specific `filters[]` reasons before returning a candidate.

Run standalone:  python -m agent.mcp_server   (stdio)
"""
import functools
import hashlib
import json
import os
import time
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP

from agent.config import CACHE_DIR, PIPELINE_PATH

mcp = FastMCP("als-research")
_http = httpx.Client(timeout=25, headers={"User-Agent": "biohacks-als-research/0.1"}, follow_redirects=True)
ALS_EFO = "MONDO_0004976"  # Open Targets id for amyotrophic lateral sclerosis
NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
OT = "https://api.platform.opentargets.org/api/v4/graphql"


def cached(fn):
    """Disk cache keyed on (tool, args) so a warmed cache survives expo Wi-Fi."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        key = hashlib.sha1(json.dumps([fn.__name__, args, kwargs], sort_keys=True, default=str).encode()).hexdigest()
        path = CACHE_DIR / f"{fn.__name__}-{key[:16]}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        result = fn(*args, **kwargs)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result), encoding="utf-8")
        return result

    return wrapper


_ncbi_last = [0.0]


def _ncbi(endpoint: str, **params) -> httpx.Response:
    """NCBI allows 3 req/s without a key (10 with). Throttle, and back off on 429."""
    if os.getenv("NCBI_API_KEY"):
        params["api_key"] = os.environ["NCBI_API_KEY"]
    gap = 0.12 if "api_key" in params else 0.4
    for attempt in range(4):
        wait = _ncbi_last[0] + gap - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _ncbi_last[0] = time.monotonic()
        r = _http.get(f"{NCBI}/{endpoint}", params=params)
        if r.status_code != 429:
            r.raise_for_status()
            return r
        time.sleep(1.5 * (attempt + 1))
    r.raise_for_status()
    return r


def _ot(query: str, variables: dict) -> dict:
    r = _http.post(OT, json={"query": query, "variables": variables})
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(body["errors"][0]["message"])
    return body["data"]


def _clip(s: str | None, n: int) -> str | None:
    if not s:
        return None
    return s if len(s) <= n else s[:n] + " …"


# ── literature ──────────────────────────────────────────────────────────────
@mcp.tool()
@cached
def search_pubmed(query: str, max_results: int = 8) -> list[dict]:
    """Search PubMed. Returns PMID, title, journal, year, url. Add 'amyotrophic lateral sclerosis' to the query yourself if relevant."""
    ids = _ncbi("esearch.fcgi", db="pubmed", term=query, retmode="json", retmax=min(max_results, 20)).json()["esearchresult"]["idlist"]
    if not ids:
        return []
    summ = _ncbi("esummary.fcgi", db="pubmed", id=",".join(ids), retmode="json").json()["result"]
    return [
        {"pmid": i, "title": summ[i].get("title"), "journal": summ[i].get("source"), "year": (summ[i].get("pubdate") or "")[:4], "url": f"https://pubmed.ncbi.nlm.nih.gov/{i}/"}
        for i in ids
        if i in summ
    ]


@mcp.tool()
@cached
def fetch_pubmed_abstract(pmid: str) -> dict:
    """Fetch the abstract text for one PMID."""
    text = _ncbi("efetch.fcgi", db="pubmed", id=pmid, rettype="abstract", retmode="text").text
    return {"pmid": pmid, "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", "text": _clip(text.strip(), 4000)}


# ── trials ──────────────────────────────────────────────────────────────────
@mcp.tool()
@cached
def search_als_trials(intervention: str | None = None, status: str | None = None, max_results: int = 10) -> list[dict]:
    """Search ClinicalTrials.gov for ALS trials. status: RECRUITING, COMPLETED, TERMINATED, ACTIVE_NOT_RECRUITING, WITHDRAWN, or omit for all."""
    params = {
        "query.cond": "amyotrophic lateral sclerosis",
        "pageSize": min(max_results, 25),
        "fields": "NCTId,BriefTitle,OverallStatus,Phase,InterventionName,WhyStopped",
    }
    if intervention:
        params["query.intr"] = intervention
    if status:
        params["filter.overallStatus"] = status.upper()
    studies = _http.get("https://clinicaltrials.gov/api/v2/studies", params=params).json().get("studies", [])
    out = []
    for s in studies:
        p = s["protocolSection"]
        nct = p["identificationModule"]["nctId"]
        out.append({
            "nct_id": nct,
            "title": p["identificationModule"].get("briefTitle"),
            "status": p.get("statusModule", {}).get("overallStatus"),
            "why_stopped": p.get("statusModule", {}).get("whyStopped"),
            "phases": p.get("designModule", {}).get("phases", []),
            "interventions": [i["name"] for i in p.get("armsInterventionsModule", {}).get("interventions", [])],
            "url": f"https://clinicaltrials.gov/study/{nct}",
        })
    return out


@mcp.tool()
@cached
def get_trial(nct_id: str) -> dict:
    """Details for one trial: status, why stopped, phases, interventions, primary outcomes, eligibility criteria."""
    p = _http.get(f"https://clinicaltrials.gov/api/v2/studies/{nct_id}").json()["protocolSection"]
    return {
        "nct_id": nct_id,
        "title": p["identificationModule"].get("briefTitle"),
        "status": p.get("statusModule", {}).get("overallStatus"),
        "why_stopped": p.get("statusModule", {}).get("whyStopped"),
        "phases": p.get("designModule", {}).get("phases", []),
        "interventions": [i["name"] for i in p.get("armsInterventionsModule", {}).get("interventions", [])],
        "primary_outcomes": [o.get("measure") for o in p.get("outcomesModule", {}).get("primaryOutcomes", [])],
        "eligibility": _clip(p.get("eligibilityModule", {}).get("eligibilityCriteria"), 3000),
        "url": f"https://clinicaltrials.gov/study/{nct_id}",
    }


# ── drugs ───────────────────────────────────────────────────────────────────
@mcp.tool()
@cached
def chembl_drug(name: str) -> dict:
    """ChEMBL record for a drug name: ChEMBL id, max clinical phase, InChIKey, SMILES, mechanisms of action with targets."""
    mols = _http.get("https://www.ebi.ac.uk/chembl/api/data/molecule/search.json", params={"q": name, "limit": 1}).json().get("molecules", [])
    if not mols:
        return {"found": False, "name": name}
    m = mols[0]
    cid = m["molecule_chembl_id"]
    mechs = _http.get("https://www.ebi.ac.uk/chembl/api/data/mechanism.json", params={"molecule_chembl_id": cid}).json().get("mechanisms", [])
    struct = m.get("molecule_structures") or {}
    return {
        "found": True,
        "chembl_id": cid,
        "name": m.get("pref_name"),
        "max_phase": m.get("max_phase"),
        "inchikey": struct.get("standard_inchi_key"),
        "smiles": struct.get("canonical_smiles"),
        "black_box_warning": bool(m.get("black_box_warning")),
        "mechanisms": [{"mechanism": x.get("mechanism_of_action"), "action": x.get("action_type"), "target_chembl_id": x.get("target_chembl_id")} for x in mechs[:6]],
        "url": f"https://www.ebi.ac.uk/chembl/compound_report_card/{cid}/",
    }


@mcp.tool()
@cached
def pubchem_properties(name: str) -> dict:
    """PubChem physicochemical properties (MW, TPSA, XLogP, H-bond donors) and identifiers. Useful for BBB reasoning."""
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{quote(name)}/property/InChIKey,SMILES,MolecularWeight,TPSA,XLogP,HBondDonorCount/JSON"
    r = _http.get(url)
    if r.status_code != 200:
        return {"found": False, "name": name}
    p = r.json()["PropertyTable"]["Properties"][0]
    return {
        "found": True,
        "cid": p["CID"],
        "inchikey": p.get("InChIKey"),
        "smiles": p.get("SMILES") or p.get("CanonicalSMILES"),
        "mw": float(p.get("MolecularWeight", 0)),
        "tpsa": p.get("TPSA"),
        "xlogp": p.get("XLogP"),
        "hbd": p.get("HBondDonorCount"),
        "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{p['CID']}",
    }


@mcp.tool()
@cached
def fda_label(drug: str) -> dict:
    """US FDA label sections for a drug (openFDA): indications, boxed warning, contraindications, warnings, interactions, dosage forms."""
    r = _http.get("https://api.fda.gov/drug/label.json", params={"search": f'openfda.generic_name:"{drug}"', "limit": 1})
    if r.status_code != 200 or not r.json().get("results"):
        return {"found": False, "drug": drug}
    lab = r.json()["results"][0]

    def sec(k, n=1200):
        return _clip(" ".join(lab.get(k, [])), n)

    set_id = lab.get("set_id")
    return {
        "found": True,
        "set_id": set_id,
        "indications": sec("indications_and_usage"),
        "boxed_warning": sec("boxed_warning"),
        "contraindications": sec("contraindications", 800),
        "warnings": sec("warnings_and_cautions") or sec("warnings"),
        "drug_interactions": sec("drug_interactions"),
        "dosage_forms": sec("dosage_forms_and_strengths", 600),
        "url": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={set_id}",
    }


# ── Open Targets ────────────────────────────────────────────────────────────
@mcp.tool()
@cached
def opentargets_als_drugs(limit: int = 60) -> list[dict]:
    """Drugs and clinical candidates Open Targets links to ALS, with max clinical stage and mechanisms/targets."""
    q = """query($id:String!){ disease(efoId:$id){ drugAndClinicalCandidates { rows {
          maxClinicalStage drug { id name mechanismsOfAction { rows { mechanismOfAction targets { approvedSymbol } } } } } } } }"""
    rows = _ot(q, {"id": ALS_EFO})["disease"]["drugAndClinicalCandidates"]["rows"]
    out = []
    for row in rows[:limit]:
        d = row.get("drug") or {}
        moa = (d.get("mechanismsOfAction") or {}).get("rows", [])
        out.append({
            "chembl_id": d.get("id"),
            "name": d.get("name"),
            "max_stage": row.get("maxClinicalStage"),
            "mechanisms": sorted({m["mechanismOfAction"] for m in moa}),
            "targets": sorted({t["approvedSymbol"] for m in moa for t in m.get("targets", [])})[:8],
            "url": f"https://platform.opentargets.org/drug/{d.get('id')}",
        })
    return out


@mcp.tool()
@cached
def opentargets_als_targets(limit: int = 25) -> list[dict]:
    """Top genes/targets associated with ALS in Open Targets, with association score (0-1)."""
    q = """query($id:String!,$n:Int!){ disease(efoId:$id){ associatedTargets(page:{index:0,size:$n}){ rows { score target { id approvedSymbol approvedName } } } } }"""
    rows = _ot(q, {"id": ALS_EFO, "n": min(limit, 100)})["disease"]["associatedTargets"]["rows"]
    return [
        {"ensembl_id": r["target"]["id"], "symbol": r["target"]["approvedSymbol"], "name": r["target"]["approvedName"], "score": round(r["score"], 3), "url": f"https://platform.opentargets.org/target/{r['target']['id']}"}
        for r in rows
    ]


@mcp.tool()
@cached
def opentargets_target_drugs(gene_symbol: str) -> dict:
    """Drugs and clinical candidates acting on a gene target (any indication), with max clinical stage. Good for repurposing."""
    hits = _ot("""query($q:String!){ search(queryString:$q, entityNames:["target"], page:{index:0,size:1}){ hits { id name } } }""", {"q": gene_symbol})["search"]["hits"]
    if not hits:
        return {"found": False, "gene": gene_symbol}
    tid = hits[0]["id"]
    t = _ot("""query($id:String!){ target(ensemblId:$id){ approvedSymbol approvedName drugAndClinicalCandidates { rows { maxClinicalStage drug { id name } } } } }""", {"id": tid})["target"]
    rows = t["drugAndClinicalCandidates"]["rows"]
    return {
        "found": True,
        "ensembl_id": tid,
        "symbol": t["approvedSymbol"],
        "name": t["approvedName"],
        "drugs": [{"chembl_id": r["drug"]["id"], "name": r["drug"]["name"], "max_stage": r["maxClinicalStage"]} for r in rows[:40] if r.get("drug")],
        "url": f"https://platform.opentargets.org/target/{tid}",
    }


# ── our pipeline (drug-level only) ──────────────────────────────────────────
def _pipeline() -> dict:
    return json.loads(PIPELINE_PATH.read_text(encoding="utf-8"))


def _public_candidate(c: dict) -> dict:
    bbb = dict(c["bbb"])
    if not bbb.get("in_domain"):
        bbb["prob"] = None  # model can't stand behind it; same rule as the UI
    return {"name": c["name"], "inchikey": c["inchikey"], "kg": c["kg"], "path": c["path"], "bbb": bbb}


@mcp.tool()
def pipeline_drug(name_or_inchikey: str) -> dict:
    """Our own pipeline's drug-level data: knowledge-graph score/rank, KG path to ALS, BBB prediction, and ALS trial-graveyard entry if any."""
    key = name_or_inchikey.strip().lower()
    data = _pipeline()
    out: dict = {"in_pipeline": False}
    for c in data["candidates"]:
        if key in (c["name"].lower(), c["inchikey"].lower()):
            out = {"in_pipeline": True, **_public_candidate(c)}
            break
    for g in data.get("graveyard", []):
        if g["name"].lower() == key:
            out["graveyard"] = {k: g[k] for k in ("phase", "year", "bucket", "note", "source_url")}
    return out


@mcp.tool()
def pipeline_top_candidates(limit: int = 20) -> list[dict]:
    """Top drugs from our knowledge-graph ranking with BBB predictions (drug-level only)."""
    cands = sorted(_pipeline()["candidates"], key=lambda c: c["kg"]["rank"])
    return [_public_candidate(c) for c in cands[:limit]]


if __name__ == "__main__":
    mcp.run()
