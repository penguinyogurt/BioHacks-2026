"""Map researched claims to typed DRKG predictions, independent of candidate mentions."""
import re
import numpy as np

from shared.biology import PARTICIPATES, TREATS
from shared.query import query
from shared.terms import norm

# Relation labels describe actions. Binding cannot silently stand in for increasing
# expression. Both orientations here are the *stored* DRKG glossary orientations.
ACTIONS = {
    "treat": [(r,False) for r in TREATS],
    "increase_expression":[("GNBR::E+::Compound:Gene",False)],
    "reduce_expression":[("GNBR::E-::Compound:Gene",False)],
    "activate":[("DGIDB::ACTIVATOR::Gene:Compound",True),("GNBR::A+::Compound:Gene",False)],
    "agonize":[("DGIDB::AGONIST::Gene:Compound",True)],
    "antagonize":[("DGIDB::ANTAGONIST::Gene:Compound",True),("GNBR::A-::Compound:Gene",False)],
    "block":[("DGIDB::BLOCKER::Gene:Compound",True),("DGIDB::CHANNEL BLOCKER::Gene:Compound",True)],
    "inhibit":[("DGIDB::INHIBITOR::Gene:Compound",True),("GNBR::N::Compound:Gene",False)],
    # "modulate" claims no direction, so unsigned target/binding relations are an
    # exact match for it -- unlike standing in for a signed action above.
    "modulate":[("DGIDB::MODULATOR::Gene:Compound",True),("DGIDB::ALLOSTERIC MODULATOR::Gene:Compound",True),
                ("DRUGBANK::target::Compound:Gene",False),("Hetionet::CbG::Compound:Gene",False)],
}


def witnesses(g, anchor, steps, pool, bridge):
    relation, forward = steps[-1]
    target = bridge or anchor
    linked = pool.intersection(g.walk(target,relation,forward))
    result = {}
    for drug in linked:
        edge = [target,relation,drug] if forward else [drug,relation,target]
        result[drug] = ([[target,PARTICIPATES,anchor]] if bridge else [])+[edge]
    return result


def retrieve(g, terms, pool, brief, spec, findings, k):
    ids = sorted(pool)
    sources = {f["id"]:f for f in findings}
    fact = next((f for f in brief["facts"] if f["field"]==spec["fact"] and f["concept"]==spec["concept"]), None)
    queries, predictions, witnessed, unmapped = [], {}, {}, []
    projected = {}
    risk = brief["criterion"]=="safety-interactions-class"
    for proposal in spec["proposals"]:
        if not fact or not set(proposal["requires"]).issubset(sources) or proposal["action"] not in ACTIONS:
            unmapped.append({"proposal":proposal,"reason":"Missing affirmative brief fact or verified primary source."})
            continue
        anchors = sorted(terms.lookup[proposal["kind"]].get(norm(proposal["anchor"]), ()))
        if len(anchors)!=1:
            unmapped.append({"proposal":proposal,"reason":"No unique frozen entity for research term."})
            continue
        anchor = anchors[0]
        bridge = None
        if proposal.get("bridge"):
            possible = sorted(terms.lookup["gene"].get(norm(proposal["bridge"]), ()))
            if len(possible)!=1 or anchor not in g.walk(possible[0],PARTICIPATES,True):
                unmapped.append({"proposal":proposal,"reason":"Required observed gene–process bridge unavailable."})
                continue
            bridge = possible[0]
        mapped = 0
        for relation, forward in ACTIONS[proposal["action"]]:
            if relation not in g.relations:
                continue
            if g.types[relation] != (("Gene","Compound") if forward else ("Compound",(bridge or anchor).split("::")[0])):
                continue
            steps = ([(PARTICIPATES,False)] if bridge else [])+[(relation,forward)]
            signature=(anchor,bridge,tuple(steps))
            evidence = list(dict.fromkeys(sources[i]["url"] for i in proposal["requires"]))
            if signature in projected:
                existing=queries[projected[signature]]
                existing["finding_ids"].extend(i for i in proposal["requires"] if i not in existing["finding_ids"])
                existing["evidence"].extend(u for u in evidence if u not in existing["evidence"])
                mapped += 1
                continue
            support = witnesses(g,anchor,steps,pool,bridge)
            point, meta, _ = query(g,anchor,steps,evidence,support,keep_empty=True)
            assert point.shape == (g.E.shape[1],)
            scores = np.linalg.norm(g.E[[g.entities[n] for n in ids]]-point,axis=1) if ids else []
            formula = "e["+anchor+"]"
            for t in meta["traversals"]:
                t["row"] = g.relations[t["relation"]]
                formula += (" + " if t["forward"] else " - ")+"r["+t["relation"]+"]"
            meta.update(fact=fact, finding_ids=list(proposal["requires"]), desired_action=proposal["action"],
                        goal=proposal["goal"],anchor_label=terms.labels[anchor],anchor_row=g.entities[anchor],
                        derivation=[[bridge,PARTICIPATES,anchor]] if bridge else [],formula=formula,
                        scores={n:float(s) for n,s in zip(ids,scores)})
            index = len(queries)
            projected[signature]=index
            for n,s in meta["scores"].items():
                row = dict(id=n,query=index,l2=s,support=support.get(n,[]),evidence=evidence,
                           interpretation="observed link plus graph prediction" if n in support else "graph prediction only")
                if n not in predictions or s<predictions[n]["l2"]:
                    predictions[n]=row
                if n in support and (n not in witnessed or s<witnessed[n]["l2"]):
                    witnessed[n]=row
            queries.append(meta)
            mapped += 1
        if not mapped:
            unmapped.append({"proposal":proposal,"reason":"No direction-compatible release predicate."})
    ordered=sorted(predictions.values(),key=lambda row:(row["l2"],row["id"]))
    retrieval=[dict(row,rank=i+1) for i,row in enumerate(ordered)]
    supported=sorted(witnessed.values(),key=lambda row:(row["l2"],row["id"]))
    return dict(queries=queries,facts=brief["facts"],pool_size=len(pool),rank_type="concern" if risk else "benefit",
                retrieval=retrieval,top_k=retrieval[:k],unmapped=unmapped,
                ranking=[] if risk else [dict(row,rank=i+1) for i,row in enumerate(supported)],
                reason=None if queries else "Unscored: no verified, type-compatible research mapping.",
                combination="Smallest L2 across compatible translations for each drug. Ties use canonical ID. Risk rank 1 means greatest predicted concern.")


