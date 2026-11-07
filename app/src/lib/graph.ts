import type { Candidate, GraveyardEntry, Stage } from "./contract";
import { isSurvivor } from "./contract";

export type NodeKind = "als" | "drug" | "gene" | "pathway" | "bucket" | "rule";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  candidate?: Candidate;
  bucket?: GraveyardEntry["bucket"];
  rule?: string;
  eliminated: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  rel: string;
  kind: "path" | "cut" | "bucket";
};

export type GraphModel = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const ALS_ID = "als";
const ALS_LABEL = "ALS";

function unique<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of xs) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function hopKind(name: string): NodeKind {
  if (/amyotrophic|lateral sclerosis|\bals\b/i.test(name)) return "als";
  if (/pathway|signaling|excitotoxicity|metabolism/i.test(name)) return "pathway";
  return "gene";
}

function hopId(name: string, kind: NodeKind): string {
  if (kind === "als") return ALS_ID;
  return `${kind}:${name.toLowerCase()}`;
}

export function pickDrugs(candidates: Candidate[], stage: Stage): Candidate[] {
  const ranked = [...candidates].sort((a, b) => a.kg.rank - b.kg.rank);
  const withPath = (xs: Candidate[]) => xs.filter((c) => c.path.length > 0);
  const short = ranked.filter(isSurvivor);
  const pf = ranked.filter((c) => c.eliminated_at === "patient_filter");
  const th = ranked.filter((c) => c.eliminated_at === "trial_history");
  const ood = ranked.filter((c) => !c.bbb.in_domain);
  const bbbCut = ranked.filter((c) => c.eliminated_at === "bbb");
  const named = (names: string[]) =>
    ranked.filter((c) => names.includes(c.name.toLowerCase()));

  const seed = named(["riluzole", "creatine", "valproic acid", "memantine"]);

  let picked: Candidate[];
  switch (stage) {
    case "bbb":
      picked = [...withPath(short).slice(0, 14), ...withPath(ood).slice(0, 16), ...withPath(bbbCut).slice(0, 8)];
      break;
    case "patient_filter":
      picked = [...withPath(short).slice(0, 16), ...pf.slice(0, 22)];
      break;
    case "trial_history":
      picked = [...withPath(short).slice(0, 14), ...th, ...withPath(pf).slice(0, 6)];
      break;
    default:
      picked = [
        ...withPath(short).slice(0, 18),
        ...withPath(pf).slice(0, 8),
        ...th,
        ...withPath(ood).slice(0, 10),
      ];
  }

  return unique([...seed, ...picked], (c) => c.id).slice(0, 56);
}

export function buildGraph(
  candidates: Candidate[],
  graveyard: GraveyardEntry[],
  stage: Stage,
): GraphModel {
  const drugs = pickDrugs(candidates, stage);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  nodes.set(ALS_ID, {
    id: ALS_ID,
    kind: "als",
    label: ALS_LABEL,
    eliminated: false,
  });

  const showBuckets = stage === "universe" || stage === "kg_relevance" || stage === "trial_history";
  if (showBuckets) {
    for (const bucket of ["never_arrived", "arrived_failed"] as const) {
      const id = `bucket:${bucket}`;
      nodes.set(id, {
        id,
        kind: "bucket",
        label: bucket === "never_arrived" ? "Never arrived" : "Arrived, failed",
        bucket,
        eliminated: true,
      });
      edges.push({
        id: `e-${id}`,
        source: id,
        target: ALS_ID,
        rel: "trial history",
        kind: "bucket",
      });
    }
  }

  const showRules = stage === "patient_filter";

  for (const c of drugs) {
    const id = `drug:${c.id}`;
    nodes.set(id, {
      id,
      kind: "drug",
      label: c.name,
      candidate: c,
      eliminated: !isSurvivor(c),
    });

    if (c.path.length > 0) {
      let prev = id;
      c.path.forEach((hop, i) => {
        const kind = hopKind(hop.to);
        const nid = hopId(hop.to, kind);
        if (!nodes.has(nid)) {
          nodes.set(nid, {
            id: nid,
            kind,
            label: kind === "als" ? ALS_LABEL : hop.to,
            eliminated: false,
          });
        }
        edges.push({
          id: `e-${c.id}-${i}`,
          source: prev,
          target: nid,
          rel: hop.rel,
          kind: "path",
        });
        prev = nid;
      });
      if (prev !== ALS_ID) {
        edges.push({
          id: `e-${c.id}-als`,
          source: prev,
          target: ALS_ID,
          rel: "associated_with",
          kind: "path",
        });
      }
    } else {
      edges.push({
        id: `e-${c.id}-cut`,
        source: id,
        target: ALS_ID,
        rel: c.eliminated_at ?? "ranked",
        kind: "cut",
      });
    }

    if (showRules && c.eliminated_at === "patient_filter") {
      const fail = c.filters.find((f) => !f.passed);
      if (fail) {
        const rid = `rule:${fail.rule}`;
        if (!nodes.has(rid)) {
          nodes.set(rid, {
            id: rid,
            kind: "rule",
            label: fail.rule,
            rule: fail.rule,
            eliminated: true,
          });
          edges.push({
            id: `e-${rid}-als`,
            source: rid,
            target: ALS_ID,
            rel: "patient filter",
            kind: "cut",
          });
        }
        edges.push({
          id: `e-${c.id}-${rid}`,
          source: id,
          target: rid,
          rel: "failed",
          kind: "cut",
        });
      }
    }
  }

  void graveyard;
  return { nodes: [...nodes.values()], edges };
}
