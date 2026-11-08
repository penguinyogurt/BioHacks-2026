"""Keeps drug names out of target profiles.

Profiles get embedded and matched against drugs by a separate process. A drug
name in the text would bias that match toward the drug the LLM happened to
think of, which defeats the point. Sub-agents are told not to name drugs, and
this module removes any that slip through anyway.
"""
import json
import re
from functools import lru_cache


PLACEHOLDER = "[drug]"

# ALS and ALS-symptom drugs, plus brand names. Generic names from pipeline.json
# and Open Targets are added at runtime.
_STATIC = [n.strip() for n in """
riluzole, rilutek, tiglutik, exservan, edaravone, radicava, tofersen, qalsody,
sodium phenylbutyrate, taurursodiol, relyvrio, albrioza, amx0035, masitinib, ibudilast,
tirasemtiv, reldesemtiv, ceftriaxone, dexpramipexole, arimoclomol, pridopidine, verdiperstat,
zilucoplan, methylcobalamin, mecobalamin, tudca, ursodiol, minocycline, celecoxib,
baclofen, tizanidine, dantrolene, diazepam, clonazepam, lorazepam, midazolam,
mexiletine, quinine, gabapentin, pregabalin, carbamazepine, levetiracetam, phenytoin,
glycopyrrolate, glycopyrronium, atropine, scopolamine, hyoscine, amitriptyline, nortriptyline,
botulinum toxin type a, botulinum toxin type b, botulinum toxin, botulinum, botox, myobloc,
onabotulinumtoxina, rimabotulinumtoxinb, guaifenesin, n-acetylcysteine, acetylcysteine, carbocisteine,
dextromethorphan, quinidine, nuedexta, citalopram, sertraline, escitalopram, fluoxetine, paroxetine,
mirtazapine, trazodone, zolpidem, melatonin, modafinil, methylphenidate,
morphine, oxycodone, hydromorphone, fentanyl, codeine, tramadol, acetaminophen, paracetamol,
ibuprofen, naproxen, diclofenac, senna, sennosides, bisacodyl, lactulose, polyethylene glycol, docusate,
dronabinol, megestrol, mirabegron
""".split(",") if n.strip()]

# Names that are also biology words. Matching them would scrub legitimate
# mechanism text ("creatine kinase", "glutamate release").
_KEEP = {"glutamate", "creatine", "sodium", "potassium", "calcium", "magnesium", "zinc", "copper", "oxygen",
         "glucose", "insulin", "dopamine", "serotonin", "histamine", "glycine", "taurine", "adenosine",
         "toxin", "vitamin", "water", "iron", "lithium carbonate"}


@lru_cache(maxsize=1)
def lexicon() -> tuple[re.Pattern, ...]:
    names: set[str] = set(_STATIC)
    from agent.config import ROOT
    for ingredient in json.loads((ROOT/"examples/als-study-cache.json").read_text())["ingredients"]:
        names.update([ingredient["name"].lower(),*(n.lower() for n in ingredient["aliases"])])
    names = {n for n in names if len(n) >= 4 and n not in _KEEP}
    # Multi-word names first ("botulinum toxin" before "botulinum").
    ordered = sorted(names, key=len, reverse=True)
    return tuple(re.compile(rf"(?<![\w-]){re.escape(n)}(?![\w-])", re.I) for n in ordered)


# Development codes: AMX0035, CNM-Au8, BIIB067, MN-166 and the like.
_CODE = re.compile(r"\b[A-Z]{2,5}-?\d{2,5}[A-Za-z]?\d*\b")
_ID = re.compile(r"^(NCT\d{8}|ENSG\d+|MONDO\d*|PMID\d*)$")  # trial / target ids, not drugs
_GENE_LIKE = re.compile(r"^[A-Z0-9]{2,6}$")  # don't scrub gene symbols such as SOD1, CHRM3, GRIN2B


def scrub(text: str) -> tuple[str, int]:
    n = 0
    for pattern in lexicon():
        text, k = pattern.subn(PLACEHOLDER, text)
        n += k

    def code(m: re.Match) -> str:
        nonlocal n
        if _GENE_LIKE.match(m.group(0)) or _ID.match(m.group(0)):
            return m.group(0)
        n += 1
        return PLACEHOLDER

    text = _CODE.sub(code, text)
    return text, n


def scrub_model(obj, skip: frozenset[str] = frozenset({"id", "url", "symbol", "source", "desired_action", "target_validation"})):
    """Scrub every string in a pydantic model (recursively). Returns (copy, count)."""
    total = 0

    def walk(value, key=None):
        nonlocal total
        if isinstance(value, str):
            if key in skip:
                return value
            out, k = scrub(value)
            total += k
            return out
        if isinstance(value, list):
            return [walk(v, key) for v in value]
        if isinstance(value, dict):
            return {k: walk(v, k) for k, v in value.items()}
        return value

    cleaned = walk(obj.model_dump())
    return type(obj).model_validate(cleaned), total
