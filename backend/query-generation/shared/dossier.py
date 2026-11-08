"""Markdown rendering shared by the five independently invoked evaluators."""
from ranking.intersection import NAMES

DRKG="https://github.com/gnn4dr/DRKG"
TITLES=dict(zip(NAMES,("Disease / indications","Genes / targets","Safety / interactions / class",
                      "Pathways / processes","Symptoms / function")))


def cite(url):
    return f"[{url.split('/')[2]}]({url})"


def observed(name,row,report,c):
    a=report["agents"][name]
    if not row:
        searched=", ".join(sorted({q["anchor"] for q in a["queries"]})) or "no valid anchor"
        return f"No supported rank. Checked {searched} under the agent's typed-edge rules. Absence of a witness leaves the effect unknown. {cite(DRKG)}"
    if name==NAMES[2]:
        return f"Documentary medication-review rank {row['rank']} with risk-query L2 {row['l2']:.4f}. {row['support']['finding']} {cite(row['support']['source'])}"
    q=a["queries"][row["query"]]
    edges="; ".join(f"`{h}` → `{r}` → `{t}`" for h,r,t in row["support"])
    position="inside" if row["rank"]<=report["aggregation"]["top_k"] else "outside"
    sources=" ".join(cite(e) for e in q["evidence"] if isinstance(e,str) and e.startswith("https://"))
    grounding = q.get("fact", {})
    quote = grounding.get("quote", "")
    return (f"Chart evidence: “{quote}” → graph anchor {q['anchor_label']}. "
            f"Projection: `{q['formula']}`.\n\n"
            f"Observed DRKG assertions: {edges}. {cite(DRKG)}\n\n"
            f"Prediction: rank {row['rank']} ({position} strict top K), L2 {row['l2']:.4f} from the translated "
            f"`{q['anchor']}` query. Therapeutic benefit and direction of effect cannot be inferred from this assertion. {sources}")


def failures(review):
    issues=[f"{i['status']} {i.get('detail','')} at {i['source']}" for i in review["verification"]
            if i["status"]!="source marker present"]
    for subject, search in review["literature_searches"].items():
        if search["status"] != "retrieved":
            issues.append(subject + ": " + search["status"] + " at " + search["endpoint"])
    return issues


def references(urls):
    return " ".join(cite(link) for link in dict.fromkeys(urls))


def primary_findings(item):
    findings = " ".join(f"{v['finding']} {cite(v['source'])}" for v in item["decisive"])
    if item["unreviewed_studies"]:
        findings += " Primary outcomes still need review. " + references(item["unreviewed_studies"])
    return findings.strip() or "No adjudicated primary result."


def delivery_text(item):
    records = item["delivery"]
    if not records:
        return "No drug-specific exposure or focused-ultrasound dossier has been verified."
    parts = []
    for key, label in (("exposure", "Original delivery"), ("delivery_change", "Proposed focused ultrasound")):
        claim = records.get(key, {})
        parts.append(f"**{label}**. {claim.get('finding','Evidence missing.')} " + references(claim.get("sources", [])))
    return "\n\n".join(parts)


def dossier(report, node, load_agent):
    item = report["reassessments"][node]
    lines = ["# " + report["ingredient_names"][node], "",
             "**Disposition: " + item["disposition"] + ".**", "",
             "Human evidence category: " + item["category"] + ".", "", primary_findings(item), ""]
    if item.get("case_exclusion"):
        case = item["case_exclusion"]
        lines += [case["reason"]+" "+cite(case["source"]), ""]
    if item["unreviewed_studies"]:
        lines += ["Unreviewed administration records: "+references(item["unreviewed_studies"]), ""]
    if item["conflicting_endpoints"]:
        lines += ["Conflicting controlled results for "+", ".join(item["conflicting_endpoints"])+".", ""]
    lines += ["## Why would changing delivery change the result?", "", delivery_text(item), "",
              "## Human studies and competing findings", ""]
    for record in item["studies"]:
        lines += [f"### {record['study_id']} · {record['role']}", "",
                  f"{record['design']}. Population: {record['population']}. Intervention: {record['route']}.", "",
                  "Primary endpoint: "+record["primary_endpoint"]+".", "",
                  "Observed outcome: "+record["finding"], "", "Safety: "+record["safety"],
                  "", record.get("other_findings",""), cite(record["source"]), ""]
    lines += ["## Internal ranking score", ""]
    graph = item.get("graph")
    if graph is not None:
        lines += ["| Agent | Supported rank | Weight | Contribution |","|---|---:|---:|---:|"]
        for n in NAMES:
            lines.append(f"| {TITLES[n]} | {graph['ranks'].get(n,'Missing evidence')} | "
                         f"{graph['weights'][n]:.2f} | {graph['contributions'][n]:.4f} |")
        lines += ["",f"Base {graph['base']:.4f}; concern deduction {graph['penalty']:.4f}; "
                  f"**internal ranking score {graph['internal_ranking_score']:.4f}**. "
                  "This ordinal retrieval measure has no probability interpretation.", ""]
        for n in NAMES:
            row = next((x for x in report["agents"][n]["ranking"] if x["id"] == node), None)
            lines += ["### "+TITLES[n]+" agent","",load_agent(n).evaluate(report,{"id":node},row),""]
    else:
        lines += ["Outside the investigational graph pool. No agent ranks or contributions assigned.", ""]
    review = item.get("review", {})
    if review:
        lines += ["## Case safety review", "",
                  "Documented screen: "+review.get("patient_safety_screen",{}).get("status","unresolved")+".",
                  "",review["medication_check"]+" "+review["warning"]+" "+references(review["sources"]),""]
        issues = failures(review)
        if issues:
            lines += ["Source-check limitations: "+"; ".join(issues), ""]
    lines += ["## Practical context", ""]
    for key, value in report["context_fields"][node].items():
        if isinstance(value,dict):
            lines.append("- "+key.replace("_"," ")+": "+value["value"]+
                         (" "+cite(value["source"]) if value.get("source") else ""))
    return "\n".join(lines).strip()+"\n"


