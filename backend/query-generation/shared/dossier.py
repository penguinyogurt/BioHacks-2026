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


def write_outputs(report,out,load_agent):
    ag=report["aggregation"]
    folder=out.parent/(out.stem+"-research")
    folder.mkdir(exist_ok=True)
    fb=report.get("fallback")
    title="# Alex research candidates" if report["case"]["case_id"]=="alex" else "# Research candidates"
    lines=[title,"",f"Strict first pass: **{ag['status']}** at K={ag['top_k']}. "
           f"Five-way overlap: {ag['five_way_overlap']}.","",
           " | ".join(f"{TITLES[n]}: {ag['list_sizes'][n]}" for n in NAMES),""]
    gate = report["trial_gate"]
    lines += [f"ALS administration gate: {gate['before']:,} canonical ingredients → {gate['after']} with documented human exposure in the frozen graph → {len(report['eligible_ids'])} eligible investigational IDs after case and comparator exclusions.", "", gate["scope"], "", "[Query traces and complete agent rankings](query-traces.md)", "", "### Established ALS treatments", ""]
    for node, item in report["established"].items():
        lines.append(f"- {item['name']} ({node}), reported separately. {cite(item['classification_source'])}")
    for item in gate["withheld"]:
        lines.append("- "+str(item.get("ingredient", item.get("study")))+": "+item["reason"]+".")
    for item in gate["formulation_checks"]:
        lines.append("- "+item["reason"]+" "+cite(item["source"]))
    lines += [""]
    (folder/"query-traces.md").write_text(trace_report(report))
    if ag["abstained"]:lines.append("Abstaining agents: "+", ".join(ag["abstained"]))
    if not fb:
        lines.append("The strict intersection supplies the following research ranking. The fallback was unnecessary.")
        for row in ag["final"]:
            lines.append(f"- {row['final_rank']}. {report['ingredient_names'][row['id']]}: "+", ".join(
                f"{TITLES[n]} {r}" for n,r in row["ranks"].items())+". "+
                " ".join(cite(study["source"]) for study in gate["evidence"][row["id"]] ))
    else:
        zero=[k for k,v in ag["pairwise_overlap"].items() if v==0]
        lines+=["Zero-overlap pairs: "+(", ".join(zero) or "none; the five-way set is nevertheless empty"),"",
                f"Evaluated {fb['evaluated']} eligible IDs; {fb['provisional_count']} had a qualifying graph rationale. "
                f"Reviewed {len(fb['reviews'])} provisional leaders. Fixed prior exclusions: {len(report['pool']['exclusions'])}.",
                "","A category counts when it supplies a sourced rank. A disease, target or pathway rank supports a research hypothesis. A missing rank contributes zero. Negative trial evidence appears beside the rankings and does not enter this graph score.", "", report["assumption"],"",
                "| Rank | Research candidate | Categories | Disease | Gene | Safety | Pathway | Symptom | Penalty | Score |",
                "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for c in fb["final"]:
            rv=c["review"]; node=c["id"]; slug=node.split("::")[1];dest=folder/(slug+".md")
            contributions=c["contributions"]
            lines.append(f"| {c['fallback_rank']} | [{rv['name']}]({slug}.md) | {len(c['ranks'])}/5 | "+
                         " | ".join(f"{contributions[n]:.4f}" for n in NAMES)+
                         f" | −{c['penalty']:.4f} | {c['score']:.4f} |")
            text=[f"# Research candidate {c['fallback_rank']}: {rv['name']} ({slug})","",
                  "**Safety unresolved.** "+rv["review_status"].capitalize()+".","",report["assumption"],"",
                  "Case facts are from the project profile "+cite(report["case"]["source"])+".",""]
            text += ["## Tested in human ALS studies", ""]
            for study in gate["evidence"][node]:
                text += [f"- **{study['outcome'].capitalize()}**. {study['population']}. {study['formulation']}. "
                         f"{study['result']} Study status: {study['status']}. [{study['study_id']}]({study['source']})"]
            text += [""]
            for n in NAMES:
                result=report["agents"][n]
                row=next((r for r in result["ranking"] if r["id"]==node),None)
                text+=[f"## {TITLES[n]} agent","",load_agent(n).evaluate(report,c,row),""]
            text+=["## Context",""]
            for k,field in report["context_fields"][node].items():
                if isinstance(field,dict):
                    text.append(f"- {k.replace('_',' ')}: {field['value']}"+(" "+cite(field["source"]) if field["source"] else ""))
            text+=["","## Why it ranked here","",
                   ", ".join(f"{TITLES[n]} {contributions[n]:.4f}" for n in NAMES)+
                   f"; concern deduction {c['penalty']:.4f}. Final score **{c['score']:.4f}**. "
                   f"Provisional position {c['provisional_rank']}; {len(c['ranks'])}/5 categories supported.","",
                   "## Main concern","",rv["contrary"]+" "+rv["warning"]+" Safety unresolved. "+
                   " ".join(cite(u) for u in rv["sources"]),"","## What evidence would change the ranking","",rv["change"]]
            dest.write_text("\n".join(text)+"\n")
        lines+=["","### Review findings",""]
        for x in fb["reviews"]:
            r=x["review"];issues=failures(r)
            lines.append(f"- {r['name']} ({x['id']}): **{r['safety']}**. {r['warning']} {r['contrary']} "+
                         " ".join(cite(u) for u in r["sources"])+
                         (" Source check limitations: "+"; ".join(issues) if issues else ""))
            if r["ddi_edges"]:
                lines.append("  Medication-pair graph alert: "+str(r["ddi_edges"])+". "+r["ddi_interpretation"])
        lines+=["","### Exclusions before ranking",""]
        for node, decision in report["pool"]["exclusions"].items():
            lines.append(f"- {decision.get('name',node)} ({node}): {decision['reason']} {cite(decision['source'])}")
        lines+=["",f"New hard exclusions: {list(fb['new_vetoes']) or 'none'}. "
                f"Displaced from provisional five: {fb['dropped'] or 'none'}. Backfilled: {fb['backfilled'] or 'none'}.",
                "",f"[Detailed machine-readable report](../{out.name})"]
    (folder/"summary.md").write_text("\n".join(lines)+"\n")

def trace_report(report):
    lines = ["# Queries and investigational rankings", "",
             "Each query scores every eligible ingredient. A reported category rank also requires a witness or documentary review. Distance uses the 400 frozen dimensions.", ""]
    names = report["ingredient_names"]
    for name in NAMES:
        agent = report["agents"][name]
        rows = agent["ranking"]
        lines += ["## " + TITLES[name], ""]
        for fact in agent["facts"]:
            lines.append(f"- “{fact['quote']}” — {fact['mapping']}. {', '.join(fact['ids'])} "
                         f"({fact['pointer']}). {cite(fact['source'])}")
        if not agent["queries"]:
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