def apply_safety_review(result, graph, medicines, review, unresolved):
    """Only the coordinator knows exact medications. Maintain previously required DDI and documentary checks."""
    from shared.biology import DDI
    if unresolved or medicines != [review["applies_with"]]:
        return
    med = medicines[0]
    pairs=set(graph.walk(med,DDI,True)) | set(graph.walk(med,DDI,False))
    allowed = [dict(row,support=review["reviewed"][row["id"]]) for row in result["retrieval"]
               if row["id"] in review["reviewed"] and row["id"] not in pairs
               and review["reviewed"][row["id"]].get("finding") and review["reviewed"][row["id"]].get("source")]
    allowed.sort(key=lambda row:(-row["l2"],row["id"]))
    result["ranking"]=[dict(row,rank=i+1) for i,row in enumerate(allowed)]


def researched_proposals(name, hosted, findings, brief, spec, sources, receipts, terms):
    """Translate verified profiles semantically; retain each failure or unmatched direction in the trace."""
    proposals, rejected = [], []
    for idx, profile in enumerate(hosted.get("profiles", [])):
        keys = []
        for e in profile["evidence"]:
            key = f"profile-{idx}-{e['id']}"
            keys.append(key)
            findings.append(dict(id=key,role="hosted research finding",finding=e["claim"],url=e["url"]))
        if not keys:
            continue
        if name in ("disease-indications","symptoms-function"):
            # Ground clinical goals in the reviewed trial outcome. Do not turn a
            # patient's difficulty swallowing into a molecular diagnosis.
            for template in spec["proposals"]:
                ids={e["id"] for e in profile["evidence"]}
                if ids.intersection(spec["papers"]) and (name=="disease-indications"
                        or "swallow" in profile["therapeutic_goal"].lower()):
                    proposals.append(dict(template,goal=profile["therapeutic_goal"],
                                          requires=list(template["requires"])+keys))
                else:
                    rejected.append(dict(goal=profile["therapeutic_goal"],reason="No corresponding supported clinical endpoint"))
            continue
        for t in profile["molecular_targets"]:
            action = t["desired_action"]
            if action not in ACTIONS:
                rejected.append(dict(target=t,reason="No equivalent signed predicate in this release"))
                continue
            # A target association cannot by itself justify up- or down-regulation.
            # For directional projections require an independently curated action
            # with its supporting primary record(s) retrieved in this run.
            anchor_term = t["symbol"].upper()
            authority = next((p for p in spec["proposals"] if
                              (p.get("bridge") or p["anchor"]).upper()==anchor_term and
                              p["action"]==action and set(p["requires"]).issubset(
                                  f["id"] for f in findings)),None)
            corroborating = authority["requires"] if authority else []
            if not authority and not spec.get("risk") and re.fullmatch(r"[A-Z0-9-]{2,15}",anchor_term) and terms.lookup["gene"].get(norm(anchor_term)):
                pmids={e["id"] for e in profile["evidence"] if e["source"]=="pubmed"}
                receipt=sources.corroborate(anchor_term,action,pmids)
                if receipt:
                    receipts.append(receipt)
                    for hit in receipt.get("records",[]):
                        claim_id=f"direction-{anchor_term}-{action}-{hit['id']}"
                        findings.append(dict(id=claim_id,url=hit["url"],role="molecular direction check",
                           finding=f"{anchor_term} and the proposed action occur together in this primary report; therapeutic direction is a research hypothesis."))
                        corroborating.append(claim_id)
            if not corroborating:
                rejected.append(dict(target=t,reason="No independent support for this exact molecular direction"))
                continue
            keys_for_target=list(dict.fromkeys(keys+corroborating))
            if name=="safety-interactions-class" and not (
                    t["symbol"].upper()=="CYP1A2" and action=="inhibit"
                    and any(f["concept"]=="cyp1a2_exposure" for f in brief["facts"])):
                rejected.append(dict(target=t,reason="No attributable harmful direction for this exposure"))
                continue
            base=dict(goal=profile["therapeutic_goal"],action=action,requires=keys_for_target,origin="verified hosted profile")
            if name=="pathways-processes":
                proposals.extend(dict(base,anchor=p,kind="biological process",bridge=t["symbol"])
                                 for p in profile["pathways"])
            else:
                proposals.append(dict(base,anchor=t["symbol"],kind="gene"))
    return proposals, rejected


