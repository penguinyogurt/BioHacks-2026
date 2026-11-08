"""Extract attributable, minimum-necessary facts once on the coordinator side."""
import re
from agent.criteria import CRITERIA
from agent.privacy import sensitive_terms
from ranking.intersection import NAMES
from shared.terms import NEGATED

FIELDS = {
    NAMES[0]: ("diagnosis","goals"),
    NAMES[1]: ("diagnosis","genotype","goals"),
    NAMES[2]: ("current_therapy","allergies","respiratory","weight","muscle","swallow","hand_function"),
    NAMES[3]: ("diagnosis","genotype","goals"),
    NAMES[4]: ("swallow","hand_function","symptoms","respiratory","weight","goals"),
}
GOALS = ("Slow functional decline and preserve survival.",
         "Identify a target and direction with a rationale for preserving motor neurons.",
         "Flag pharmacological interactions and tolerability concerns.",
         "Identify a biological process whose modulation could preserve function.",
         "Identify outcomes relevant to swallowing and daily function.")
UNKNOWN = ("Individual response and applicable trial phenotype.",
           "Patient-level target engagement and causal genotype unless specifically tested.",
           "Pair-specific exposure, interaction magnitude and route-specific tolerability.",
           "Patient-specific process activity and engagement.",
           "Instrumental swallowing assessment and a causal diagnosis for functional observations.")


def make_briefs(profile, terms, review):
    facts = profile["facts"]
    med_parts = terms.medication_parts(facts.get("current_therapy",""))
    meds = {n for _, nodes in med_parts for n in nodes}
    sensitive = sensitive_terms(profile) + [profile.get("case_id","")]
    sensitive += [terms.labels[n] for n in meds if n in terms.labels]
    briefs = []
    for name, objective, unknown in zip(NAMES,GOALS,UNKNOWN):
        items = []
        unknowns = [unknown]
        if "goals" not in facts:
            unknowns.append("The record does not state the patient's own treatment priorities.")
        if name in (NAMES[1],NAMES[3]) and not facts.get("genotype"):
            unknowns.append("No genotype is documented; do not assign a molecular subtype.")
        for field in FIELDS[name]:
            value = facts.get(field)
            if not value:
                continue
            # Use reusable pharmacological descriptions. The quoted original is in
            # the coordinator's local source ledger and is never sent to search APIs.
            item = {"field":field,"pointer":profile.get("pointers",{}).get(field,"facts."+field),
                    "status":"reported","concept":"","quote":"", "hypotheses":[],
                    "source_kind":"de-identified abstraction; local ledger holds the chart quotation"}
            if field == "diagnosis":
                nodes = terms.match(value, "disease")
                item.update(concept="als" if "Disease::MESH:D000690" in nodes else "other_diagnosis",
                            quote=", ".join(terms.labels[n] for n in nodes) or "Diagnosis did not resolve",
                            status="reported" if nodes else "unresolved")
            elif field == "current_therapy":
                if review["applies_with"] in meds:
                    item.update(concept="cyp1a2_exposure",quote="Active therapy with a labeled CYP1A2 interaction concern.")
                elif all(NEGATED.search(part) for part,_ in med_parts) and med_parts:
                    item.update(concept="no_active_index_therapy",quote="Index therapy reported inactive.",status="negated")
                else:
                    item.update(concept="other_therapy",quote="No matching active medication for this interaction protocol.",status="unresolved")
            elif field == "swallow" and re.search("cough|swallow|dysphagi",value,re.I):
                item.update(concept="swallowing",quote="Swallowing or cough with liquids is reported.",
                            hypotheses=["Swallowing impairment is a retrieval hypothesis."])
            elif field == "genotype":
                genes = terms.match(value, "gene")
                item.update(concept="reported_gene",quote="Gene mentioned: "+", ".join(terms.labels[n] for n in genes) if genes else "No affirmed gene result.")
            elif field == "respiratory" and "FVC" in value:
                measures = re.findall(r"(\d+(?:\.\d+)?)%",value)
                item["quote"] = ("Lower supine than sitting vital capacity is reported."
                                 if len(measures)==2 and float(measures[1])<float(measures[0])
                                 else "Vital capacity is documented; severity requires review.")
            elif field == "weight" and "unintentional" in value.lower():
                item["quote"]="Unintentional weight change is reported."
                weights=re.findall(r"\d+(?:\.\d+)?",value)
                if len(weights)==2 and float(weights[1])<float(weights[0]):
                    item["quote"]="Unintentional weight loss is reported."
            elif field == "muscle":
                measures=re.findall(r"\d+(?:\.\d+)?",value)
                item["quote"]=("Muscle-enzyme value above the reported reference limit."
                               if "ref <" in value and len(measures)==2 and float(measures[0])>float(measures[1])
                               else "Muscle-enzyme assessment recorded.")
            elif field == "goals":
                from agent.privacy import redact
                item["quote"]=redact(value,sensitive)[0]
            elif field == "symptoms":
                item.update(quote="A "+field+" entry is recorded; see local source reference.")
            else:
                item.update(quote={"respiratory":"Respiratory measurements recorded.","weight":"Body-weight trajectory recorded.",
                                   "muscle":"Muscle laboratory measurement recorded.","hand_function":"Grip and pinch findings recorded.",
                                   "allergies":"Allergy history recorded."}.get(field,"Observation recorded."))
            if field != "current_therapy" and NEGATED.search(value):
                item.update(status="negated or uncertain",quote="No affirmative finding used.",concept="",hypotheses=[])
            items.append(item)
        briefs.append(dict(criterion=name, objective=objective, goal_provenance="research objective",
                           facts=items, constraints=[x["quote"] for x in items if x["status"]=="reported"],
                           avoid=["Clinically consequential CYP1A2 inhibition."] if name==NAMES[2] and review["applies_with"] in meds else [],
                           unknowns=unknowns, mechanism_scope=(CRITERIA["M1"][0] if name in (NAMES[1],NAMES[3])
                                     and any(x["concept"]=="als" for x in items) else "")))
    return briefs, [s for s in sensitive if s]
