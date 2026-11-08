"""Targeted evidence checks: deterministic adjudications plus live source audit."""
import hashlib
import json
import re
from html import unescape
from urllib.parse import quote, urlparse, parse_qs
from urllib.request import urlopen, Request
from urllib.error import HTTPError


def epmc(query):
    return "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=3&query="+quote(query)


def read(url):
    request = Request(url, headers={"User-Agent": "BioHacks-research-retrieval/1.0"})
    for attempt in range(2):
        try:
            with urlopen(request, timeout=12) as response:
                return response.read(8_000_000)
        except HTTPError as error:
            if attempt or error.code not in (408, 500, 502, 503, 504):
                raise
        except OSError:
            if attempt:
                raise


def verify(url,term):
    parsed=urlparse(url)
    endpoint=url
    if parsed.hostname=="pubmed.ncbi.nlm.nih.gov":
        endpoint=epmc("SRC:MED AND EXT_ID:"+parsed.path.strip("/"))
    elif parsed.hostname=="dailymed.nlm.nih.gov" and "setid" in parse_qs(parsed.query):
        endpoint="https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/"+parse_qs(parsed.query)["setid"][0]+".xml"
    try:
        body=read(endpoint)
        if body.startswith(b"%PDF"):
            return dict(source=url,status="PDF retrieved; text verified in manual review only")
        text=unescape(re.sub("<[^>]*>"," ",body.decode("utf-8","replace"))).casefold()
        matched=term.casefold() in " ".join(text.split())
        return dict(source=url,endpoint=endpoint,status="source marker present" if matched else "marker not confirmed",
                    sha256=hashlib.sha256(body).hexdigest())
    except (OSError,ValueError) as error:
        return dict(source=url,endpoint=endpoint,status="retrieval failed",detail=str(error))


def search_literature(query, offline):
    endpoint = epmc(query)
    search = dict(query=query, endpoint=endpoint)
    if offline:
        return dict(search, status="offline: not searched")
    try:
        result = json.loads(read(endpoint))
        hits = [{"title": h.get("title"), "id": h.get("id"), "doi": h.get("doi")}
                for h in result["resultList"]["result"]]
        search.update(status="retrieved", hit_count=result["hitCount"], hits=hits)
    except (OSError, ValueError, KeyError) as error:
        search.update(status="retrieval failed", detail=str(error))
    return search


def reviewer(profile, catalog, offline, graph, medicines=None, labels=None):
    # Scope documentary adjudications to the exact chart used by the reviewer.
    records = catalog["records"] if profile == catalog["case"] else {}
    checked = {}
    medicines = medicines if medicines is not None else [profile["therapy"]]
    labels = labels or {}
    relation = "DRUGBANK::ddi-interactor-in::Compound:Compound"
    outgoing = {m: set(graph.walk(m, relation, True)) for m in medicines}
    incoming = {m: set(graph.walk(m, relation, False)) for m in medicines}

    def examine(node):
        data = records.get(node, {})
        name = data.get("name", labels.get(node, {}).get("name", node))
        refs = data.get("sources", [])
        checks = []
        for url, term in refs:
            key = (url, term)
            if key not in checked:
                checked[key] = (dict(source=url, status="offline: stored review only")
                                if offline else verify(url, term))
            checks.append(checked[key])
        edges = []
        for m in medicines:
            if node in outgoing[m]:
                edges.append([m, relation, node])
            if node in incoming[m]:
                edges.append([node, relation, m])
        drug_id = node.split("::")[-1]
        alias = data.get("search_name", name)
        compound = f'(TITLE_ABS:"{alias}" OR "{drug_id}")'
        searches = {}
        for med in medicines:
            med_name = labels.get(med, {}).get("name", med.split("::")[-1])
            searches[med_name] = search_literature(f'{compound} AND TITLE_ABS:"{med_name}"', offline)
        if profile == catalog["case"]:
            searches["case_conditions"] = search_literature(
                f'{compound} AND TITLE_ABS:"amyotrophic lateral sclerosis" AND '
                '(respiratory OR dysphagia OR weight OR weakness OR function)', offline)
        action = data.get("action", "unknown")
        return dict(
            name=name, action=action, matched_fact=profile["facts"].get(data.get("fact")),
            warning=data.get("warning", ""),
            medication_check=data.get("medication_check", "No adjudicated drug–therapy evidence."),
            ddi_edges=edges,
            ddi_interpretation=("Observed medication-pair interaction edge. Clinical significance requires independent verification."
                                if edges else "No medication-pair DDI edge in this release. Compatibility remains unknown."),
            contrary=data.get("contrary", "No candidate-specific outcome evidence adjudicated."),
            change=data.get("change", "A direct ALS study and route-specific interaction and safety evidence."),
            sources=[s[0] for s in refs], verification=checks, literature_searches=searches,
            safety="verified exclusion" if action == "veto" else "safety unresolved",
            review_status="targeted source review" if data else "unreviewed; no documentary adjudication")
    return examine
