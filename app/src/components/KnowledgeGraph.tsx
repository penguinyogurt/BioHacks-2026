import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useReducedMotion } from "motion/react";
import { useOnScreen } from "@/hooks/useOnScreen";
import type { Candidate } from "@/lib/contract";
import { cn } from "@/lib/utils";

/**
 * The knowledge graph, drawn as a graph.
 *
 * Per-card the path to ALS is a four-link chain and reads as a provenance
 * note. Drawn together it is the actual claim: every surviving drug reaches
 * the same disease through a much smaller set of shared biology, and the
 * nodes where several drugs land are the mechanisms the ranking is really
 * betting on. That convergence is the knowledge graph earning its place in
 * the pipeline, and a stack of cards cannot show it.
 *
 * Concentric because the rings ARE the typing — distance from the centre is
 * distance from the disease — and because a radial layout puts every drug at
 * the same remove from ALS, which is the honest reading: none of these is
 * closer to a cure than another.
 *
 * Layout is a radial dendrogram computed from the data, not a force
 * simulation: the same input gives the same picture on every frame and every
 * reload, which matters when the demo is recorded rather than driven.
 */

const TAU = Math.PI * 2;
/** The whole graph has to be legible in one glance on a laptop. */
const MAX = 840;
/** Room outside the drug ring for its labels. */
const PAD = 104;
/** Ring radii as a fraction of the outer (drug) ring. */
const RING_FRACTION = [0, 0.4, 0.715, 1];
/** A constant tangential bow on every edge, so the field reads as flow. */
const BEND = 0.09;
/** Pulls each control point toward the centre: curves, not spokes. */
const INWARD = 0.82;
const TRUNCATE = 18;

/** Keys the graph claims. Everything else bubbles — Tab still leaves. */
const NAV = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

/** Ring index → what lives on it. Ring 0 is the disease, at the centre. */
const KINDS = ["disease", "pathway", "target", "drug"] as const;
type Kind = (typeof KINDS)[number];

const RING_NAME: Record<Kind, string> = {
  disease: "disease",
  pathway: "pathway",
  target: "target",
  drug: "drug",
};

type GNode = {
  id: string;
  label: string;
  ring: number;
  kind: Kind;
  /** Indices into `candidates` whose path runs through this node. */
  paths: number[];
  parent: string | null;
  kids: string[];
  angle: number;
  /** Drug ring only: at least one candidate on this node survived. */
  survived: boolean;
};

type GEdge = { id: string; a: string; b: string; rel: string; paths: number[] };

/**
 * Builds the graph, then lays it out as a radial dendrogram.
 *
 * Nodes are deduplicated by label — a gene on six paths is one node with six
 * edges, which is the entire point. Each node's first inward neighbour
 * becomes its parent, so the multigraph collapses to a spanning tree; leaves
 * (drugs) take equal angular slots in depth-first order and every internal
 * node sits at the midpoint of its children's span. A tree laid out that way
 * has no crossings by construction, and the depth-first order is what groups
 * each drug under the target it binds and each target under its pathway.
 *
 * Any edge that is not a tree edge — a gene feeding two pathways, say — is
 * still drawn, and may cross. Nothing in the contract forbids it; this data
 * has none.
 */
