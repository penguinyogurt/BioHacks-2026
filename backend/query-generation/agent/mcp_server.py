"""Public literature, trial and Open Targets MCP tools from Neo's coordinator."""
import functools
import hashlib
import json
import os
from tempfile import NamedTemporaryFile
from pathlib import Path
import time

import httpx
from mcp.server.fastmcp import FastMCP

from agent.config import CACHE_DIR

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
        with NamedTemporaryFile(mode="w",encoding="utf-8",dir=CACHE_DIR,delete=False) as temp:
            json.dump(result,temp)
        Path(temp.name).replace(path)
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
    studies = _http.get("https://clinicaltrials.gov/api/v2/studies", params=params).raise_for_status().json().get("studies", [])
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
    p = _http.get(f"https://clinicaltrials.gov/api/v2/studies/{nct_id}").raise_for_status().json()["protocolSection"]
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


_TRACTABLE = {"Approved Drug", "Advanced Clinical", "Phase 1 Clinical", "Druggable Family", "High-Quality Pocket", "High-Quality Ligand"}


@mcp.tool()
@cached
def target_profile(gene_symbol: str) -> dict:
    """Biology of one gene/protein target: function, pathways, druggability by modality, known safety liabilities, and how strongly it's associated with ALS (overall and by evidence type)."""
    hits = _ot("""query($q:String!){ search(queryString:$q, entityNames:["target"], page:{index:0,size:1}){ hits { id } } }""", {"q": gene_symbol})["search"]["hits"]
    if not hits:
        return {"found": False, "gene": gene_symbol}
    tid = hits[0]["id"]
    q = """query($id:String!,$d:String!){
      target(ensemblId:$id){ approvedSymbol approvedName functionDescriptions
        pathways { pathway topLevelTerm } tractability { label modality value } safetyLiabilities { event } }
      disease(efoId:$d){ associatedTargets(Bs:[$id]){ rows { score datatypeScores { id score } } } } }"""
    data = _ot(q, {"id": tid, "d": ALS_EFO})
    t = data["target"]
    rows = data["disease"]["associatedTargets"]["rows"]
    modality = {"SM": "small molecule", "AB": "antibody", "PR": "PROTAC", "OC": "other modality"}
    return {
        "found": True,
        "ensembl_id": tid,
        "symbol": t["approvedSymbol"],
        "name": t["approvedName"],
        "function": _clip(" ".join(t.get("functionDescriptions") or []), 900),
        "pathways": sorted({f"{p['pathway'].strip()} ({p['topLevelTerm']})" for p in (t.get("pathways") or [])})[:12],
        "druggable_by": sorted({f"{modality.get(x['modality'], x['modality'])}: {x['label']}" for x in (t.get("tractability") or []) if x["value"] and x["label"] in _TRACTABLE}),
        "safety_liabilities": sorted({s["event"] for s in (t.get("safetyLiabilities") or []) if s.get("event")})[:12],
        "als_association": {"score": round(rows[0]["score"], 3), "by_evidence": {d["id"]: round(d["score"], 3) for d in rows[0]["datatypeScores"]}} if rows else None,
        "url": f"https://platform.opentargets.org/target/{tid}",
    }




if __name__ == "__main__":
    mcp.run()
