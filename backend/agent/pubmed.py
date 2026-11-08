"""PubMed lookups for the assessment report: search, and a formatted citation per PMID.

Shares mcp_server's throttled NCBI client (3 req/s, 10 with NCBI_API_KEY) and disk cache.
"""
import re

from agent.mcp_server import _ncbi, cached

PMID_URL = re.compile(r"(?:pubmed\.ncbi\.nlm\.nih\.gov/|ncbi\.nlm\.nih\.gov/pubmed/)(\d{5,9})")


def _citation(s: dict) -> str:
    """Vancouver-ish: 'Abrahao A, et al. Title. Nat Commun. 2019;10:4373.'"""
    names = [a["name"] for a in s.get("authors", []) if a.get("authtype") == "Author"]
    who = (names[0] + (", et al." if len(names) > 1 else ".")) if names else ""
    title = (s.get("title") or "").rstrip(".") + "."
    year = (s.get("pubdate") or "")[:4]
    vol = s.get("volume", "")
    pages = s.get("pages") or s.get("elocationid", "")
    where = f"{s.get('source', '')}. {year}" + (f";{vol}" if vol else "") + (f":{pages}" if pages else "") + "."
    return " ".join(p for p in (who, title, where) if p.strip("."))


@cached
def summaries(pmids: list[str]) -> dict[str, dict]:
    pmids = sorted({p for p in pmids if p.isdigit()})
    if not pmids:
        return {}
    res = _ncbi("esummary.fcgi", db="pubmed", id=",".join(pmids), retmode="json").json()["result"]
    return {p: {"pmid": p, "title": res[p].get("title", ""), "year": (res[p].get("pubdate") or "")[:4],
                "citation": _citation(res[p]), "url": f"https://pubmed.ncbi.nlm.nih.gov/{p}/"}
            for p in pmids if p in res and "error" not in res[p]}


@cached
def search(query: str, n: int = 5) -> list[dict]:
    """PubMed relevance search → [{pmid, title, year, citation, url}]."""
    ids = _ncbi("esearch.fcgi", db="pubmed", term=query, retmode="json", retmax=n, sort="relevance").json()["esearchresult"]["idlist"]
    found = summaries(ids)
    return [found[i] for i in ids if i in found]


def pmids_in_urls(urls: list[str]) -> list[str]:
    return list(dict.fromkeys(m.group(1) for u in urls for m in [PMID_URL.search(u)] if m))