function build(candidates: Candidate[]) {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();

  candidates.forEach((c, pi) => {
    // A candidate with no path has nothing to contribute to a graph of paths.
    if (c.path.length === 0) return;

    const chain = [c.path[0].from, ...c.path.map((h) => h.to)];
    const last = chain.length - 1;

    chain.forEach((label, i) => {
      // Ring by position in the chain, not by hop count: the drug is first,
      // the disease last, the pathway the one before it. A two-hop path has
      // no intermediate target and simply leaves the middle ring alone.
      const ring = i === 0 ? 3 : i === last ? 0 : i === last - 1 ? 1 : 2;
      const seen = nodes.get(label);

      if (seen) {
        seen.paths.push(pi);
        // A label that appears on two rings keeps the inner one, so the
        // disease stays the sink even if some path reaches it mid-chain.
        seen.ring = Math.min(seen.ring, ring);
        seen.kind = KINDS[seen.ring];
        if (i === 0 && c.verdict === "survived") seen.survived = true;
        return;
      }

      nodes.set(label, {
        id: label,
        label,
        ring,
        kind: KINDS[ring],
        paths: [pi],
        parent: null,
        kids: [],
        angle: 0,
        survived: i === 0 && c.verdict === "survived",
      });
    });

    c.path.forEach((hop, i) => {
      const a = nodes.get(chain[i]);
      const b = nodes.get(chain[i + 1]);
      if (!a || !b || a.id === b.id) return;

      if (!a.parent) {
        a.parent = b.id;
        b.kids.push(a.id);
      }

      const key = `${a.id}\u0000${b.id}`;
      const edge = edges.get(key);
      if (edge) edge.paths.push(pi);
      else edges.set(key, { id: key, a: a.id, b: b.id, rel: hop.rel, paths: [pi] });
    });
  });

  const all = [...nodes.values()];
  if (all.length === 0) return { nodes, edges: [] as GEdge[], rank: new Map<string, number>() };

  const root = all.reduce((lo, n) => (n.ring < lo.ring ? n : lo), all[0]);

  // Leaves per subtree. The visited set is not decoration: a pathological
  // dataset could point two nodes at each other and recursion would not stop.
  const leaves = new Map<string, number>();
  const count = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = nodes.get(id);
    if (!n) return 0;
    const total = n.kids.reduce((s, k) => s + count(k, seen), 0) || 1;
    leaves.set(id, total);
    return total;
  };
  const span = count(root.id, new Set());

  let slot = 0;
  const assign = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = nodes.get(id);
    if (!n) return;

    if (n.kids.length === 0) {
      n.angle = ((slot++ + 0.5) / span) * TAU - Math.PI / 2;
      return;
    }
    // Heaviest branch first, ties alphabetical — ordering by weight puts the
    // convergent clusters side by side instead of scattering them, and the
    // alphabetical tiebreak keeps the whole layout reproducible.
    const kids = [...n.kids].sort(
      (x, y) => (leaves.get(y) ?? 1) - (leaves.get(x) ?? 1) || x.localeCompare(y),
    );
    kids.forEach((k) => assign(k, seen));
    const angles = kids.map((k) => nodes.get(k)?.angle ?? 0);
    n.angle = (Math.min(...angles) + Math.max(...angles)) / 2;
  };
  assign(root.id, new Set());

  // Position within its own ring, clockwise from the top. Drives the stagger,
  // so the graph lands as a sweep rather than a flash.
  const rank = new Map<string, number>();
  for (const ring of [0, 1, 2, 3]) {
    all
      .filter((n) => n.ring === ring)
      .sort((a, b) => a.angle - b.angle)
      .forEach((n, i) => rank.set(n.id, i));
  }

  return { nodes, edges: [...edges.values()], rank };
}

/**
 * Mount choreography, in milliseconds, keyed by ring.
 *
 * It builds inward: the drugs arrive, the edges grow toward the centre, and
 * ALS is the last thing the eye lands on. Every edge path is written
 * outside-in so the line draw runs the direction the biology does.
 */
const NODE_IN = [0, 600, 360, 60];
const EDGE_IN = [0, 700, 480, 230];
const STAGGER = 9;
const STAGGER_CAP = 140;
const NODE_DUR = 320;
const EDGE_DUR = 360;

/**
 * One stylesheet rather than ~200 Motion components: these are predetermined
 * one-shot entrances, so CSS animation is both less code and off the main
 * thread, which is what keeps the draw smooth while the rest of the page is
 * still mounting. Hover dimming is a plain opacity transition for the same
 * reason — no property here triggers layout.
 *
 * `pathLength="1"` normalises every curve, so the line draw needs no
 * getTotalLength() measurement and no layout read.
 */
const CSS = `
@keyframes kg-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes kg-pop { from { opacity: 0; transform: scale(0.86) } to { opacity: 1; transform: none } }
@keyframes kg-fade { from { opacity: 0 } to { opacity: 1 } }
.kg-edge {
  stroke-dasharray: 1;
  animation: kg-draw ${EDGE_DUR}ms var(--ease-out) var(--kg-delay, 0ms) both;
}
.kg-node {
  transform-box: fill-box;
  transform-origin: center;
  animation: kg-pop ${NODE_DUR}ms var(--ease-out) var(--kg-delay, 0ms) both;
}
/* Opacity only, no transform: the CSS transform property beats an element's
   SVG transform attribute, so scaling a rotated label would unrotate it. */
.kg-fade { animation: kg-fade ${NODE_DUR}ms var(--ease-out) var(--kg-delay, 0ms) both }
.kg-dim { transition: opacity 180ms var(--ease-out) }
`;

