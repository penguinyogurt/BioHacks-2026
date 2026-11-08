"""Writes a synthetic ALS clinic letter PDF for testing the ingest parser.

  python -m agent.make_sample_chart   → data/patient/samples/jordan_chart.pdf

Jordan is fictional and deliberately unlike Alex: bulbar onset, SOD1 variant
(a correct run should surface tofersen), sialorrhea and pseudobulbar affect.
"""
from fpdf import FPDF

from agent.config import DATA

OUT = DATA / "patient" / "samples" / "jordan_chart.pdf"

HEADER = [
    "Northshore Neuromuscular Clinic - ALS Program",
    "1200 Lakeview Avenue, Kingston, Ontario K7L 3N6   Tel 613-555-0198",
]
DEMOGRAPHICS = [
    ("Patient", "Jordan Ellis"),
    ("DOB", "1968-11-03"),
    ("MRN", "NNC-0071935"),
    ("Health card", "8812-447-310-KT"),
    ("Address", "44 Birch Crescent, Kingston, Ontario"),
    ("Phone", "613-555-0177"),
    ("Email", "j.ellis68@example.org"),
    ("Visit date", "2026-10-21"),
    ("Clinician", "Dr. Samuel Okafor, MD FRCPC (Neurology)"),
    ("cc", "Dr. Helen Brandt (family physician); Maria Ellis (spouse, next of kin)"),
]
SECTIONS = [
    ("Diagnosis", "Amyotrophic lateral sclerosis, bulbar onset. Symptom onset 2025-06 with slurred speech; "
     "diagnosed 2025-12 (Gold Coast criteria met). Now with upper-limb involvement bilaterally."),
    ("Genetics", "SOD1 heterozygous pathogenic variant c.14C>T (p.Ala5Val; legacy A4V). C9orf72 repeat expansion negative. "
     "Pharmacogenomic panel: CYP2D6 poor metabolizer; CYP1A2 normal metabolizer."),
    ("Current medications", "1. Riluzole oral suspension 50 mg twice daily (since 2026-01)\n"
     "2. Glycopyrrolate oral solution 1 mg three times daily (since 2026-05)\n"
     "3. Citalopram 10 mg daily (since 2026-03)\n"
     "4. Pantoprazole 40 mg daily"),
    ("Allergies", "Penicillin (hives). No other known drug allergies."),
    ("Symptoms reported today",
     "- Drooling: still troublesome despite glycopyrrolate, severity 4/5, worse when talking.\n"
     "- Pseudobulbar affect: episodes of uncontrollable crying several times a week, severity 3/5.\n"
     "- Speech: dysarthric, understood by family only; uses a text-to-speech app.\n"
     "- Swallowing: chokes on thin liquids and dry solids; uses thickened fluids. PEG discussed.\n"
     "- Low mood, severity 2/5, improving on citalopram.\n"
     "- Occasional muscle cramps in forearms, severity 1/5.\n"
     "- Constipation, severity 2/5."),
    ("Function", "ALSFRS-R 34/48 (bulbar 5/12, fine motor 9/12, gross motor 9/12, respiratory 11/12). "
     "Decline of about 1.1 points/month since diagnosis. FVC 71% sitting, 63% supine. "
     "Weight 72.0 kg (from 79.5 kg at diagnosis). Grip right 21 kg, left 19 kg."),
    ("Trials", "Screened for NCT04856982 (ATLAS, presymptomatic SOD1 study) - not eligible as already symptomatic. "
     "Interested in recruiting trials for SOD1-ALS."),
    ("Goals", "Keep communicating with family; reduce drooling and crying episodes; avoid choking."),
    ("Plan", "Discuss SOD1-directed therapy. Review drooling management. Recheck labs in 3 months."),
]
LABS = [
    ("Test", "Result", "Reference", "Date"),
    ("Creatine kinase", "312 U/L", "< 195", "2026-10-21"),
    ("ALT", "28 U/L", "< 40", "2026-10-21"),
    ("eGFR", "81 mL/min/1.73m2", "> 60", "2026-10-21"),
    ("Neurofilament light (serum)", "112 pg/mL", "< 20", "2026-09-30"),
    ("QTc (ECG)", "452 ms", "< 450", "2026-10-21"),
    ("Sodium", "139 mmol/L", "135-145", "2026-10-21"),
]


def build() -> None:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 7, HEADER[0], new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, HEADER[1], new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, "Clinic Letter - Follow-up Visit", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    for k, v in DEMOGRAPHICS:
        pdf.cell(30, 5, f"{k}:")
        pdf.cell(0, 5, v, new_x="LMARGIN", new_y="NEXT")
    for title, body in SECTIONS[:5]:
        _section(pdf, title, body)
    _section(pdf, "Laboratory results", "")
    with pdf.table(col_widths=(60, 45, 35, 30), text_align="LEFT", line_height=5) as table:
        for row in LABS:
            r = table.row()
            for cell in row:
                r.cell(cell)
    for title, body in SECTIONS[5:]:
        _section(pdf, title, body)
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(0, 4, "SYNTHETIC RECORD - fictional patient generated for BioHacks 2026 testing. Not a real person.")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))


def _section(pdf: FPDF, title: str, body: str) -> None:
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, title, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    if body:
        pdf.multi_cell(0, 4.5, body)


if __name__ == "__main__":
    build()
    print(OUT)
