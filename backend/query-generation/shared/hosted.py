"""Evidence-checked mechanism hypotheses from Neo's actual tool-using research agent."""
import asyncio
import hashlib
import json
import re
from pathlib import Path
from tempfile import NamedTemporaryFile

from agent.config import SUBAGENT_MODEL
from agent.no_drugs import scrub_model
from agent.schemas import Brief
from agent.subagent import run_subagent


def persist(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with NamedTemporaryFile(mode="w",dir=path.parent,delete=False) as tmp:
        json.dump(value,tmp,indent=2)
    Path(tmp.name).replace(path)


def compact(result):
    """Retain tool provenance without redistributing abstracts and label text."""
    for event in result["events"]:
        raw=event.get("data",{}).pop("public_result",None)
        if raw is not None:
            event["data"]["content_sha256"]=hashlib.sha256(raw.encode()).hexdigest()
    return result


def live_research(brief, receipts, findings, cache_dir, replay_only=False):
    packet={"findings":findings,"sources":[{"kind":r["kind"],"status":r["status"],"records":r.get("records",[])}
                                           for r in receipts]}
    key = hashlib.sha256(json.dumps([SUBAGENT_MODEL,brief,packet],sort_keys=True).encode()).hexdigest()
    path = cache_dir/(key+".json")
    if path.exists():
        return dict(compact(json.loads(path.read_text())),access="replay")
    if replay_only:
        raise ValueError("Hosted research replay missing for "+brief["criterion"]+"; use a live run to populate it.")
    events=[]
    public = Brief(**{key:brief[key] for key in Brief.model_fields})
    answer = asyncio.run(run_subagent(public,events.append,packet))
    # A generated identifier alone is never verification. Match to previously
    # retrieved records or the successful public tool result from this worker.
    evidence_text = json.dumps(packet) + " ".join(
        e["data"]["public_result"] for e in events if e["type"]=="tool_result" and not e["data"]["error"])
    accepted, rejected = [], []
    for item in answer.profiles:
        evidence=[]
        for e in item.evidence:
            identifier=e.id.strip().rstrip("/").split("/")[-1]
            if e.source=="pubmed":
                identifier=identifier.removeprefix("PMID:").strip()
                valid=re.fullmatch(r"\d{4,9}",identifier)
                url=f"https://pubmed.ncbi.nlm.nih.gov/{identifier}/"
            elif e.source=="clinicaltrials":
                identifier=identifier.upper()
                valid=re.fullmatch(r"NCT\d{8}",identifier)
                url="https://clinicaltrials.gov/study/"+identifier
            else:
                valid=re.fullmatch(r"ENSG\d{11}|MONDO_\d+|EFO_\d+",identifier)
                entity="target" if identifier.startswith("ENSG") else "disease"
                url=f"https://platform.opentargets.org/{entity}/{identifier}"
            if valid and re.search(r"(?<!\w)"+re.escape(identifier)+r"(?!\w)",evidence_text,re.I):
                evidence.append(e.model_copy(update={"id":identifier,"url":url}))
            else:
                rejected.append(dict(id=e.id,reason="No matching retrieved public identifier"))
        if evidence:
            cleaned,_ = scrub_model(item.model_copy(update={"evidence":evidence}))
            accepted.append(cleaned.model_dump())
    result=dict(model=SUBAGENT_MODEL,profiles=accepted,dead_ends=answer.dead_ends,
                rejected=rejected,events=events,access="live",cache_key=key)
    result=compact(result)
    if accepted:
        persist(path,result)
    return result
