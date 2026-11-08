"""DrugReport → PDF, the final deliverable for the clinician.

  python -m agent.report_pdf agent/runs/<run_id>.drugs.json   # → same name, .pdf

Uses a system TrueType font (Arial / DejaVu) so dashes, arrows and Greek
letters render. If none is found, it falls back to core Helvetica and replaces
those characters with ASCII.
"""
import json
import sys
from pathlib import Path

from fpdf import FPDF
from fpdf.fonts import FontFace

VERDICT = {"strong_candidate": "Strong candidate", "worth_discussing": "Worth discussing", "use_with_caution": "Use with caution", "not_recommended": "Not recommended"}
# Colour backs up the verdict word and never replaces it.
TONE = {"strong_candidate": (22, 120, 70), "worth_discussing": (30, 90, 160), "use_with_caution": (170, 110, 0), "not_recommended": (170, 40, 40)}
INK, MUTED, RULE = (25, 25, 30), (95, 95, 105), (210, 210, 215)

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
        self.cell(0, 5, self.t(self.footer_text), align="L")
        self.cell(0, 5, f"{self.page_no()}/{{nb}}", align="R")

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

    def rule(self):
        self.set_draw_color(*RULE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)


def _pipeline_line(notes: str) -> str:
    """What the upstream drug pipeline said about this drug, in one line."""
    try:
        n = json.loads(notes) if notes else {}
    except ValueError:
        return ""
    if not isinstance(n, dict):
        return ""
    parts = [n.get("pipeline", "")]
    if "rank" in n:
        parts[0] += f" #{n['rank']}"
    if n.get("disposition"):
        parts.append(n["disposition"])
    score = n.get("internal_ranking_score", n.get("score"))
    if isinstance(score, (int, float)):
        parts.append(f"graph score {score:.3f}")
    return " · ".join(p for p in parts if p)


