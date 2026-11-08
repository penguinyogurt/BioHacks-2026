# Discovery pipeline — FUS-enabled drug repurposing

Owner: Jeremy. Status: **scripted demo built** on `main`
(`frontend/src/components/discovery/`, `frontend/src/lib/pipeline.ts`).

Recorded 2026-11-07 from Jeremy's pitch, plus what's actually in the code.
Where the two differ, the code wins and this file says so.

---

## 1. The pitch

> The blood–brain barrier was the biggest barrier to drug delivery for ALS.
> With focused-ultrasound MRI from Sunnybrook, we can now look into new drugs
> that couldn't penetrate the BBB that can potentially reduce symptoms,
> develop a cure, or increase life expectancy.

**The move is an inversion.** Every repurposing screen for a CNS disease
treats BBB permeability as a filter and throws away what can't cross. If
MRgFUS can open the barrier focally and temporarily, that discarded set
becomes the interesting one — it has been excluded on a delivery constraint,
not on biology.

This is the strongest framing the project has had, because the thing it
proposes to search is a set nobody has had a reason to search.

### It connects to work already in this repo

`data/pipeline.json` carries a **graveyard partition**: every drug that
failed a human ALS trial, split into

- `never_arrived` — predicted barrier-negative, so it may never have reached
  the tissue at the dose that mattered, and
- `arrived_failed` — predicted barrier-positive, got there, still failed.

**`never_arrived` is, by construction, the candidate pool this pitch is
about.** A drug that failed because it never arrived is the one worth
re-asking under FUS. That partition was built for the old elimination funnel;
it turns out to be the input to the new pipeline. Nobody has to rebuild it.

> **Checked 2026-11-07 against Neo's real `pipeline.json`
> (`cursor/pipeline-graph-ui`):** same BBB model, so the sets are comparable —
> but the bucket is inflated. 21 of the 24 `never_arrived` drugs have **no BBB
> prediction** (biologics or out of domain) and were filed there by default
> (`src/merge.py:211-214`). Only ceftriaxone, pentoxifylline and pioglitazone
> are predicted BBB-negative. Say "3 predicted never-arrived, 21 we can't
> call" on stage, not "24". The bigger, honest number for this pitch is the
> funnel's: **1,593 of 3,791 approved drugs predicted BBB-negative** (plus 847
> the model declines to call). That is the FUS-unlocked pool.

---

## 2. The pipeline

Jeremy's five stages, as pitched and as coded in `STAGES`:

| # | Stage | What it does | Tools |
|---|---|---|---|
| 1 | `analysis` | An agent reads the patient record and derives the characteristics of the ideal drug for *this* person | NCBI, ClinVar, Open Targets |
| 2 | `profiles` | The same agent runs **5× in parallel**, each producing a slightly different ideal-drug profile | — |
| 3 | `embedding` | Each profile → vector in the **DRKG** embedding space → cosine search over compounds | TransE over DRKG |
| 4 | `research` | A research agent with open web search ranks the top matches for this patient | web search |
| 5 | `report` | Cited report: each drug, its effects, and the new potential FUS gives it | — |

**Stage 3 has a gap in the pitch as worded.** "The same embedding model used
in DRKG" is TransE over *entities* — it has no vector for a sentence. A
profile only gets a DRKG vector once it is written as DRKG entities (genes,
mostly). The profiles in `PROFILES` already list target genes, so: map them
to `Gene::<Entrez>` ids, average their vectors, cosine against compound
vectors. Neo's `src/drkg.py` already loads these embeddings.

Running the profile agent five times is the part worth defending. One agent
gives you one opinion; five give you a spread, and a compound that surfaces
across several profiles is a different kind of hit from one that surfaces
once. Say that out loud in the pitch — it reads as rigour, not as padding.

### Ranking dimensions

Not just biological fit. Each candidate is scored on:

- **Cost** of the drug or treatment
- **Availability** — does it exist in this country, and what do regulations allow
- **User acceptance** — would this patient consent, how standardised is it
- **Safety** — side effects against existing conditions and current medication

Plus, in the code, the pair that carries the whole argument: **`bbbAlone`**
vs **`withFus`** per candidate ("Very low" → "Requires BBB opening";
"Low" → "Motor-cortex delivery plausible"). That column *is* the thesis. It
should be the most visually prominent thing in the report.

---

## 3. What's actually built

`runDemoPipeline` replays **fixed events on timers**. Nothing calls NCBI,
no embedding runs, no agent executes. The UI labels the run "Simulated" and
the module header says every output is illustrative.

This is the right call for a 90-second demo and it should stay — but it
means **the honest claim is "here is the system we designed", not "here is
a system that found these drugs".** The sample patient (`A-0417`, bulbar
onset, 14 months, ALSFRS 38, Toronto/OHIP, `fusEligible: true`) and its
candidates are hand-written.

A live backend only has to emit the same `PipelineEvent`s. That's a clean
seam; don't let anyone collapse it under time pressure.

---

## 4. Open questions — these need people, not agents

1. **Is this the product, or is Motus?** `main` currently ships a landing
   page and a longitudinal monitoring dashboard (speech/typing/handwriting
   vs personal baseline) *and* this discovery pipeline. They share a sidebar
   and nothing else. One demo, 90 seconds — a judge can follow one argument.
   **This is the most important open question in the repo.**
2. **What is it called?** `theme.ts`, `pipeline.ts` and `report.tsx` say
   **Addo Labs**. The landing page says **motus**. Pick one today.
3. **Does the old elimination funnel feed this?** The discovery module is
   self-contained and never reads `data/pipeline.json`. Either wire the
   graveyard in as the candidate pool (§1 — cheap, and it makes the two
   tracks one story) or retire the contract and say so.
4. **Answered → [`FUS_RESEARCH.md`](FUS_RESEARCH.md).** Was: **Can we cite the Sunnybrook FUS work accurately?** The claim rests on
   it. Get real citations for BBB opening in ALS or in neurodegeneration
   generally, and be precise about what has been shown in humans versus what
   is proposed. Mark anything unverified as unverified — a judge who knows
   the field will ask.
5. **Does FaceCheck still fit?** See `FACECHECK_SPEC.md` §7.

---

## 5. Risks worth naming before a judge does

- **Safety inverts too.** Opening the BBB for a drug also opens it for
  everything else circulating, and the drugs this unlocks were often not
  designed for CNS exposure. "It can now get in" is not "it is now safe
  once it's in." Having an answer here is a strength.
- **The ranking is the claim.** Cosine similarity in DRKG plus an LLM's
  reading is a hypothesis generator, not evidence. Frame the output as "what
  to investigate next", never as a recommendation.
- **Nothing is validated.** Same rule as FaceCheck: say so on every screen.
