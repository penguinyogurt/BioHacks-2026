/**
 * What the pipeline is made of.
 *
 * The stage and source entries describe the engineering, which doesn't come
 * out of `pipeline.json` — it IS the thing that produces it. The numbers that
 * do come from the run (AUC, partition, candidate counts) are derived from
 * the parsed data instead, so they can't drift from what's on screen.
 *
 * Dataset sizes are the figures each project publishes. If a module owner
 * changes a method, change its `method` line here in the same commit.
 */
import type { Pipeline } from "./contract";
import { num } from "./utils";

export type Stage = {
  id: string;
  module: string;
  title: string;
  writes: string;
  method: string;
  inputs: string[];
};

export type Source = {
  name: string;
  what: string;
  role: string;
  url: string;
  licence?: string;
};

export type Stat = { label: string; value: string; detail: string };

/**
 * The four modules. They do not import each other — each reads public data
 * and writes one JSON file, which is why four people can build them at once
 * and a broken one doesn't block the rest.
 */
export const STAGES: Stage[] = [
  {
    id: "kg_rank",
    module: "kg_rank.py",
    title: "Knowledge-graph ranking",
    writes: "data/kg_scores.json",
    method:
      "Scores the missing Compound–treats–ALS edge with a TransE embedding, then walks 2–3 hop paths back to ALS for the receipt.",
    inputs: ["DRKG"],
  },
  {
    id: "bbb_model",
    module: "bbb_model.py",
    title: "Blood–brain barrier model",
    writes: "data/bbb_scores.json",
    method:
      "LightGBM over Morgan fingerprints and physicochemical descriptors, split by Bemis–Murcko scaffold so similar molecules can't leak across train and test.",
    inputs: ["B3DB", "DrugCentral"],
  },
  {
    id: "patient_filter",
    module: "patient_filter.py",
    title: "Patient filter",
    writes: "data/patient_filter.json",
    method:
      "Deterministic rules read off one chart. Every rule returns a boolean and a reason a clinician would accept. No model, no training data.",
    inputs: ["DrugCentral", "Health Canada DPD"],
  },
  {
    id: "trial_history",
    module: "graveyard.py",
    title: "Trial history",
    writes: "data/graveyard.json",
    method:
      "Hand-curated human ALS trial failures with year and phase, flagged rather than silently dropped — and reused as the model's negative controls.",
    inputs: ["NEALS", "repoDB"],
  },
];

export const SOURCES: Source[] = [
  {
    name: "DRKG",
    what: "~97k nodes · 5.8M typed triples",
    role: "Drug, gene, pathway and disease relations, plus pretrained embeddings",
    url: "https://github.com/gnn4dr/DRKG",
  },
  {
    name: "B3DB",
    what: "7,982 compounds · 1,058 with numeric logBB",
    role: "Labelled blood–brain barrier permeability, the classifier's training set",
    url: "https://github.com/theochem/B3DB",
    licence: "CC0",
  },
  {
    name: "DrugCentral",
    what: "~4,805 approved substances · ~90k drug–adverse-event links",
    role: "Structures, targets, formulations and the adverse events the patient rules read",
    url: "https://drugcentral.org",
    licence: "CC BY-SA 4.0",
  },
  {
    name: "repoDB",
    what: "6,677 approved · 3,885 failed drug–disease pairs",
    role: "Prior art for using failed indications as labelled negatives",
    url: "https://unmtid-shinyapps.net/shiny/repodb/",
  },
  {
    name: "NEALS",
    what: "Historical ALS trial record",
    role: "Source for the graveyard — which drugs failed, in what year, at what phase",
    url: "https://neals.org/als-researchers/historical-trial-data",
  },
  {
    name: "Health Canada DPD",
    what: "Marketed drug product database",
    role: "Whether a surviving candidate is actually available where the patient lives",
    url: "https://health-products.canada.ca/dpd-bdpp/",
  },
];

/** Derived from the run, so these can't disagree with the rest of the page. */
export function buildStats(data: Pipeline): Stat[] {
  const stats: Stat[] = [
    {
      label: "Screened",
      value: num(data.meta.n_input),
      detail: "Approved substances with a resolvable structure",
    },
    {
      label: "Joined on",
      value: "InChIKey",
      detail:
        "Structure, not name — three sources use three different identifier systems",
    },
  ];

  if (data.validation.bbb_roc_auc !== null) {
    stats.push({
      label: "Barrier ROC-AUC",
      value: data.validation.bbb_roc_auc.toFixed(2),
      detail: "Scaffold split, not random — a random split inflates this",
    });
  }

  stats.push({
    label: "Candidates carried",
    value: num(data.candidates.length),
    detail:
      "Top ranks plus every drug cut at the patient filter or trial history",
  });

  return stats;
}
