"""DrugReport → PDF discovery report (layout follows the Addo Labs research-agent template).

  python -m agent.report_pdf agent/runs/<run_id>.drugs.json   # → same name, .pdf

Uses a system TrueType font (Arial / DejaVu) so dashes, arrows and Greek
letters render. If none is found, it falls back to core Helvetica and replaces
those characters with ASCII.
"""
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from fpdf import FPDF

logging.getLogger("fontTools").setLevel(logging.WARNING)  # subsetting chatter

VERDICT = {"strong_candidate": "Strong candidate", "worth_discussing": "Worth discussing", "use_with_caution": "Use with caution", "not_recommended": "Not recommended"}
INK, MUTED, RULE = (25, 25, 30), (110, 110, 118), (215, 215, 220)
BRAND = "Addo Labs"

_FONTS = [  # (regular, bold, italic)
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/ariali.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Italic.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
]
_ASCII = str.maketrans({"–": "-", "—": "-", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "×": "x", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "-", "α": "alpha", "β": "beta", "γ": "gamma", "κ": "kappa", "µ": "u", "μ": "u", "²": "2", "³": "3", "±": "+/-", "\u00a0": " "})


class _PDF(FPDF):
    def __init__(self, footer_text: str):
        super().__init__(format="Letter")
        self.footer_text = footer_text
        self.family, self.unicode = "Helvetica", False
        for reg, bold, ital in _FONTS:
            if all(Path(p).exists() for p in (reg, bold, ital)):
                self.add_font("Body", "", reg)
                self.add_font("Body", "B", bold)
                self.add_font("Body", "I", ital)
                self.family, self.unicode = "Body", True
                break
        self.set_margins(18, 16, 18)
        self.set_auto_page_break(True, 18)

    def multi_cell(self, *args, **kwargs):  # every block starts the next line at the left margin
        kwargs.setdefault("new_x", "LMARGIN")
        kwargs.setdefault("new_y", "NEXT")
        kwargs.setdefault("align", "L")
        return super().multi_cell(*args, **kwargs)

    def t(self, s) -> str:
        s = str(s or "")
        return s if self.unicode else s.translate(_ASCII).encode("latin-1", "replace").decode("latin-1")

    def font(self, size: float, style: str = "", color=INK):
        self.set_font(self.family, style, size)
        self.set_text_color(*color)

    def footer(self):
        self.set_y(-12)
        self.font(7.5, "", MUTED)
        self.cell(0, 5, self.t(f"{self.footer_text} · page {self.page_no()} of {{nb}}"), align="C")

    def heading(self, text: str, size: float = 13):
        if self.get_y() > self.h - 45:
            self.add_page()
        self.ln(3)
        self.font(size, "B")
        self.multi_cell(0, size * 0.5, self.t(text))
        self.ln(1.5)

    def para(self, text: str, size: float = 9.5, style: str = "", color=INK):
        self.font(size, style, color)
        self.multi_cell(0, size * 0.52, self.t(text))
        self.ln(1.5)

    def bullets(self, title: str, items: list[str]):
        if not items:
            return
        if title:
            self.font(9.5, "B")
            self.multi_cell(0, 5, self.t(title))
        self.font(9.5)
        for it in items:
            self.set_x(self.l_margin + 2)
            self.cell(4, 4.9, "•" if self.unicode else "-")
            self.multi_cell(self.epw - 6, 4.9, self.t(it))  # wrapped lines hang under the text, not the bullet
        self.ln(1.5)

    def dashes(self, items: list[str]):
        self.font(9.5)
        for it in items:
            self.set_x(self.l_margin)
            self.cell(4, 4.9, "-")
            self.multi_cell(self.epw - 4, 4.9, self.t(it))
        self.ln(1.5)

    def rule(self):
        self.set_draw_color(*RULE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)


def _when(iso: str) -> str:
    """'2026-11-08T07:36:22+00:00' → 'Nov 8, 2026, 2:36 a.m.' in local time."""
    try:
        t = datetime.fromisoformat(iso).astimezone()
    except ValueError:
        return iso[:16]
    return f"{t:%b} {t.day}, {t.year}, {t.hour % 12 or 12}:{t:%M} {'a.m.' if t.hour < 12 else 'p.m.'}"


BBB = {"very_low": "Very low", "low": "Low", "moderate": "Moderate", "high": "High", "unknown": "Unknown"}
LINK = (40, 80, 160)