def research_category(brief, g, pool, terms, spec, sources, k, hosted_cache):
    active = any(f["field"]==spec["fact"] and f["concept"]==spec["concept"] for f in brief["facts"])
    receipts, findings = sources.search(spec, active)
    hosted = {}
    if brief["planner"]=="claude":
        from shared.hosted import live_research
        hosted=live_research(brief,receipts,findings,hosted_cache,replay_only=sources.replay_only)
    templates=list(spec["proposals"])
    if active and spec["database"][0]=="target":
        receipt=sources.target_annotation(spec["database"][1])
        receipts.append(receipt)
        templates=[]
        for record in receipt.get("records",[]):
            findings.append(dict(id=record["id"],role="target identity and GO annotation",
                                 finding="Reviewed target annotation identifies "+record["symbol"]+".",url=record["url"]))
            for entry in spec["proposals"]:
                if entry["kind"]=="gene":
                    templates.append(dict(entry,anchor=record["symbol"],requires=entry["requires"]+[record["id"]]))
                else:
                    for process in record["processes"]:
                        if not re.search(r"glutamate.*(transport|import|uptake)",process["label"],re.I):
                            continue
                        entity="Biological Process::"+process["id"]
                        if entity in g.entities:
                            templates.append(dict(entry,anchor=terms.labels.get(entity,process["label"]),
                                      bridge=record["symbol"],requires=entry["requires"]+[record["id"]]))
    dynamic_spec=dict(spec,proposals=templates)
    extra, rejected=researched_proposals(brief["criterion"], hosted, findings, brief, dynamic_spec,
                                        sources,receipts,terms)
    result=retrieve(g,terms,pool,brief,dict(spec,proposals=templates+extra),findings,k)
    if not templates and active:
        result["unmapped"].append(dict(reason="No verified drug-target or process annotation."))
    result["unmapped"].extend(rejected)
    return dict(result,searches=receipts,findings=findings,hosted=hosted,
                retrieval_evidence="Citations support the query hypothesis. The interpretation field distinguishes direct graph witnesses from predictions.",
                fusion_rank_type=("suitability within the documented medication screen" if result["rank_type"]=="concern"
                                  else "benefit among compounds with an observed supporting path"))
