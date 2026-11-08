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

from agent.config import PATIENT_PATH
from agent.schemas import Brief

REDACTED = "[REDACTED]"

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


def load_record() -> dict:
    return json.loads(PATIENT_PATH.read_text(encoding="utf-8"))


def sensitive_terms(record: dict) -> list[str]:
    terms: set[str] = set()
    for value in record.get("identifiers", {}).values():
        if not isinstance(value, str):
            continue
        terms.add(value)
        # names: also each part ("Alex", "Moreau"), skipping titles
        terms.update(p for p in re.split(r"[\s.]+", value) if len(p) >= 3 and p.lower() not in {"dr", "mrs", "miss"})
    for med in record.get("medications", []):
        terms.add(med["name"])
    for trial in record.get("trials", []):
        terms.add(trial["nct_id"])
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