def render(report: dict) -> bytes:
    pt = report.get("patient") or {}
    name = pt.get("name") or report["patient_id"]
    pdf = _PDF(f"{BRAND} · {name}")
    pdf.alias_nb_pages()
    pdf.add_page()

    pdf.font(8, "B", MUTED)
    pdf.multi_cell(0, 4.5, pdf.t(f"{BRAND.upper()} · DISCOVERY REPORT"))
    pdf.ln(1.5)
    pdf.font(19, "B")
    pdf.multi_cell(0, 8.5, pdf.t(f"Alternative therapeutic candidates for {name}"))
    pdf.ln(1)
    pdf.font(9, "", MUTED)
    meta = [_when(report["created_at"]), pt.get("headline", ""), "Delivery assumption: MRgFUS blood-brain barrier opening"]
    pdf.multi_cell(0, 4.6, pdf.t(" · ".join(m for m in meta if m)))
    src = "inline list" if report["drugs_source"] == "inline" else Path(report["drugs_source"]).name
    pdf.multi_cell(0, 4.6, pdf.t(f"Case source: {report['patient_id']} record · Drug list: {src} · Run {report['run_id']} · "
                                 f"{report['models'].get('orchestrator', '')} + {report['models'].get('researcher', '')}"))
    pdf.ln(2)
    pdf.rule()

    pdf.heading("Summary")
    pdf.para(report["summary"])

    if pt.get("context"):
        pdf.heading("Patient context")
        pdf.dashes(pt["context"])

    if report.get("method"):
        pdf.heading("Method")
        pdf.para(report["method"])

    candidates = [d for d in report["drugs"] if d["verdict"] != "not_recommended"]
    excluded = [d for d in report["drugs"] if d["verdict"] == "not_recommended"]
    pdf.heading("Ranked candidates")
    for i, d in enumerate(candidates, 1):
        if pdf.get_y() > pdf.h - 60:
            pdf.add_page()
        pdf.font(11, "B")
        title = f"{i}. {d['name']} - {d['drug_class']}" if d.get("drug_class") else f"{i}. {d['name']}"
        pdf.multi_cell(0, 5.6, pdf.t(f"{title}    {d['score']}/100"))
        profiles = " · ".join(f"{p} profile" for p in d.get("matched_profiles", [])[:2])
        bits = [profiles, d.get("molecular_size", ""), f"BBB alone: {BBB.get(d.get('bbb_penetration'), 'Unknown')}",
                f"With MRgFUS: {d.get('fus_delivery', '')}" if d.get("fus_delivery") else "",
                "Novel lead" if d.get("novelty") == "novel" else "", VERDICT[d["verdict"]]]
        pdf.font(8, "", MUTED)
        pdf.multi_cell(0, 4.2, pdf.t(" · ".join(b for b in bits if b and b != "unknown")))
        pdf.ln(0.8)
        pdf.para(d["rationale"], 9.5)
        for label in ("evidence", "safety", "cost", "availability", "acceptance"):
            if d.get(label):
                pdf.set_x(pdf.l_margin + 4)
                pdf.font(8.8)
                pdf.multi_cell(pdf.epw - 4, 4.4, pdf.t(f"{label.capitalize()}: {d[label]}"))
        pdf.ln(2.5)

    if excluded:
        pdf.heading("Excluded for this patient")
        pdf.dashes([f"{d['name']} - {d['headline']}" for d in excluded])

    pdf.heading("Limitations")
    pdf.para((report.get("limitations", "") + " " if report.get("limitations") else "") +
             "Hypothesis-generating output for discussion with the care team, not a treatment recommendation. Knowledge-graph "
             "similarity reflects graph structure, not demonstrated efficacy. CNS exposure after focused-ultrasound opening has not "
             "been measured for these drugs, and any use would need a trial or physician-led protocol.")
    web = report.get("web", {})
    notes = [w for w in report["warnings"] if not w.startswith("Research aid")] + [
        f"Per-drug researchers never saw the patient record: {web.get('researcher_searches', 0)} web searches. "
        f"Orchestrator: {web.get('pubmed_searches', 0)} PubMed searches, {web.get('followup_questions', 0)} web questions "
        f"({web.get('query_redactions', 0)} identifiers removed). {web.get('papers_seen', 0)} PubMed records considered; "
        f"{web.get('dropped_citations', 0)} unverifiable citations removed."]
    pdf.font(7.8, "", MUTED)
    for n in notes:
        pdf.multi_cell(0, 4, pdf.t(n))

    if report.get("references"):
        pdf.heading("References")
        for r in report["references"]:
            if pdf.get_y() > pdf.h - 30:
                pdf.add_page()
            pdf.font(8.8)
            pdf.multi_cell(0, 4.4, pdf.t(f"[{r['n']}] {r['citation']}"))
            pdf.set_x(pdf.l_margin + 4)
            pdf.font(7.8, "", LINK)
            pdf.multi_cell(pdf.epw - 4, 3.9, pdf.t(r["url"]), link=r["url"])
            pdf.ln(1.6)
    return bytes(pdf.output())


if __name__ == "__main__":
    src = Path(sys.argv[1])
    out = src.with_name(src.name.replace(".drugs.json", "") + ".drugs.pdf") if src.name.endswith(".drugs.json") else src.with_suffix(".pdf")
    out.write_bytes(render(json.loads(src.read_text(encoding="utf-8"))))
    print(out)
