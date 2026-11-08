"""Public-source searches and content-addressed receipts. No case text in requests."""
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree


def endpoint(base, params):
    return base + "?" + urlencode(params)


def fetch(url):
    req = Request(url, headers={"User-Agent":"BioHacks-ALS-Research/1.0","Accept":"*/*"})
    for attempt in range(2):
        try:
            with urlopen(req, timeout=15) as response:
                return response.read(6_000_000)
        except HTTPError as exc:
            if attempt or exc.code not in (429,500,502,503,504):
                raise
        except OSError:
            if attempt:
                raise


def publication_records(body):
    hits = json.loads(body)["resultList"]["result"]
    return [{"id":h["id"],"title":html.unescape(re.sub("<[^>]+>","",h["title"])),
             "url":"https://pubmed.ncbi.nlm.nih.gov/"+h["id"]+"/"} for h in hits]


class Sources:
    def __init__(self, saved, refresh=False, replay_only=False):
        self.saved = saved
        self.refresh = refresh
        self.replay_only = replay_only

    def lookup(self, kind, url, parse):
        if not self.refresh:
            prior = self.saved.get(url)
            if prior:
                return dict(prior, access="cached")
            return {"kind":kind,"url":url,"status":"unavailable","reason":"No frozen receipt for this request"}
        try:
            body = fetch(url)
            records = parse(body)
            return dict(kind=kind, url=url, status="found" if records else "zero hits", records=records,
                        sha256=hashlib.sha256(body).hexdigest(),
                        fetched_at=datetime.now(timezone.utc).isoformat(),access="live")
        except HTTPError as exc:
            # openFDA explicitly uses 404 for searches with no matching documents.
            if kind == "label search" and exc.code == 404 and b"No matches found" in exc.read():
                return dict(kind=kind,url=url,status="zero hits",records=[],access="live")
            return dict(kind=kind,url=url,status="retrieval failed",reason=str(exc))
        except (OSError,ValueError,KeyError,ElementTree.ParseError) as exc:
            return dict(kind=kind,url=url,status="retrieval failed",reason=str(exc))

    def search(self, spec, active, extra_terms=()):
        epmc = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
        condition = "amyotrophic lateral sclerosis"
        topic = spec["literature"] if active else spec.get("unmapped_literature", condition+" safety tolerability")
        registry = spec["registry"] if active else "tolerability"
        field, term = spec["database"] if active else ("label",condition)
        receipts = []
        def literature(search):
            url = endpoint(epmc, {"query":'SRC:MED AND ('+search+') NOT PUB_TYPE:Review',
                                  "pageSize":5,"format":"json"})
            return self.lookup("primary literature search",url,publication_records)
        receipts.append(literature(topic))
        for term_query in extra_terms:
            receipts.append(literature(term_query))
        url = endpoint("https://clinicaltrials.gov/api/v2/studies",{"query.cond":condition,
                       "query.term":registry,"pageSize":5,"fields":"NCTId,BriefTitle,OverallStatus"})
        def trials(raw):
            results=[]
            for row in json.loads(raw)["studies"]:
                p=row["protocolSection"]
                i=p["identificationModule"]
                results.append(dict(id=i["nctId"],title=i["briefTitle"],status=p["statusModule"]["overallStatus"],
                                    url="https://clinicaltrials.gov/study/"+i["nctId"]))
            return results
        receipts.append(self.lookup("registry search",url,trials))
        if field == "target":
            url=endpoint("https://www.ebi.ac.uk/chembl/api/data/target.json",
                         {"target_components__accession":term,"limit":5})
            def targets(raw):
                return [dict(id=t["target_chembl_id"],title=t["pref_name"],
                             url="https://www.ebi.ac.uk/chembl/explore/target/"+t["target_chembl_id"])
                        for t in json.loads(raw)["targets"]]
            receipts.append(self.lookup("ChEMBL target search",url,targets))
        else:
            key="drug_interactions" if term=="CYP1A2 inhibitors" else "indications_and_usage"
            url=endpoint("https://api.fda.gov/drug/label.json",{"search":key+':"'+term+'"',"limit":3})
            def labels(raw):
                return [dict(id=t["set_id"],title=", ".join(t.get("openfda",{}).get("generic_name",[])),
                             url="https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid="+t["set_id"])
                        for t in json.loads(raw)["results"]]
            receipts.append(self.lookup("label search",url,labels))
        findings = []
        if not active:
            return receipts, findings
        papers = spec["papers"]
        url=endpoint(epmc,{"query":"SRC:MED AND ("+" OR ".join("EXT_ID:"+p for p in papers)+")",
                           "resultType":"core","format":"json","pageSize":len(papers)})
        def abstracts(raw):
            out = []
            for hit in json.loads(raw)["resultList"]["result"]:
                pmid=hit["id"]
                abstract = html.unescape(re.sub("<[^>]+>"," ",hit.get("abstractText","")))
                if pmid in papers:
                    marker=papers[pmid][0]
                    out.append(dict(id=pmid,title=hit["title"],marker=marker,
                                    matched=marker.casefold() in abstract.casefold(),
                                    url="https://pubmed.ncbi.nlm.nih.gov/"+pmid+"/"))
            return out
        receipt=self.lookup("reviewed primary records",url,abstracts)
        receipts.append(receipt)
        for hit in receipt.get("records",[]):
            pmid=hit["id"]
            if hit.get("matched") and hit["marker"]==papers[pmid][0]:
                findings.append(dict(id=pmid,role=papers[pmid][2],finding=papers[pmid][1],url=hit["url"]))
        if "label" in spec:
            item=spec["label"]; sid=item["id"]
            url="https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/"+sid+".xml"
            def spl(raw):
                content=" ".join(" ".join(ElementTree.fromstring(raw).itertext()).lower().split())
                return [dict(id=sid,matched=item["marker"].lower() in content,
                             url="https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid="+sid)]
            label=self.lookup("reviewed product label",url,spl)
            receipts.append(label)
            for hit in label.get("records",[]):
                if hit["matched"]:
                    findings.append(dict(id="label",role="support",finding=item["finding"],url=hit["url"]))
        if "trial" in spec:
            item=spec["trial"]; nid=item["id"]
            url="https://clinicaltrials.gov/api/v2/studies/"+nid
            def trial(raw):
                p=json.loads(raw)["protocolSection"]
                return [dict(id=p["identificationModule"]["nctId"],
                             outcomes=[x["measure"] for x in p["outcomesModule"]["primaryOutcomes"]],
                             url="https://clinicaltrials.gov/study/"+nid)]
            registry_receipt=self.lookup("reviewed trial protocol",url,trial)
            receipts.append(registry_receipt)
            for hit in registry_receipt.get("records",[]):
                if hit["id"]==nid and hit["outcomes"]:
                    findings.append(dict(id=nid,role=item["role"],finding=item["finding"],url=hit["url"]))
        return receipts, findings

    def target_annotation(self, accession):
        url="https://rest.uniprot.org/uniprotkb/"+accession+".json"
        def read_target(raw):
            record=json.loads(raw)
            return [dict(id=record["primaryAccession"], url=url, symbol=g["geneName"]["value"],
                    processes=[dict(id=x["id"],label=x["properties"][0]["value"][2:])
                               for x in record.get("uniProtKBCrossReferences",[])
                               if x["database"]=="GO" and x["properties"][0]["value"].startswith("P:")])
                    for g in record.get("genes",[]) if "geneName" in g]
        return self.lookup("target and process annotations",url,read_target)

    def corroborate(self, symbol, direction, pmids):
        """Look for the target and a pharmacologic action together in the cited primary record.
        Return evidence for the molecular *direction*. Clinical relevance is still hypothetical.
        """
        verbs={"increase_expression":r"upregulat|up-regulat|increas.{0,30}expression|induc.{0,24}expression",
               "reduce_expression":r"knockdown|knock.down|silenc|lower.{0,20}(mRNA|expression)",
               "inhibit":r"inhibit", "activate":r"activat", "agonize":r"(?<!ant)agonis",
               "antagonize":r"antagonis","block":r"block",
               "modulate":r"modulat|target|bind|regulat|restor|normali[sz]"}
        if not pmids or direction not in verbs:
            return None
        search="SRC:MED AND ("+" OR ".join("EXT_ID:"+pid for pid in sorted(pmids))+") AND TITLE_ABS:"+symbol
        url=endpoint("https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                     {"query":search,"resultType":"core","format":"json","pageSize":len(pmids)})
        def extract(raw):
            out=[]
            for h in json.loads(raw)["resultList"]["result"]:
                abstract=html.unescape(re.sub("<[^>]+>"," ",h.get("abstractText","")))
                for clause in re.split(r"(?<=[.!?])\s+",abstract):
                    if (re.search(r"\b"+re.escape(symbol)+r"\b",clause,re.I) and re.search(verbs[direction],clause,re.I)
                            and not re.search(r"\b(no|not|without|failed)\b",clause,re.I)):
                        out.append(dict(id=h["id"],title=h["title"],symbol=symbol,action=direction,
                            url="https://pubmed.ncbi.nlm.nih.gov/"+h["id"]+"/",
                            clause_sha256=hashlib.sha256(clause.encode()).hexdigest()))
                        break
            return out
        # The same paper can support different actions, which require separate receipts.
        saved_url=url+"#"+direction
        if not self.refresh:
            return self.saved.get(saved_url,{"kind":"direction check","url":saved_url,"status":"unavailable"})
        receipt=self.lookup("direction check",url,extract)
        return dict(receipt,url=saved_url)