def write_outputs(report, out, load_agent):
    folder = out.parent / (out.stem+"-research")
    folder.mkdir(exist_ok=True)
    by_id = report["reassessments"]
    names = report["ingredient_names"]
    def link(node):
        return f"[{names[node]}]({node.split('::')[1]}.md)"
    dossier_ids=set(report["trial_gate"]["evidence"]) | {item["id"] for item in report["advanced"]}
    for node in sorted(dossier_ids):
        (folder / (node.split("::")[1]+".md")).write_text(dossier(report,node,load_agent),encoding="utf-8")
    (folder/"query-traces.md").write_text(trace_report(report),encoding="utf-8")
    gate = report["trial_gate"]
    strict = report["aggregation"]
    lines = ["# ALS discovery and human-outcome reassessment", "",
             f"**{len(report['advanced'])} advanced for {report['case']['case_id'].title()}.** "
             f"{gate['before']:,} frozen compound IDs, {gate['after']} with verified human ALS administration, "
             f"{len(report['eligible_ids'])} in the investigational graph pool.", "", gate["scope"]+" Study history annotates the full discovery pool. Compounds without a matching trial remain eligible for mechanistic research.", "",
             f"Strict top-{strict['top_k']} after clinical and patient-safety review: {strict['status']}. "
             f"Five-way overlap: {strict['five_way_overlap']}.",
             strict.get("blocking_reason",""),
             "The fallback returned "+str(len(report["fallback"]["final"]))+"." if report["fallback"] is not None
             else "The strict intersection supplied the final list.", "",
             "Graph-only supported counts before clinical selection: "+
             ", ".join(f"{TITLES[n]} {report['graph_overlap']['supported_sizes'][n]}" for n in NAMES)+".",
             "", "[Patient-specific queries and agent rankings](query-traces.md) · "
             f"[All scores, study records and decisions](../{out.name})", ""]
    pool = report["pool"]
    lines += ["## Discovery pool", "",
              f"All five researchers received {len(report['eligible_ids']):,} identical compound IDs. "
              f"{pool['verified_als_in_scored_pool']} have verified human ALS administration in the cache. "
              f"Testing status is unknown here for the other {pool['unknown_als_testing_in_scored_pool']:,}.", "",
              report["assumption"], ""]
    if report["advanced"]:
        lines += ["## Advanced", ""] + [f"- {i['final_rank']}. {link(i['id'])} — {i['category']}, "
                    f"internal ranking score {i['internal_ranking_score']:.4f}." for i in report["advanced"]]+[""]
    if report["previous_finalists"]:
        lines += ["## Previous finalists", "", "| Previous rank | Ingredient | Previous internal ranking score | Current disposition | Decisive human evidence | Why change delivery? |",
                  "|---:|---|---:|---|---|---|"]
        for row in report["previous_finalists"]:
            node = row["id"]
            value = row["internal_ranking_score"]
            previous_score = "unavailable" if value is None else f"{value:.4f}"
            if node in by_id:
                lines.append(f"| {row['rank']} | {link(node)} | {previous_score} | "
                             f"{row['disposition']} | {primary_findings(by_id[node])} | "
                             f"{by_id[node]['delivery'].get('exposure',{}).get('finding','Evidence missing.')} |")
            else:
                lines.append(f"| {row['rank']} | {node} | {previous_score} | {row['disposition']} | — | — |")
        lines += [""]
    lines += ["## Decisions for every tested ingredient in the graph","",
              "Within each evidence category, the internal ranking score orders the rows that have graph evidence. "
              "An empty agent rank means missing support. Each drug dossier gives its delivery assessment.", ""]
    from itertools import groupby
    def order(node):
        item = by_id[node]
        return (item['category'], -item.get('graph',{}).get('internal_ranking_score',-1),node)
    for category, group in groupby(sorted(dossier_ids,key=order),key=lambda n:by_id[n]["category"]):
        lines += ["### "+category.capitalize(),"","| Ingredient | Disposition | Internal ranking score | Decisive human finding |",
                  "|---|---|---:|---|"]
        for node in group:
            item = by_id[node]
            score = item.get("graph",{}).get("internal_ranking_score")
            value = "—" if score is None else f"{score:.4f}"
            lines.append(f"| {link(node)} | {item['disposition']} | {value} | {primary_findings(item)} |")
        lines += [""]
    lines += ["## Why would changing delivery change the result?", "",
              "For each negative trial, the dossier examines whether exposure or engagement limited the original "
              "regimen and whether focused ultrasound could correct that limitation for the same ingredient. "
              "Human ALS feasibility evidence demonstrates transient focal opening measured by contrast enhancement. "
              "Drug-specific exposure, target engagement and a clinical response require separate evidence. "
              +cite("https://pubmed.ncbi.nlm.nih.gov/31558719/"), "",
              "## Five-agent breakdown", "",
              "Agent cells show supported rank / normalized weight / contribution. Missing support earns zero. "
              "Rows are alphabetical for lookup.", "",
              "| Ingredient | "+" | ".join(TITLES[n] for n in NAMES)+" | Concern deduction |",
              "|---|---|---|---|---|---|---:|"]
    for node in sorted(dossier_ids.intersection(report["eligible_ids"]), key=lambda n:names[n]):
        g = by_id[node]["graph"]
        cells = [f"{g['ranks'].get(n,'missing')} / {g['weights'][n]:.2f} / {g['contributions'][n]:.4f}" for n in NAMES]
        lines.append("| "+link(node)+" | "+" | ".join(cells)+f" | {g['penalty']:.4f} |")
    lines+=["","## Five-category retrieval","",
            "Each scored category searched the full eligible pool. The risk column reports concern; a small distance does not verify a conflict.", "",
            "| Category | Queries | Scored | Closest compound | Distance |", "|---|---:|---:|---|---:|"]
    for name in NAMES:
        a=report["agents"][name]
        row=a["retrieval"][0] if a["retrieval"] else None
        lines.append(f"| [{TITLES[name]}](handoff/{name}/trace.json) | {len(a['queries'])} | {len(a['retrieval'])} | "
                     + (f"{names[row['id']]} ({row['id']}) | {row['l2']:.5f} |" if row else "Unscored | — |"))
    lines+=["","## Discovery leads outside the administration cache","",
            "These graph-supported research hypotheses have unverified ALS testing status. "
            "Their disposition records whether case-specific safety review allowed advancement.", "",
            "| Lead | Compound | Internal ranking score | Decision |","|---:|---|---:|---|"]
    for row in report["discovery_leads"]:
        lines.append(f"| {row['rank']} | {names[row['id']]} ({row['id']}) | {row['internal_ranking_score']:.4f} | {row['disposition']} |")
    (folder/"summary.md").write_text("\n".join(lines)+"\n",encoding="utf-8")