def render(report: dict) -> bytes:
    pid = report["patient_id"]
    pdf = _PDF(f"Drug assessment · {pid} · run {report['run_id']} · research aid for a clinician, not medical advice")
    pdf.alias_nb_pages()
    pdf.add_page()

    pdf.font(20, "B")
    pdf.multi_cell(0, 9, pdf.t(f"Drug assessment: {pid}"))
    pdf.font(8.5, "", MUTED)
    pdf.multi_cell(0, 4.5, pdf.t(f"{report['created_at'][:16].replace('T', ' ')} UTC  ·  run {report['run_id']}  ·  target profiles from {report['research_run_id'] or 'none'}  ·  "
                                 f"{report['models'].get('orchestrator', '')} + {report['models'].get('researcher', '')}"))
    pdf.ln(3)

    pdf.set_fill_color(248, 240, 222)
    pdf.font(9, "B")
    pdf.multi_cell(0, 6, pdf.t("Research aid for a clinician, not medical advice. Every drug here needs clinical review before use."), fill=True, padding=(1.5, 3))
    pdf.ln(3)

    pdf.heading("Summary")
    pdf.para(report["summary"])

    pdf.heading("Ranking")
    pdf.font(8.5)
    pdf.set_fill_color(247, 247, 250)  # zebra rows use the current fill colour
    head = FontFace(emphasis="BOLD", fill_color=(236, 236, 240))
    with pdf.table(col_widths=(7, 30, 30, 10, 35, 60), text_align=("RIGHT", "LEFT", "LEFT", "RIGHT", "LEFT", "LEFT"),
                   headings_style=head, line_height=4.6, padding=1.2, borders_layout="HORIZONTAL_LINES",
                   cell_fill_color=(247, 247, 250), cell_fill_mode="ROWS") as table:
        table.row([pdf.t(x) for x in ("#", "Drug", "Verdict", "Fit", "Evidence", "Matches target profiles")])
        for d in report["drugs"]:
            row = table.row()
            row.cell(str(d["rank"]))
            row.cell(pdf.t(d["name"]), style=FontFace(emphasis="BOLD"))
            row.cell(pdf.t(VERDICT[d["verdict"]]), style=FontFace(color=TONE[d["verdict"]], emphasis="BOLD"))
            row.cell(f"{d['fit_score']:.2f}")
            row.cell(pdf.t(d["evidence_strength"].replace("_", " ")))
            row.cell(pdf.t("; ".join(d["matched_profiles"]) or "-"))
    pdf.ln(2)

    pdf.heading("How they compare")
    pdf.para(report["comparison_notes"])

    for d in report["drugs"]:
        dz = d["dossier"]
        pdf.add_page() if pdf.get_y() > pdf.h - 80 else pdf.rule()
        pdf.font(15, "B")
        pdf.multi_cell(0, 7, pdf.t(f"{d['rank']}. {d['name']}"))
        pdf.font(10, "B", TONE[d["verdict"]])
        pdf.multi_cell(0, 5.5, pdf.t(f"{VERDICT[d['verdict']]}  ·  fit {d['fit_score']:.2f}  ·  evidence: {d['evidence_strength'].replace('_', ' ')}"))
        pdf.ln(1.5)
        origin = _pipeline_line(d.get("pipeline_notes", ""))
        if origin:
            pdf.para(f"Discovery pipeline: {origin}", 8.5, "I", MUTED)
        pdf.para(d["rationale"])
        if dz.get("mechanism"):
            pdf.para(f"Mechanism: {dz['mechanism']}", 9, "", MUTED)
        pdf.bullets("Helps with", d["symptoms_addressed"])
        pdf.bullets("Pros", d["pros"])
        pdf.bullets("Cons", d["cons"])
        pdf.bullets("Risks for this patient", d["patient_specific_risks"])
        pdf.bullets("Monitor", d["monitoring"])
        pdf.bullets("ALS trials", dz.get("als_trials", []))
        facts = [f"{k}: {v}" for k, v in (("Formulations", ", ".join(dz.get("formulations", []))), ("CNS penetration", dz.get("cns_penetration")),
                                           ("Availability", dz.get("availability")), ("Cost", dz.get("cost"))) if v]
        pdf.bullets("Practicalities", facts)
        urls = list(dict.fromkeys(d["source_urls"] + [s["url"] for s in dz.get("sources", [])]))[:8]
        if urls:
            pdf.font(8.5, "B")
            pdf.multi_cell(0, 4.5, "Sources")
            pdf.font(7.5, "", (30, 80, 160))
            for u in urls:
                pdf.multi_cell(0, 3.9, pdf.t(u), link=u)
            pdf.ln(1.5)

    if report["open_questions"]:
        pdf.rule()
        pdf.heading("Open questions for the clinician")
        pdf.bullets("", report["open_questions"])

    pdf.heading("About this report", 10)
    web = report.get("web", {})
    notes = list(report["warnings"]) + [
        f"Drugs came from: {Path(report['drugs_source']).name if report['drugs_source'] != 'inline' else 'a list given directly'}.",
        "Each drug was researched on the web by a separate agent that never saw the patient's record; "
        f"{web.get('researcher_searches', 0)} searches, {web.get('followup_questions', 0)} follow-up questions "
        f"({web.get('query_redactions', 0)} identifiers removed from them), {web.get('dropped_urls', 0)} unsupported citations dropped.",
    ]
    pdf.font(8.5, "", MUTED)
    for n in notes:
        pdf.multi_cell(0, 4.4, pdf.t(n))
    return bytes(pdf.output())


if __name__ == "__main__":
    src = Path(sys.argv[1])
    out = src.with_name(src.name.replace(".drugs.json", "") + ".drugs.pdf") if src.name.endswith(".drugs.json") else src.with_suffix(".pdf")
    out.write_bytes(render(json.loads(src.read_text(encoding="utf-8"))))
    print(out)
