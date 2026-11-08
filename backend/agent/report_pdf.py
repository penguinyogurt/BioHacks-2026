"""DrugReport → PDF, laid out as a scientific paper (IMRaD).

  python -m agent.report_pdf agent/runs/<run_id>.drugs.json   # → same name, .pdf

Title · authors (Addo Labs) · structured front matter · Abstract · 1 Introduction ·
2 Background (case) · 3 Materials and methods · 4 Results (Table 1 + one subsection per
candidate) · 5 Discussion (findings, limitations, conclusions) · Declarations ·
References (Vancouver, numbered in order of first citation, as resolved by assess.py).

The introduction and methods are fixed prose describing the pipeline; they cite nothing,
because every reference in the list is a PubMed record the run itself verified. Run-specific
text (abstract, per-drug assessments, limitations) comes from the report verbatim.

Uses a system serif TrueType font (Times New Roman / DejaVu Serif), then a sans one, so
dashes, arrows and Greek letters render. If none is found it falls back to core Times and
replaces those characters with ASCII.
"""
import json
import logging
import re
import sys
from datetime import datetime
from pathlib import Path

from fpdf import FPDF
from fpdf.fonts import FontFace

logging.getLogger("fontTools").setLevel(logging.WARNING)  # subsetting chatter

VERDICT = {"strong_candidate": "Strong candidate", "worth_discussing": "Worth discussing", "use_with_caution": "Use with caution", "not_recommended": "Not recommended"}
EVIDENCE = {"approved_for_als": "Approved for ALS", "human_als_positive": "Human ALS, positive", "human_als_mixed_or_negative": "Human ALS, mixed/negative",
            "preclinical_als": "Preclinical ALS", "mechanistic_only": "Mechanistic only"}
BBB = {"very_low": "Very low", "low": "Low", "moderate": "Moderate", "high": "High", "unknown": "Unknown"}
INK, MUTED, RULE, LINK = (20, 20, 24), (95, 95, 102), (160, 160, 166), (30, 70, 150)
BRAND = "Addo Labs"
KEYWORDS = "amyotrophic lateral sclerosis; drug repurposing; knowledge graph; DRKG; focused ultrasound; blood–brain barrier; multi-agent systems"