def trace_report(report):
    lines = ["# Queries and investigational rankings", "",
             "Each query scores all eligible compounds in 400 frozen dimensions. The handoff rankings include predictions without direct edges. The tables here show the narrower graph-witness or documentary ranks used for final fusion.", ""]
    names = report["ingredient_names"]
    for name in NAMES:
        agent = report["agents"][name]
        rows = agent["ranking"]
        lines += ["## " + TITLES[name], ""]
        for fact in agent["facts"]:
            lines.append(f"- “{fact['quote']}” — {fact['mapping']}. {', '.join(fact['ids'])} "
                         f"({fact['pointer']}). {cite(fact['source'])}")
        if not agent["queries"] or not report["eligible_ids"]:
            lines += ["", "No supported graph query for these facts.", ""]
            continue
        best = rows[0] if rows else None
        q = agent["queries"][best["query"] if best else 0]
        drug = best["id"] if best else min(q["scores"], key=lambda n: (q["scores"][n], n))
        lines += ["",f"**Example trace**. “{q['fact']['quote']}” → {q['anchor_label']} "
                  f"(`{q['anchor']}`, frozen entity row {q['anchor_row']}). {cite(q['fact']['source'])}"]
        for edge in q["derivation"]:
            lines.append("- Observed anchor evidence: " + " → ".join(edge))
        for step in q["traversals"]:
            direction = "forward" if step["forward"] else "reverse"
            lines.append(f"- Relation row {step['row']}, {direction}: `{step['relation']}`")
        lines += [f"- `q = {q['formula']}`", f"- `||e[{drug}] - q||₂ = {q['scores'][drug]:.6f}` ({names[drug]})."]
        if best:
            if isinstance(best["support"], dict):
                lines.append("- Documentary support: "+best["support"]["finding"]+" "+cite(best["support"]["source"]))
            else:
                lines += ["- Observed support: "+" → ".join(edge) for edge in best["support"]]
        else:
            lines.append("- Exploratory distance only. No eligible ingredient has a supporting witness for a category rank.")
        lines += ["", "| Rank | Ingredient | L2 |", "|---:|---|---:|"]
        lines += [f"| {r['rank']} | {names[r['id']]} ({r['id']}) | {r['l2']:.6f} |" for r in rows]
        if not rows:
            lines.append("| — | Agent abstained | — |")
        lines += [""]
    return "\n".join(lines).rstrip() + "\n"