export function KnowledgeGraph({ candidates }: { candidates: Candidate[] }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** Live hover/focus. Drives the dimming, and releases when you let go. */
  const [hot, setHot] = useState<string | null>(null);
  /** Sticky. The readout holds its last value so a presenter can gesture. */
  const [read, setRead] = useState<string | null>(null);
  /**
   * Roving tabindex. 82 nodes were 82 tab stops — over half the page's
   * focusable elements, and ~85 presses to reach the next section. The graph
   * is now one stop plus the node focus sits on, and arrows move inside it.
   */
  const [roving, setRoving] = useState<string | null>(null);
  const group = useRef<SVGGElement>(null);
  const marks = useRef(new Map<string, SVGGElement>());
  const reduce = useReducedMotion();

  // The draw-in has to wait for the graph to be on screen. Mounted-triggered,
  // all 202 animations reported "finished" by t=3s while this panel was still
  // 892px below the fold — the best two seconds on the page, played to
  // nobody. `Reveal` doesn't help: it sets opacity, which hides an animation
  // rather than pausing it.
  const onScreen = useOnScreen(frame);
  const animate = !reduce && onScreen;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // Seeded synchronously. A ResizeObserver that never fires — a backgrounded
    // or unpainted tab, which is exactly what a screen recorder is — would
    // otherwise leave this blank.
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => build(candidates), [candidates]);
  const { nodes, edges, rank } = graph;

  const byRing = useMemo(() => {
    const out: GNode[][] = [[], [], [], []];
    for (const n of nodes.values()) out[n.ring].push(n);
    // Sort by angular rank, not insertion order. DOM order is tab order, and
    // unsorted it jumped across the dial — memantine, levetiracetam,
    // mexiletine, minocycline — which is disorienting with a focus ring
    // following it. Sorted, focus sweeps the circle.
    for (const ring of out) ring.sort((a, b) => a.angle - b.angle);
    return out;
  }, [nodes]);

  if (nodes.size === 0) return null;

  const size = Math.max(Math.min(width, MAX), 0);
  const cx = size / 2;
  const cy = size / 2;
  const outer = Math.max(size / 2 - PAD, 60);
  const radius = RING_FRACTION.map((f) => f * outer);
  const hub = Math.max(22, outer * 0.085);

  const at = (n: GNode) => ({
    x: cx + radius[n.ring] * Math.cos(n.angle),
    y: cy + radius[n.ring] * Math.sin(n.angle),
  });

  /** Quadratic bézier with its control point pulled toward the centre and
      bowed one constant direction, so no edge reads as a straight spoke. */
  const curve = (a: GNode, b: GNode) => {
    const p = at(a);
    const q = at(b);
    const target = radius[b.ring] === 0 ? a.angle : b.angle;
    const delta = ((target - a.angle + Math.PI * 3) % TAU) - Math.PI;
    const ca = a.angle + delta / 2 + BEND;
    const cr = ((radius[a.ring] + radius[b.ring]) / 2) * INWARD;
    return `M${p.x.toFixed(1)},${p.y.toFixed(1)} Q${(cx + cr * Math.cos(ca)).toFixed(1)},${(cy + cr * Math.sin(ca)).toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  };

  const hotNode = hot ? nodes.get(hot) : null;
  const hotPaths = hotNode ? new Set(hotNode.paths) : null;
  const lit = (paths: number[]) => !hotPaths || paths.some((p) => hotPaths.has(p));

  const delay = (ms: number, order: number) =>
    reduce
      ? undefined
      : ({
          "--kg-delay": `${ms + Math.min(order * STAGGER, STAGGER_CAP)}ms`,
        } as CSSProperties);

  const drugs = byRing[3].length;
  const targets = byRing[2].length;
  const pathways = byRing[1].length;

  /** Opens on the busiest junction in the graph — the readout is never empty
      at the table, and the first thing it says is the finding. */
  const busiest = [...nodes.values()]
    .filter((n) => n.ring === 1 || n.ring === 2)
    .sort((a, b) => b.paths.length - a.paths.length || a.label.localeCompare(b.label))[0];
  const shown = (read ? nodes.get(read) : null) ?? busiest ?? byRing[0][0];
  const shownDrugs = shown
    ? shown.paths.map((p) => candidates[p]).filter(Boolean)
    : [];

  const label = (text: string) =>
    text.length > TRUNCATE ? `${text.slice(0, TRUNCATE - 1)}…` : text;

  const touch = (id: string) => {
    setHot(id);
    setRead(id);
  };

  /** The node focus rests on. Opens on the busiest junction, so tabbing in
      lands on the finding rather than on whichever drug is first. */
  const active = (roving ? nodes.get(roving) : null) ?? busiest ?? byRing[3][0];

  /** One move: remember it, light the readout, and take the focus ring with
      us. The node is already in the DOM with tabIndex -1, so this is just a
      programmatic focus — no re-render needed before it lands. */
  const land = (id: string | undefined) => {
    if (!id) return;
    setRoving(id);
    touch(id);
    marks.current.get(id)?.focus();
  };

  /** Up/Down walk the provenance chain itself, not the nearest node by
      angle: a drug's parent IS the target it binds. ALS is not in the group,
      so inward stops at the pathway ring. */
  const inward = (n: GNode) => {
    const up = n.parent ? nodes.get(n.parent) : null;
    return up && up.ring > 0 ? up.id : undefined;
  };
  const outward = (n: GNode) =>
    n.kids
      .map((k) => nodes.get(k))
      .filter((k): k is GNode => !!k)
      .sort(
        (a, b) => Math.abs(a.angle - n.angle) - Math.abs(b.angle - n.angle),
      )[0]?.id;

  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    // Out of the nodes without arrowing through the remaining 81.
    if (e.key === "Escape") return group.current?.focus();
    if (!active || !NAV.has(e.key)) return;
    e.preventDefault();
    // First arrow after tabbing into the group: step onto the hub, not off it.
    if (e.target === e.currentTarget) return land(active.id);

    const ring = byRing[active.ring];
    const i = ring.indexOf(active);
    const last = ring.length - 1;

    switch (e.key) {
      case "ArrowRight":
        return land(ring[i === last ? 0 : i + 1].id);
      case "ArrowLeft":
        return land(ring[i <= 0 ? last : i - 1].id);
      case "ArrowUp":
        return land(inward(active));
      case "ArrowDown":
        return land(outward(active));
      case "Home":
        return land(ring[0].id);
      default:
        return land(ring[last].id);
    }
  };

  return (
    <section aria-labelledby="kg-heading" className="hairline-b pb-10">
      <style>{CSS}</style>

      <header>
        <h2 id="kg-heading" className="text-2xl leading-tight">
          {drugs} drugs reach ALS through {pathways} shared mechanisms
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm leading-normal text-ink-soft">
          Every ranked candidate and the typed path that earned it a score, in
          one graph. The ring a node sits on is how far it is from the disease;
          a node several drugs run through is a mechanism the ranking is
          betting on, and it is drawn larger.
        </p>
      </header>

      {/* Centred on the graph, not top-aligned: a square sitting next to a
          short panel otherwise leaves the whole lower right of the section
          empty, and the readout reads as a caption to the ring it describes. */}
      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_20rem] items-center gap-10">
        <div>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {[
              [drugs, "drugs"],
              [targets, "targets"],
              [pathways, "pathways"],
              [1, "disease"],
            ].map(([n, name], i) => (
              <span key={name} className="flex items-baseline gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-ink-faint">
                    &rarr;
                  </span>
                )}
                <span className="readout text-md leading-none font-medium text-ink">
                  {n}
                </span>
                <span className="label">{name}</span>
              </span>
            ))}
          </div>

          <div ref={frame} className="flex min-h-[24rem] justify-center">
            {size > 0 && (
              <svg
                width={size}
                height={size}
                className="block overflow-visible"
                onPointerLeave={() => setHot(null)}
              >
                {/* The rings, so the layout reads as concentric rather than as
                    three arbitrary orbits. Quiet enough to sit under the data. */}
                {[1, 2, 3].map((ring) => (
                  <circle
                    key={ring}
                    cx={cx}
                    cy={cy}
                    r={radius[ring]}
                    fill="none"
                    strokeWidth={1}
                    className={cn("stroke-rule", animate && "kg-fade")}
                    style={delay(NODE_IN[ring], 0)}
                    aria-hidden="true"
                  />
                ))}

                <g aria-hidden="true">
                  {edges.map((e) => {
                    const a = nodes.get(e.a);
                    const b = nodes.get(e.b);
                    if (!a || !b) return null;
                    const on = lit(e.paths);
                    return (
                      <path
                        key={e.id}
                        d={curve(a, b)}
                        pathLength={1}
                        fill="none"
                        strokeWidth={hotPaths && on ? 1.5 : 1}
                        strokeLinecap="round"
                        className={cn(
                          "kg-dim",
                          animate && "kg-edge",
                          hotPaths && on ? "stroke-ink-soft" : "stroke-rule-strong",
                        )}
                        style={{
                          opacity: hotPaths ? (on ? 1 : 0.07) : 0.62,
                          ...delay(EDGE_IN[a.ring], rank.get(e.a) ?? 0),
                        }}
                      />
                    );
                  })}
                </g>

                <g
                  ref={group}
                  role="group"
                  tabIndex={0}
                  onKeyDown={onKey}
                  aria-label={`Knowledge graph: ${drugs} drugs, ${targets} targets and ${pathways} pathways converging on ALS. Arrow keys to move between nodes, Escape to leave.`}
                >
                  {[3, 2, 1].flatMap((ring) =>
                    byRing[ring].map((n) => {
                      const { x, y } = at(n);
                      const on = lit(n.paths);
                      const order = rank.get(n.id) ?? 0;
                      const weight = n.paths.length;
                      const drug = n.ring === 3;
                      // Survivors are filled and larger; eliminated drugs are
                      // hollow and smaller. Three carriers before colour.
                      const r = drug
                        ? n.survived
                          ? 5.4
                          : 4.2
                        : (n.ring === 1 ? 4.4 : 3.4) +
                          Math.sqrt(Math.max(weight - 1, 0)) * (n.ring === 1 ? 3.2 : 2.6);
                      const hollow = drug && !n.survived;
                      const deg = (n.angle * 180) / Math.PI;
                      const flip = Math.cos(n.angle) < 0;
                      const reach = radius[3] + 11;

                      return (
                        <g
                          key={n.id}
                          ref={(el) => {
                            if (el) marks.current.set(n.id, el);
                            else marks.current.delete(n.id);
                          }}
                          tabIndex={n.id === active?.id ? 0 : -1}
                          role="graphics-symbol"
                          aria-label={`${n.label}, ${RING_NAME[n.kind]}${
                            drug
                              ? `, ${n.survived ? "survived the funnel" : "eliminated"}`
                              : `, ${weight} of ${drugs} drug paths run through it`
                          }`}
                          className="kg-dim"
                          style={{ opacity: hotPaths && !on ? 0.14 : 1 }}
                          onPointerEnter={() => touch(n.id)}
                          onFocus={() => land(n.id)}
                          onBlur={() => setHot(null)}
                        >
                          {/* A target you can actually hit, without inflating
                              the mark that carries the weight. */}
                          <circle cx={x} cy={y} r={Math.max(r + 5, 9)} fill="transparent" />
                          <circle
                            cx={x}
                            cy={y}
                            r={r}
                            fill={hollow ? "none" : undefined}
                            strokeWidth={hollow ? 1.5 : 0}
                            className={cn(
                              animate && "kg-node",
                              hollow
                                ? "stroke-cut"
                                : drug
                                  ? "fill-keep"
                                  : hotPaths && on
                                    ? "fill-ink"
                                    : "fill-bucket-arrived",
                            )}
                            style={delay(NODE_IN[n.ring], order)}
                          />

                          {/* Drugs keep a standing label: they are the answer
                              to "what would you give him". Inner nodes print
                              on demand — 53 names at once is a smear. */}
                          {drug ? (
                            <text
                              transform={`translate(${(cx + reach * Math.cos(n.angle)).toFixed(1)} ${(cy + reach * Math.sin(n.angle)).toFixed(1)}) rotate(${flip ? deg + 180 : deg})`}
                              textAnchor={flip ? "end" : "start"}
                              dominantBaseline="middle"
                              className={cn(
                                "text-label",
                                animate && "kg-fade",
                                n.survived
                                  ? "fill-ink font-medium"
                                  : hotPaths && on
                                    ? "fill-ink-soft"
                                    : "fill-ink-faint",
                              )}
                              style={delay(NODE_IN[3] + 120, order)}
                            >
                              {label(n.label)}
                            </text>
                          ) : (
                            weight > 1 && (
                              <text
                                x={cx + (radius[n.ring] - r - 11) * Math.cos(n.angle)}
                                y={cy + (radius[n.ring] - r - 11) * Math.sin(n.angle)}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className={cn(
                                  "readout text-label font-medium fill-ink",
                                  animate && "kg-fade",
                                )}
                                style={delay(NODE_IN[n.ring] + 160, order)}
                              >
                                {weight}
                              </text>
                            )
                          )}
                        </g>
                      );
                    }),
                  )}
                </g>

                {/* The sink. Drawn after the edges so 24 curves land under it
                    rather than through the word. */}
                <g>
                  {/* Opaque, so the curves land under the word rather than
                      through it — and `surface` rather than `paper` because
                      this sits on an elevated, translucent panel. */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={hub}
                    strokeWidth={1.5}
                    className={cn("fill-surface stroke-rule-strong", animate && "kg-node")}
                    style={delay(0, 0)}
                  />
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={cn("font-display text-2xl fill-ink", animate && "kg-fade")}
                    style={delay(80, 0)}
                  >
                    {byRing[0][0]?.label ?? "ALS"}
                  </text>
                </g>

                {/* Named only while lit: the sentence the graph exists to say
                    is "these three drugs reach ALS through this mechanism",
                    and it needs the mechanism spelled out when you ask for it. */}
                {hotNode && hotNode.ring > 0 && hotNode.ring < 3 && (
                  <text
                    x={cx + (radius[hotNode.ring] + 10) * Math.cos(hotNode.angle)}
                    y={cy + (radius[hotNode.ring] + 10) * Math.sin(hotNode.angle)}
                    textAnchor={Math.cos(hotNode.angle) < 0 ? "end" : "start"}
                    dominantBaseline="middle"
                    className="text-xs font-medium fill-ink"
                  >
                    {hotNode.label}
                  </text>
                )}
              </svg>
            )}
          </div>
        </div>

        {/* The readout. Holds its last value instead of blanking, and is not a
            live region — every node already carries the same text as its own
            accessible name, so announcing it twice would be noise. */}
        <div className="border-l border-rule pl-5 text-sm leading-normal">
          <div className="label">Convergence</div>

          {shown && (
            <>
              <p className="mt-2 text-lg leading-tight font-semibold text-ink">
                {shown.label}
              </p>
              <p className="readout mt-1 text-xs text-ink-faint">
                {RING_NAME[shown.kind]}
                <span className="text-ink-soft">
                  {" · "}
                  {shown.paths.length} of {drugs} paths
                </span>
              </p>

              <p className="mt-3 text-ink-soft">
                {shown.ring === 3
                  ? `Reaches ALS through ${shown.parent ?? "the graph"}, and ${shown.survived ? "survived every filter" : "was eliminated before the end"}.`
                  : shown.ring === 0
                    ? `Every path in the graph terminates here.`
                    : `${shown.paths.length === 1 ? "One drug reaches" : `${shown.paths.length} drugs reach`} ALS through this ${RING_NAME[shown.kind]}.`}
              </p>

              {shown.ring !== 3 && shownDrugs.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {shownDrugs.slice(0, 9).map((c) => (
                    <li key={c.id} className="flex items-baseline gap-2">
                      <svg width="9" height="9" aria-hidden="true" className="shrink-0 translate-y-px">
                        {c.verdict === "survived" ? (
                          <circle cx="4.5" cy="4.5" r="3.6" className="fill-keep" />
                        ) : (
                          <circle
                            cx="4.5"
                            cy="4.5"
                            r="3"
                            fill="none"
                            strokeWidth={1.4}
                            className="stroke-cut"
                          />
                        )}
                      </svg>
                      <span className="text-ink">{c.name}</span>
                      <span className="readout text-xs text-ink-faint">
                        {c.verdict === "survived" ? "survived" : "cut"}
                      </span>
                    </li>
                  ))}
                  {shownDrugs.length > 9 && (
                    <li className="readout text-xs text-ink-faint">
                      +{shownDrugs.length - 9} more
                    </li>
                  )}
                </ul>
              )}
            </>
          )}

          <div className="mt-5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <svg width="12" height="12" aria-hidden="true" className="shrink-0">
                <circle cx="6" cy="6" r="4.6" className="fill-keep" />
              </svg>
              <span className="label">Survived the funnel</span>
            </div>
            <div className="flex items-center gap-2">
              <svg width="12" height="12" aria-hidden="true" className="shrink-0">
                <circle cx="6" cy="6" r="3.8" fill="none" strokeWidth={1.6} className="stroke-cut" />
              </svg>
              <span className="label">Eliminated</span>
            </div>
          </div>

          <p className="label mt-4">
            Point at any node, or tab in and arrow around: &larr;&rarr; along a
            ring, &uarr;&darr; between rings, Esc to leave
          </p>
        </div>
      </div>
    </section>
  );
}
