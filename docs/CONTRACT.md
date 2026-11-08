# The `backend/data/pipeline.json` contract

One file. The frontend reads it and nothing else. `merge.py` writes it.

The **executable** definition is [`backend/contract/contract.ts`](../backend/contract/contract.ts)
— a zod schema. This document is the prose version with the reasoning. Where
they disagree, the schema wins; fix this file.

## Check your output

```bash
npm run validate --prefix backend/contract -- backend/data/pipeline.json
```

Exits 0 with a summary, or 1 with a list of exactly what's wrong and where.
You do not need node knowledge or the frontend running to use it.

## Shape

### `patient_profile` — optional

The chart values the patient filter derives from. Optional so `merge.py` isn't
blocked on it, but the UI shows the person before the ranked list, and these
numbers are what make stage 4 read as clinically grounded rather than as a
plausible-looking rule table.

```jsonc
"patient_profile": {
  "display_name": "Alex",
  "summary": "Limb-onset ALS, diagnosed 2026. On riluzole 50 mg twice daily…",
  "findings": [
    {
      "label": "Respiratory function",
      "value": "FVC 76% sitting, 61% supine",
      "implication": "Already reduced and declining; a respiratory depressant is not survivable here",
      "drives": ["respiratory"]          // rule ids in filters[] this finding causes
    }
  ]
}
```

`drives` is what puts the link from a chart number to a rule id on screen
instead of in the pitch. Keep the ids identical to the `rule` values you emit
in `filters[]`.

### `meta`

```jsonc
"meta": {
  "generated_at": "2026-11-08T04:12:00Z",  // ISO 8601
  "n_input": 4805,
  "patient": "alex_chen",
  "sample": true                           // see below
}
```

**`sample`** drives a visible badge in the UI reading "Sample data — not
pipeline output". Hand-written data must set it `true`. `merge.py` must set it
`false` (or omit it; it defaults to false). This exists so nobody demos
fabricated numbers believing they're real.

### `funnel`

One entry per stage, in order. Counts must be non-increasing — the validator
rejects a funnel that widens.

```jsonc
{ "stage": "kg_relevance",        // one of the five stage ids
  "label": "Linked to ALS biology",
  "count": 340,                   // how many SURVIVE this stage
  "eliminated": 4465,             // how many this stage removed
  "top_reason": "no path to ALS in graph" }   // or null
```

### `candidates`

**Volume: top 100 by `kg.score`, plus every drug eliminated at
`patient_filter` or `trial_history` regardless of rank.** Drugs cut earlier
exist only as funnel counts. This is a deliberate change from the original
spec: the full 4,805 makes a multi-megabyte file and an impossible exit
animation, while guaranteeing the stage-4 cuts are present keeps the
contribution fully visible.

```jsonc
{
  "id": "DB00230",
  "inchikey": "KBOPZPXVLCULAV-UHFFFAOYSA-N",  // the join key; also the React key
  "name": "pregabalin",
  "smiles": "CC(C)CC(CN)CC(=O)O",
  "kg":  { "score": 0.84, "rank": 5 },
  "path": [                                    // 2–3 hops, drug → … → ALS
    { "from": "pregabalin", "rel": "targets",         "to": "CACNA2D1" },
    { "from": "CACNA2D1",   "rel": "participates_in", "to": "Calcium signaling" },
    { "from": "Calcium signaling", "rel": "associated_with", "to": "ALS" }
  ],
  "bbb": {
    "prob": 0.93,                 // null when in_domain is false — see below
    "in_domain": true,
    "nearest_tanimoto": 0.71,
    "descriptors": { "mw": 159.2, "logp": -1.3, "tpsa": 63.3, "hbd": 2 }
  },
  "filters": [                    // ORDERED. Empty if cut before stage 4 ran.
    { "rule": "cyp1a2", "passed": true,
      "reason": "No CYP1A2 interaction; safe alongside his riluzole" }
  ],
  "verdict": "survived",          // or "eliminated"
  "eliminated_at": null           // stage id when eliminated, null when survived
}
```

Three rules the UI depends on, all enforced by the validator:

1. **`in_domain: false` → `prob: null`.** Below roughly 0.4 max Tanimoto to
   any training compound, the barrier model has no standing to predict.
   Emitting a probability anyway means the UI has to decide whether to trust
   it, and it won't — it renders the distance instead. Don't put a number
   there.
2. **`filters` is an ordered array, not a map.** The UI renders them in rule
   order and highlights the first failure as the decisive one. A map loses
   the order and the whole display falls apart.
3. **`verdict` and `eliminated_at` agree.** `eliminated` requires a stage;
   `survived` requires `null`.

Keep eliminated candidates in the array. The UI animates them out and the
tab filters read from them; dropping them loses both.

### `graveyard`

Hand-curated drugs that failed a human ALS trial. Aim for 20–30.

```jsonc
{ "name": "ceftriaxone",
  "year": 2014,
  "phase": "3",
  "bbb_prob": 0.41,
  "bucket": "arrived_failed",      // or "never_arrived"
  "note": "Raised glial glutamate transporter in models; no clinical benefit",
  "source_url": "https://neals.org/als-researchers/historical-trial-data" }
```

`source_url` must be a real URL — every name in the partition links to where
it came from.

### `validation`

Every metric is nullable so a half-finished run still renders. The UI simply
omits what's null.

```jsonc
"validation": {
  "riluzole_rank": 12,
  "edaravone_rank": 31,
  "bbb_roc_auc": 0.89,                       // scaffold split, not random
  "bbb_roc_auc_published_baseline": 0.91,    // B3clf, for comparison
  "negatives_in_top_50": 4,                  // our honest error rate
  "partition": { "never_arrived": 7, "arrived_failed": 11 }
}
```

**`partition` must agree with the actual `graveyard` bucket counts.** The
validator checks this, because it's the headline number and a mismatch puts a
wrong figure on the slide.

`negatives_in_top_50` being high is worth printing, not hiding. Self-reported
failure reads better than a flattering metric a judge pokes a hole in.

## Changing the contract

1. Update `backend/contract/contract.ts`.
2. Update the sample in `backend/data/pipeline.json` so it still validates.
3. Update this file.
4. `npm run check --prefix app`.
5. **Tell the team.** Four people write against this.
