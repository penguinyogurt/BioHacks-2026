# Frontend

Owned by E4. Reads `../data/pipeline.json` and nothing else — no imports from `src/`, no
other data files.

A hand-written 5-drug sample is already committed at `data/pipeline.json` with
`meta.is_sample: true`, so this can be built end to end before any model finishes.
`python -m src.contract` validates any file against the frozen shape.
