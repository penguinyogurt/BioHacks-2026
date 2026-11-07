# Patient-constrained drug repurposing for ALS

**BioHacks 2026.** Rank approved drugs against ALS biology, then disqualify
the ones that are unsafe or unusable for one specific patient.

Most repurposing work stops at "this drug plausibly treats this disease". This
asks the next question: *can this person actually take it?* The constraints
come from a chart — what he can swallow, what his breathing tolerates, what
collides with his current prescription — not from a biobank genotype.

The second output is the one we care about most: every drug that failed a
human ALS trial, split into **never reached the target tissue** versus
**reached it and still failed**. That partition hasn't been published for ALS.

---

## Run it

```bash
cd app && npm install && npm run dev
```

Opens on <http://localhost:5173>. It renders immediately against the
hand-written sample in `data/pipeline.json` — no Python, no models, no data
download needed. The UI shows a **"Sample data"** badge until `merge.py`
produces a real file with `meta.sample: false`.

Before pushing:

```bash
npm run check --prefix app     # typecheck + contract tests
```

## How it fits together

Five stages, each removing candidates for a stated reason:

```
4,805 approved drugs
  → linked to ALS biology       (knowledge graph)
  → can reach the target        (blood–brain barrier model)
  → safe and usable for Alex    (patient filter)  ← the contribution
  → not already failed          (trial history)
```

Four Python modules each write one JSON file to `data/`. Nobody imports
anybody else's code — integration happens through files, so all four can be
built at once and a broken module doesn't block the rest. `merge.py` joins
them on InChIKey into `data/pipeline.json`, and the frontend reads that file
and nothing else.

**[`docs/CONTRACT.md`](docs/CONTRACT.md)** is what you need if you're writing
one of those modules. Validate your output without running the frontend:

```bash
npm run validate --prefix app -- data/pipeline.json
```

## Repo layout

| Path | What |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Working agreement for humans and agents. Read this first. |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The `pipeline.json` contract, annotated. |
| `data/pipeline.json` | The frozen contract + a sample that exercises every UI edge case. |
| `app/` | Frontend — Vite, React 19, TypeScript, Tailwind v4, shadcn/ui. |
| `app/src/lib/contract.ts` | zod schema. The only place the UI learns the data shape. |
| `tools/record-demo.mjs` | Drives Playwright through the whole story and writes `demo/*.webm`. |
| `.claude/skills/` | 21 pinned design/frontend skills, shared via `skills-lock.json`. |

Record a fresh demo video any time:

```bash
node tools/record-demo.mjs
```

## Data sources

[DRKG](https://github.com/gnn4dr/DRKG) knowledge graph ·
[B3DB](https://github.com/theochem/B3DB) barrier permeability labels ·
[DrugCentral](https://drugcentral.org) targets, formulations and adverse
events · [repoDB](https://unmtid-shinyapps.net/shiny/repodb/) approved and
failed indications · [Health Canada DPD](https://health-products.canada.ca/dpd-bdpp/)
availability · [NEALS](https://neals.org/als-researchers/historical-trial-data)
historical trial data.

## A caveat we say out loud

Knowledge-graph repurposing is established work — TxGNN does disease-level
contraindications, repoDB has used failed trials as negatives since 2017, and
patient-level KG repurposing was published in 2025 using biobank genotypes.
Our difference is the *axis* of personalization: those use molecular data
because that's what biobanks hold. We use what's in a chart.

Research prototype. Not clinical advice.