_FONTS = [  # (regular, bold, italic): serif first, the paper's face
    ("C:/Windows/Fonts/times.ttf", "C:/Windows/Fonts/timesbd.ttf", "C:/Windows/Fonts/timesi.ttf"),
    ("/System/Library/Fonts/Supplemental/Times New Roman.ttf", "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf", "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/ariali.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
]
_ASCII = str.maketrans({"–": "-", "—": "-", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "×": "x", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "-", "α": "alpha", "β": "beta", "γ": "gamma", "κ": "kappa", "µ": "u", "μ": "u", "²": "2", "³": "3", "±": "+/-", "−": "-", "‖": "||", "₂": "2", "\u00a0": " "})
BODY = 10.5  # pt


class _PDF(FPDF):
    def __init__(self, running_head: str):
        super().__init__(format="Letter")
        self.running_head = running_head
        self.family, self.unicode = "Times", False
        for reg, bold, ital in _FONTS:
            if all(Path(p).exists() for p in (reg, bold, ital)):
                self.add_font("Body", "", reg)
                self.add_font("Body", "B", bold)
                self.add_font("Body", "I", ital)
                self.family, self.unicode = "Body", True
                break
        self.set_margins(25, 22, 25)
        self.set_auto_page_break(True, 22)

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

    def header(self):
        if self.page_no() == 1:
            return
        self.set_y(11)
        self.font(8, "I", MUTED)
        self.cell(0, 4, self.t(self.running_head), align="L")
        self.cell(0, 4, str(self.page_no()), align="R")
        self.set_y(self.t_margin)

    def footer(self):
        if self.page_no() != 1:
            return
        self.set_y(-14)
        self.font(8, "", MUTED)
        self.cell(0, 4, self.t(f"{BRAND} · page 1 of {{nb}}"), align="C")

    def section(self, text: str):
        """Numbered first-level heading, e.g. '3. Materials and methods'."""
        if self.get_y() > self.h - 50:
            self.add_page()
        self.ln(4)
        self.font(12, "B")
        self.multi_cell(0, 6, self.t(text))
        self.ln(1.5)

    def sub(self, text: str):
        """Second-level heading, e.g. '3.2 Target-profile generation'."""
        if self.get_y() > self.h - 40:
            self.add_page()
        self.ln(1.5)
        self.font(BODY, "I")
        self.multi_cell(0, 5.2, self.t(text))
        self.ln(0.8)

    def para(self, text: str, size: float = BODY, style: str = "", color=INK, align: str = "J", indent: float = 0):
        if not text:
            return
        self.font(size, style, color)
        if indent:
            self.set_x(self.l_margin + indent)
        self.multi_cell(self.epw - indent, size * 0.5, self.t(text), align=align)
        self.ln(1.6)

    def runin(self, label: str, text: str):
        """Paragraph with a bold run-in label: '**Safety.** Text…'."""
        if not text:
            return
        self.font(BODY)
        body = re.sub(r"(\*\*|__|--|~~)", lambda m: m.group(0)[0] + " " + m.group(0)[1], self.t(text))  # no stray markdown
        self.multi_cell(0, BODY * 0.5, f"**{self.t(label)}.** {body}", align="J", markdown=True)
        self.ln(1.2)

    def caption(self, text: str):
        self.font(9, "")
        self.multi_cell(0, 4.5, self.t(text), align="J", markdown=True)
        self.ln(1)

    def rule(self, gap: float = 3):
        self.set_draw_color(*RULE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(gap)


def _when(iso: str) -> str:
    """'2026-11-08T07:36:22+00:00' → '8 November 2026' in local time."""
    try:
        t = datetime.fromisoformat(iso).astimezone()
    except ValueError:
        return iso[:10]
    return f"{t.day} {t:%B} {t.year}"


def _title(pt: dict) -> str:
    onset = (pt.get("headline") or "").split(",")[0].strip().lower()
    onset = onset.replace(" onset", "-onset") + " " if onset.endswith("onset") else ""
    return f"Patient-specific drug repurposing candidates for {onset}amyotrophic lateral sclerosis: a multi-agent knowledge-graph and literature analysis"


def _names(xs: list[str]) -> str:
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


_NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]


def _n(k: int) -> str:
    """Numbers under 13 in words, per scientific style; larger ones as numerals."""
    return _NUM[k] if 0 <= k < len(_NUM) else str(k)


def _third_person(text: str) -> str:
    """Drop the agent's first-person process asides ('I did not run extra searches…'): a paper reports
    what was done, in the third person. Older runs were written before the prompt asked for that."""
    sentences = re.split(r"(?<=[.!?])\s+", text or "")
    return " ".join(s for s in sentences if not re.match(r"I\s|I'", s)).strip()


def render(report: dict) -> bytes:
    pt = report.get("patient") or {}
    name = pt.get("name") or report["patient_id"]
    drugs = report["drugs"]
    candidates = [d for d in drugs if d["verdict"] != "not_recommended"]
    excluded = [d for d in drugs if d["verdict"] == "not_recommended"]
    web = report.get("web", {})
    method = report.get("method", "")
    m = re.match(r"Profiles: (.*?)\. ", method)
    profiles = [p.strip() for p in m.group(1).split("·")] if m else []
    m = re.search(r"Ranking criteria: (.*?)\.?$", method)
    criteria = m.group(1) if m else ""
    # Live stage 3 (agent/drkg.py) hands the assessment <run>.candidates.json; runs from before that rename used .drugs.json.
    from_graph = "knowledge graph" in method or str(report.get("drugs_source", "")).endswith((".candidates.json", ".drugs.json"))
    models = report.get("models", {})

    pdf = _PDF(f"{BRAND} · Drug repurposing report · {name}")
    pdf.alias_nb_pages()
    pdf.add_page()

    # ---------------------------------------------------------------- front matter
    pdf.font(8.5, "B", MUTED)
    pdf.multi_cell(0, 4.5, pdf.t("RESEARCH REPORT · PATIENT-SPECIFIC ANALYSIS"), align="C")
    pdf.ln(3)
    pdf.font(16, "B")
    pdf.multi_cell(0, 7.4, pdf.t(_title(pt)), align="C")
    pdf.ln(3)
    pdf.font(11.5)
    pdf.multi_cell(0, 6, pdf.t(BRAND), align="C")
    pdf.font(9, "I", MUTED)
    pdf.multi_cell(0, 4.6, pdf.t(f"{BRAND}, ALS drug-repurposing pipeline · Report {report['run_id']} · {_when(report['created_at'])}"), align="C")
    pdf.ln(5)

    # ------------------------------------------------------------------- abstract
    pdf.rule(3)
    pdf.font(BODY, "B")
    pdf.multi_cell(0, 5.4, pdf.t("Abstract"))
    pdf.ln(0.6)
    pdf.para(_third_person(report["summary"]))
    pdf.font(9.5)
    pdf.multi_cell(0, 4.8, f"**{pdf.t('Keywords:')}** {pdf.t(KEYWORDS)}", markdown=True)
    pdf.ln(2)
    pdf.rule(1)

    # --------------------------------------------------------------- 1 introduction
    pdf.section("1. Introduction")
    pdf.para("Amyotrophic lateral sclerosis (ALS) is a progressive neurodegenerative disease of upper and lower motor neurons. "
             "Approved disease-modifying treatments are few and their benefit is modest, and the disease is heterogeneous in "
             "onset, genetics and rate of progression, so a single treatment strategy rarely fits every patient. Repurposing drugs "
             "that are already approved or clinically characterised can shorten the path to testing, but many candidate compounds "
             "reach the central nervous system poorly because of the blood–brain barrier (BBB).")
    pdf.para("Magnetic resonance-guided focused ultrasound (MRgFUS) can open the BBB transiently and locally, which may widen the "
             "set of compounds worth considering to include those that do not cross it unaided. This report applies an automated, "
             "patient-specific pipeline to one patient: it derives the therapeutic profiles that matter for this case, retrieves "
             "matching compounds from a biomedical knowledge graph, and assesses each against the literature and the patient's "
             "record. Its purpose is hypothesis generation for discussion with the care team.")

    # ----------------------------------------------------------------- 2 background
    pdf.section("2. Background")
    pdf.sub("2.1 Case presentation")
    pdf.para(f"Patient record: {name}" + (f" ({pt['headline']})." if pt.get("headline") else "."))
    for line in pt.get("context", []):
        pdf.para(line, indent=4, align="L")
    pdf.sub("2.2 Delivery assumption")
    pdf.para("All candidates were assessed under the assumption that MRgFUS-mediated BBB opening is available to the patient. Drugs "
             "that cross the BBB poorly were therefore not excluded on that basis; instead, the expected gain from MRgFUS delivery "
             "was scored for each.")

    # ------------------------------------------------------------------- 3 methods
    pdf.section("3. Materials and methods")
    pdf.sub("3.1 Data and privacy")
    pdf.para("The structured patient record was read only by the orchestrating agent. Every downstream agent received a "
             "sanitised brief from which names, dates, identifiers, laboratory values and current medication names had been "
             "removed and translated into pharmacological constraints; per-drug literature researchers received only the drug name.")
    pdf.sub("3.2 Target-profile generation")
    n_prof = f" ({len(profiles)}: {_names(profiles)})" if profiles else ""
    pdf.para("The orchestrator selected the disease mechanisms and symptoms most relevant to the patient from a fixed catalogue of "
             f"ALS criteria and wrote one research brief per criterion{n_prof}. Each brief was assigned to an independent "
             "sub-agent, run in parallel, that searched PubMed, ClinicalTrials.gov and Open Targets and returned an ideal drug "
             "profile: therapeutic goal, mechanism of action, molecular targets, pathways and required or excluded properties, "
             "without naming drugs. Cited PubMed and ClinicalTrials.gov identifiers were checked against those databases, and "
             "profiles left without verifiable evidence were discarded.")
    if from_graph:
        pdf.sub("3.3 Knowledge-graph candidate retrieval")
        pdf.para("Candidate compounds were retrieved from the Drug Repurposing Knowledge Graph (DRKG) using its pretrained TransE "
                 "(L2) embeddings, 400 dimensions. For each target gene g in a profile, a query vector q = e(g) − r(DrugBank target) "
                 "was formed, and every DrugBank compound c was scored by the Euclidean distance ‖e(c) − q‖₂; a profile's score for "
                 "a compound was the minimum over its genes. The best-scoring compounds were taken from each profile in turn, "
                 "excluding entries without a searchable name.")
    k = 4 if from_graph else 3  # 3.3 is the DRKG subsection when there is one
    pdf.sub(f"3.{k} Evidence synthesis and ranking")
    pdf.para(f"Each of the {len(drugs)} candidates was researched by a separate agent using web search, with PubMed records preferred "
             f"for scientific claims ({web.get('researcher_searches', 0)} searches in total; {web.get('papers_seen', 0)} PubMed "
             "records considered). The orchestrator then assessed every candidate against the full patient record and the target "
             "profiles, assigning a verdict and a score from 0 to 100" + (f" from the weighted criteria {criteria}." if criteria else ".") +
             f" Citations were accepted only for PubMed identifiers returned by a search; {web.get('dropped_citations', 0)} "
             f"unverifiable citations and {web.get('dropped_urls', 0)} unsupported URLs were removed.")
    pdf.para(f"Run-specific parameters: {method}" if method else "", size=9.5, color=MUTED)
    pdf.sub(f"3.{k + 1} Software")
    pdf.para("The pipeline was implemented in Python with LangGraph and FastAPI. Large language models were used as tools for "
             f"orchestration and ranking ({models.get('orchestrator', 'unspecified')}) and for literature research "
             f"({models.get('researcher', 'unspecified')}); they are not authors of this report.")

    # ------------------------------------------------------------------- 4 results
    pdf.section("4. Results")
    pdf.sub("4.1 Overview")
    novel = [d["name"] for d in candidates if d.get("novelty") == "novel"]
    pdf.para(f"Of the {_n(len(drugs))} drugs assessed, {_n(len(candidates))} were retained as candidates for discussion and "
             f"{_n(len(excluded))} were excluded for this patient (Table 1)." +
             (f" Of the retained candidates, {_n(len(novel))} have no human ALS trial to date ({_names(novel)})." if novel else ""))
    if pdf.get_y() > pdf.h - 80:
        pdf.add_page()
    pdf.caption("**Table 1.** Candidate drugs ranked by patient-specific score (0–100). BBB, unaided blood–brain barrier penetration.")
    pdf.font(8.6)
    with pdf.table(col_widths=(12, 28, 43, 12, 25, 15, 30), text_align=("CENTER", "LEFT", "LEFT", "CENTER", "LEFT", "LEFT", "LEFT"),
                   line_height=4.3, borders_layout="HORIZONTAL_LINES", headings_style=FontFace(emphasis="BOLD"),
                   padding=1.2, first_row_as_headings=True) as table:
        table.row([pdf.t(h) for h in ("Rank", "Drug", "Class", "Score", "Assessment", "BBB", "ALS evidence")])
        for i, d in enumerate(candidates + excluded, 1):
            table.row([str(i), pdf.t(d["name"]), pdf.t(d.get("drug_class", "")), str(d.get("score", "–")), pdf.t(VERDICT[d["verdict"]]),
                       pdf.t(BBB.get(d.get("bbb_penetration"), "Unknown")), pdf.t(EVIDENCE.get(d.get("evidence_strength"), ""))])
    pdf.ln(2)

    pdf.sub("4.2 Retained candidates")
    for i, d in enumerate(candidates, 1):
        if pdf.get_y() > pdf.h - 55:
            pdf.add_page()
        pdf.font(BODY, "B")
        pdf.multi_cell(0, 5.4, pdf.t(f"4.2.{i} {d['name']}"))
        bits = [d.get("drug_class", ""), d.get("molecular_size", ""), f"MRgFUS: {d['fus_delivery']}" if d.get("fus_delivery") else "",
                ("Matched profiles: " + "; ".join(d["matched_profiles"])) if d.get("matched_profiles") else "",
                f"Score {d.get('score', '–')}/100 · {VERDICT[d['verdict']]}"]
        pdf.para(" · ".join(b for b in bits if b and b != "unknown"), size=9, style="I", color=MUTED, align="L")
        pdf.para(d["rationale"])
        for label in ("evidence", "safety", "acceptance", "availability", "cost"):
            pdf.runin(label.capitalize(), d.get(label, ""))
        pdf.ln(1.5)

    if excluded:
        pdf.sub("4.3 Excluded candidates")
        for d in excluded:
            pdf.runin(d["name"], d.get("headline", ""))

    # ---------------------------------------------------------------- 5 discussion
    pdf.section("5. Discussion")
    pdf.sub("5.1 Principal findings")
    top = [f"{d['name']} ({d.get('score', '–')}/100)" for d in candidates[:3]]
    pdf.para((f"The highest-ranked candidates for this patient were {_names(top)}. " if top else
              "No candidate was retained for this patient. ") +
             "Rankings weigh the expected benefit of MRgFUS delivery and the mechanistic fit to the patient's target profiles most "
             "heavily, then safety, acceptability, availability and cost; they are relative within this candidate set and are not "
             "estimates of efficacy.")
    pdf.sub("5.2 Limitations")
    pdf.para((_third_person(report.get("limitations", "")) + " " if report.get("limitations") else "") +
             "Knowledge-graph similarity reflects graph structure, not demonstrated efficacy. CNS exposure after focused-ultrasound "
             "opening has not been measured for these drugs, and any use would require a clinical trial or a physician-led protocol. "
             "Literature research was automated and may have missed relevant evidence.")
    notes = [w for w in report.get("warnings", []) if not w.startswith("Research aid")]
    for n in notes:
        pdf.para(n, size=9.5, color=MUTED)
    pdf.sub("5.3 Conclusions")
    pdf.para("This analysis identifies candidates for discussion with the care team. It is hypothesis-generating and does not "
             "constitute a treatment recommendation.")

    # ---------------------------------------------------------------- declarations
    pdf.section("Declarations")
    pdf.runin("Intended use", "Research aid for clinicians; not medical advice.")
    pdf.runin("Use of AI", "The analyses and the run-specific text in the Abstract, Results and Limitations were generated by "
                           "language-model agents, with citations restricted to verified PubMed records. The report was not peer reviewed.")
    pdf.runin("Data availability", f"Research run {report.get('research_run_id') or 'not recorded'}; assessment run {report['run_id']}"
              + (f"; traces in LangSmith project {report['langsmith_project']}" if report.get("langsmith_project") else "") + ".")

    # ----------------------------------------------------------------- references
    if report.get("references"):
        pdf.section("References")
        for r in report["references"]:
            if pdf.get_y() > pdf.h - 30:
                pdf.add_page()
            pdf.font(9.2)
            pdf.multi_cell(0, 4.5, pdf.t(f"{r['n']}. {r['citation']}"))
            pdf.set_x(pdf.l_margin + 5)
            pdf.font(8.4, "", LINK)
            pdf.multi_cell(pdf.epw - 5, 4, pdf.t(r["url"]), link=r["url"])
            pdf.ln(1.4)
    return bytes(pdf.output())


if __name__ == "__main__":
    src = Path(sys.argv[1])
    out = src.with_name(src.name.replace(".drugs.json", "") + ".drugs.pdf") if src.name.endswith(".drugs.json") else src.with_suffix(".pdf")
    out.write_bytes(render(json.loads(src.read_text(encoding="utf-8"))))
    print(out)
