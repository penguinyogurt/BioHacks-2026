"""The wall between the orchestrator (sees the patient record) and sub-agents
(see only a research brief).

The wall is enforced in three ways, so one layer failing isn't a leak:
  1. Brief has no free-form patient field (schemas.py).
  2. Sub-agents get no patient tool; the MCP server only exposes drug-level data.
  3. sanitize_brief scrubs every string the orchestrator writes into a brief:
     identifiers from the record, current medication names, dates, lab-style
     numbers with units, ages, contact details.
"""
import json
import re

from agent.config import DEFAULT_PATIENT, PATIENT_DIR
from agent.schemas import Brief

REDACTED = "[REDACTED]"
# name parts too generic to redact on their own (would gut briefs)
_NOT_IDENTIFYING = {"dr", "mrs", "miss", "md", "rn", "frcpc", "phd", "the", "and", "clinic", "hospital", "centre", "center", "health", "street", "road", "unit", "als", "neurology", "neuromuscular", "university", "general"}

_NAME_FIELDS = {"full_name", "clinicians", "neurologist"}
_PERSON_NAME = re.compile(r"^(Dr\.? )?[A-Z][a-z'-]+( [A-Z][a-z'-]+){1,2}$")

_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),  # email
    re.compile(r"\b\d{3}[-. ]\d{3}[-. ]\d{4}\b"),  # phone
    re.compile(r"\b\d{4}-\d{2}(-\d{2})?\b"),  # ISO dates / year-month
    re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
    re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{4}\b", re.I),
    re.compile(r"\b\d{1,3}[- ]?(years?|yrs?)[- ]?old\b", re.I),
    re.compile(r"\b(aged?|age) \d{1,3}\b", re.I),
    re.compile(r"\b[A-Z]{2,5}-\d{4,}\b"),  # MRN-like
    re.compile(r"\b\d{4}-\d{3}-\d{3}(-[A-Z]{2})?\b"),  # health-card-like
    # clinical measurements: "470 U/L", "76%", "77.5 kg", "68 pg/mL", "438 ms"
    re.compile(r"\b\d+(\.\d+)?\s?(%|kg|lbs?|u/l|iu|pg/ml|ng/ml|mg/dl|mmol/l|ml/min\S*|ms|cm)(?![a-z])", re.I),
]


def load_record(patient_id: str = DEFAULT_PATIENT) -> dict:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,40}", patient_id):
        raise ValueError("bad patient_id")
    return json.loads((PATIENT_DIR / f"{patient_id}.json").read_text(encoding="utf-8"))


def sensitive_terms(record: dict) -> list[str]:
    terms: set[str] = set()
    for field, value in record.get("identifiers", {}).items():
        for v in value if isinstance(value, list) else [value]:
            if not isinstance(v, str):
                continue
            terms.add(v)
            # person names: also each part ("Alex", "Moreau"), skipping titles.
            # Other identifiers (addresses, "next of kin") only as whole strings,
            # or common words would be scrubbed from every brief.
            name = v.split("(")[0].split(",")[0].strip()  # "Maria Ellis (spouse, next of kin)" -> "Maria Ellis"
            if field in _NAME_FIELDS or _PERSON_NAME.match(name):
                terms.update(p for p in re.split(r"[\s.]+", name) if len(p) >= 3 and p.lower() not in _NOT_IDENTIFYING)
    for med in record.get("medications", []):
        terms.add(med["name"])
    for trial in record.get("trials", []):
        terms.update(t for t in (trial.get("nct_id"), trial.get("name")) if t)
    # longest first so "Alex Moreau" goes before "Alex"
    return sorted((t for t in terms if t.strip()), key=len, reverse=True)


def redact(text: str, terms: list[str]) -> tuple[str, int]:
    n = 0
    for term in terms:
        text, k = re.subn(rf"(?<!\w){re.escape(term)}(?!\w)", REDACTED, text, flags=re.I)
        n += k
    for pattern in _PATTERNS:
        text, k = pattern.subn(REDACTED, text)
        n += k
    return text, n


def sanitize_brief(brief: Brief, terms: list[str]) -> tuple[Brief, int]:
    total = 0

    def clean(s: str) -> str:
        nonlocal total
        out, n = redact(s, terms)
        total += n
        return out

    safe = Brief(
        criterion=brief.criterion,
        objective=clean(brief.objective),
        constraints=[clean(c) for c in brief.constraints],
        avoid=[clean(a) for a in brief.avoid],
    )
    return safe, total
