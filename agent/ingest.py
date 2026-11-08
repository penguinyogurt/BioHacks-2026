"""Patient chart PDF → data/patient/<patient_id>.json (a PatientRecord).

Text PDFs: pypdf extracts the text and Gemini structures it.
Scanned PDFs (little or no extractable text): the PDF itself goes to Gemini,
which reads it natively, so no separate OCR is needed.

The identifiers section is the privacy wall's input: privacy.sanitize_brief
can only redact strings it knows about. So a parse with no patient name is a
hard failure, not a warning.

  python -m agent.ingest chart.pdf --id jordan
"""
import argparse
import base64
import io
import json
import re
import sys
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage
from pypdf import PdfReader

from agent.config import DATA, GOOGLE_API_KEY, INGEST_MODEL
from agent.llm import gemini
from agent.schemas import PatientRecord

PATIENT_DIR = DATA / "patient"
PATIENT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
MIN_TEXT_CHARS = 200  # below this the PDF is treated as scanned

PROMPT = """Extract this ALS patient chart into the schema. Rules:
- Copy values exactly as written; don't infer or invent. Leave a field empty if it isn't in the document.
- identifiers: capture EVERY identifying string (patient name, DOB, record and card numbers, address,
  phone, email, every clinician/author/cc name, next of kin, clinic names). They are used for redaction,
  so missing one is worse than including an extra one.
- medications: generic names in lowercase.
- symptoms: every symptom or complaint mentioned, with 0-5 severity only if stated or clearly implied."""


class IngestError(ValueError):
    pass


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages).strip()


async def parse_pdf(data: bytes) -> tuple[PatientRecord, str]:
    """Returns (record, method), where method is 'text' or 'vision'."""
    if not data.startswith(b"%PDF"):
        raise IngestError("Not a PDF file.")
    if not GOOGLE_API_KEY:
        raise IngestError("GOOGLE_API_KEY is not set (agent/.env)")
    try:
        text = pdf_text(data)
    except Exception as e:
        raise IngestError(f"Couldn't read PDF: {e}") from e

    if len(text) >= MIN_TEXT_CHARS:
        method, content = "text", [{"type": "text", "text": f"Chart text:\n\n{text}"}]
    else:
        method = "vision"
        content = [
            {"type": "text", "text": "The chart is the attached PDF (scanned)."},
            {"type": "file", "base64": base64.b64encode(data).decode(), "mime_type": "application/pdf"},
        ]

    llm = gemini(INGEST_MODEL).with_structured_output(PatientRecord)
    record: PatientRecord = await llm.ainvoke([SystemMessage(PROMPT), HumanMessage(content=content)], config={"run_name": f"ingest: parse chart ({method})"})

    if not record.identifiers.full_name.strip():
        raise IngestError("No patient name found, so redaction can't be guaranteed. Refusing to save.")
    return record, method


def save(record: PatientRecord, patient_id: str, synthetic: bool, source: str) -> Path:
    if not PATIENT_ID.match(patient_id):
        raise IngestError("patient_id must be lowercase letters, digits, - or _")
    PATIENT_DIR.mkdir(parents=True, exist_ok=True)
    path = PATIENT_DIR / f"{patient_id}.json"
    path.write_text(json.dumps({"synthetic": synthetic, "source": source, **record.model_dump()}, indent=2), encoding="utf-8")
    return path


def summary(record: PatientRecord) -> dict:
    """What's safe to show about a parse in logs/UI: counts, not contents."""
    ids = record.identifiers
    n_ids = sum(1 for v in (ids.full_name, ids.date_of_birth, ids.mrn, ids.health_card, ids.address, ids.city, ids.phone, ids.email) if v) + len(ids.clinicians) + len(ids.other)
    return {
        "identifiers": n_ids,
        "medications": len(record.medications),
        "labs": len(record.labs),
        "function": len(record.function),
        "symptoms": len(record.symptoms),
        "trials": len(record.trials),
        "genetics": len(record.genetics),
    }


if __name__ == "__main__":
    import asyncio

    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--id", required=True, help="patient id, e.g. jordan → data/patient/jordan.json")
    ap.add_argument("--real", action="store_true", help="mark as real (not synthetic) data")
    args = ap.parse_args()
    try:
        rec, how = asyncio.run(parse_pdf(args.pdf.read_bytes()))
    except IngestError as e:
        sys.exit(f"ingest failed: {e}")
    out = save(rec, args.id, synthetic=not args.real, source=args.pdf.name)
    print(f"parsed via {how} -> {out}\n{json.dumps(summary(rec))}")
