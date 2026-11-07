import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { GraveyardEntry } from "@/lib/contract";
import { cn, prob } from "@/lib/utils";

/**
 * The headline: every drug that failed a human ALS trial, placed on a single
 * axis of predicted barrier permeability and split at the model's 0.5
 * threshold.
 *
 * One axis rather than two charts, because the claim is a claim about a
 * distribution — where these drugs sit relative to the line is the finding,
 * and two bar counts would throw away the only variable that carries it. Dots
 * dodge upward when they crowd, so the pile under each region of the axis is a
 * histogram you can read at arm's length and still resolve to one drug.
 *
 * The bucket is never carried by colour alone: it is the side of the divider,
 * the sunk field on the left, and a hollow-vs-solid mark. Greyscale-safe by
 * construction.
 */

const R = 6; // dot radius
const DY = 16; // vertical pitch of a dodged stack
const PAD = 8; // keeps a dot at 0.00 or 1.00 inside the frame
const LABEL_Y = 12; // baseline of the persistent callouts
const TOP = 32; // top of the highest dot
/** Dodge window in probability, not pixels, so columns form at any width. */
const BIN = 0.045;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

const BUCKETS = [
  {
    key: "never_arrived" as const,
    title: "Never arrived",
    blurb:
      "Predicted barrier-negative. The trial may have been testing whether a drug works in tissue it could not reach.",
  },
  {
    key: "arrived_failed" as const,
    title: "Arrived and still failed",
    blurb:
      "Predicted barrier-positive. The drug reached the tissue, so the biology was wrong — not the delivery.",
  },
];

type Dot = {
  entry: GraveyardEntry;
  x: number;
  /** 0 sits on the axis; each step up is one dodged neighbour. */
  row: number;
  order: number;
};

const idOf = (e: GraveyardEntry) => `${e.name}-${e.year}`;

/**
 * Beeswarm dodge. Entries are swept left to right and dropped into the lowest
 * row that still clears its neighbour, so x stays the real predicted value and
 * only y is invented. `minGap` is wide enough that a cluster builds a visible
 * column instead of a smear of touching dots.
 */
function place(entries: GraveyardEntry[], width: number) {
  const span = width - PAD * 2;
  const minGap = Math.max(R * 2 + 3, span * BIN);
  const lastX: number[] = [];

  const dots: Dot[] = [...entries]
    .sort((a, b) => a.bbb_prob - b.bbb_prob || a.name.localeCompare(b.name))
    .map((entry, order) => {
      const x = PAD + entry.bbb_prob * span;
      let row = 0;
      while (lastX[row] !== undefined && x - lastX[row] < minGap) row++;
      lastX[row] = x;
      return { entry, x, row, order };
    });

  return { dots, rows: Math.max(lastX.length, 1) };
}

type Callout = Dot & { anchor: "start" | "end"; tx: number };

/**
 * Twenty-four names would be noise, so only four are printed: the two
 * extremes, and the pair that straddles the threshold — the drugs the
 * partition is most arguable about. Anything that would collide is dropped
 * rather than overlapped.
 */
function callouts(dots: Dot[], width: number): Callout[] {
  if (dots.length === 0) return [];
  const mid = width / 2;

  const wanted: Array<{ dot: Dot | undefined; anchor: "start" | "end"; tx?: number }> = [
    { dot: dots[0], anchor: "start" },
    { dot: dots[dots.length - 1], anchor: "end" },
  ];
  const under = [...dots].reverse().find((d) => d.entry.bbb_prob < 0.5);
  const over = dots.find((d) => d.entry.bbb_prob >= 0.5);
  if (under) wanted.push({ dot: under, anchor: "end", tx: Math.min(under.x, mid - 7) });
  if (over) wanted.push({ dot: over, anchor: "start", tx: Math.max(over.x, mid + 7) });

  const taken: Array<[number, number]> = [];
  const seen = new Set<string>();
  const out: Callout[] = [];

  for (const { dot, anchor, tx } of wanted) {
    if (!dot || seen.has(idOf(dot.entry))) continue;
    const at = tx ?? dot.x;
    const w = dot.entry.name.length * 6.3 + 4;
    const lo = anchor === "start" ? at : at - w;
    const hi = lo + w;
    if (lo < 0 || hi > width) continue;
    if (taken.some(([a, b]) => lo < b && a < hi)) continue;
    taken.push([lo, hi]);
    seen.add(idOf(dot.entry));
    out.push({ ...dot, anchor, tx: at });
  }

  return out;
}

/** Keys the swarm claims. Everything else bubbles — Tab still leaves. */
const NAV = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function GraveyardPartition({ entries }: { entries: GraveyardEntry[] }) {
  const frame = useRef<HTMLDivElement>(null);
  const group = useRef<SVGGElement>(null);
  const dotEls = useRef(new Map<string, HTMLAnchorElement>());
  const [width, setWidth] = useState(0);
  /** The last reading stays on screen — an instrument doesn't blank when you
      take your hand off it, and the presenter needs it to survive a gesture. */
  const [read, setRead] = useState<string | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // Seed synchronously: a ResizeObserver that never fires (a backgrounded or
    // unpainted tab) would otherwise leave the chart permanently blank.
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (entries.length === 0) return null;

  const { dots, rows } = place(entries, width);
  const mid = width / 2;
  const cy = (row: number) => TOP + R + (rows - 1 - row) * DY;
  const axisY = cy(0) + R + 8;
  const height = axisY + 40;
  const marks = callouts(dots, width);
  /** Opens on the strongest case for the finding — the lowest predicted
      permeability in the set — so the readout is never empty at the table. */
  const active = dots.find((d) => idOf(d.entry) === read) ?? dots[0];

  /** One move: light the readout and take the focus ring with us. Every dot
      is already in the DOM at tabIndex -1, so this is a plain focus call. */
  const land = (dot: Dot | undefined) => {
    if (!dot) return;
    setRead(idOf(dot.entry));
    dotEls.current.get(idOf(dot.entry))?.focus();
  };

  /** 25 dots were 25 tab stops, which is the knowledge graph's old problem
      answered the opposite way on the same page. One stop for the swarm,
      Left/Right along the axis inside it — `dots` is already sorted by
      predicted permeability, so arrowing walks the finding in order. */
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Escape") return group.current?.focus();
    if (!active || !NAV.has(e.key)) return;
    e.preventDefault();
    // First arrow after tabbing into the group: step onto a dot, not past it.
    if (e.target === e.currentTarget) return land(active);

    const i = dots.indexOf(active);
    const last = dots.length - 1;
    switch (e.key) {
      case "ArrowRight":
        return land(dots[i === last ? 0 : i + 1]);
      case "ArrowLeft":
        return land(dots[i <= 0 ? last : i - 1]);
      case "Home":
        return land(dots[0]);
      default:
        return land(dots[last]);
    }
  };

  return (
    <section aria-labelledby="graveyard-heading">
      <header>
        <h2 id="graveyard-heading" className="text-xl leading-tight">
          Why {entries.length} failed ALS trials failed, split two ways
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm leading-normal text-ink-soft">
          Every drug placed by its predicted barrier permeability. Left of the
          line, the trial may never have delivered the drug to the tissue it was
          testing. Nobody has published this partition for ALS.
        </p>
      </header>

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-10">
      <div>
      {/* Counts sit directly over the half of the axis they describe, and the
          rule between them is the same 0.5 divider the chart draws. */}
      <div className="grid grid-cols-2">
        {BUCKETS.map((bucket, i) => {
          const n = entries.filter((e) => e.bucket === bucket.key).length;
          const never = bucket.key === "never_arrived";

          return (
            <div
              key={bucket.key}
              className={cn(
                "flex flex-col gap-2",
                i === 0 ? "pr-6" : "border-l border-rule pl-5",
              )}
            >
              <div className="flex items-center gap-2">
                <svg width="12" height="12" aria-hidden="true" className="shrink-0">
                  {never ? (
                    <circle
                      cx="6"
                      cy="6"
                      r="4.1"
                      fill="none"
                      strokeWidth={1.75}
                      className="stroke-bucket-never"
                    />
                  ) : (
                    <circle cx="6" cy="6" r="4.75" className="fill-bucket-arrived" />
                  )}
                </svg>
                <span className="label">{bucket.title}</span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="readout text-3xl leading-none font-medium tracking-[-0.02em]">
                  {n}
                </span>
                <span className="readout text-xs text-ink-faint">
                  of {entries.length}
                </span>
              </div>

              <p className="max-w-[46ch] text-sm leading-normal text-ink-soft">
                {bucket.blurb}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 mb-1.5 flex items-baseline justify-between">
        <span className="label">Predicted blood–brain barrier permeability</span>
        <span className="label">one dot per trial</span>
      </div>

      <div ref={frame} className="min-h-[8.5rem]">
        {width > 0 && (
          <svg width={width} height={height} className="block">
            {/* Non-colour carrier #1: the barrier-negative field is sunk. */}
            <rect x={0} y={0} width={mid} height={axisY} className="fill-surface-sunk" />

            <line
              x1={0}
              x2={width}
              y1={axisY}
              y2={axisY}
              strokeWidth={1}
              className="stroke-rule-strong"
            />
            {/* Non-colour carrier #2: the threshold, full height. */}
            <line
              x1={mid}
              x2={mid}
              y1={0}
              y2={axisY + 5}
              strokeWidth={1}
              className="stroke-rule-strong"
            />

            {TICKS.map((t) => {
              const x = PAD + t * (width - PAD * 2);
              const edge = t === 0 || t === 1;
              return (
                <g key={t}>
                  {!edge && t !== 0.5 && (
                    <line
                      x1={x}
                      x2={x}
                      y1={axisY}
                      y2={axisY + 5}
                      strokeWidth={1}
                      className="stroke-rule-strong"
                    />
                  )}
                  <text
                    x={x}
                    y={axisY + 18}
                    textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}
                    className={cn(
                      "readout text-label",
                      t === 0.5 ? "fill-ink font-medium" : "fill-ink-faint",
                    )}
                  >
                    {prob(t)}
                  </text>
                </g>
              );
            })}

            <text x={0} y={axisY + 33} className="fill-ink-faint text-label tracking-[0.07em] uppercase">
              cannot cross
            </text>
            <text
              x={mid}
              y={axisY + 33}
              textAnchor="middle"
              className="fill-ink-soft text-label tracking-[0.07em] uppercase"
            >
              model threshold
            </text>
            <text
              x={width}
              y={axisY + 33}
              textAnchor="end"
              className="fill-ink-faint text-label tracking-[0.07em] uppercase"
            >
              crosses
            </text>

            {marks.map((m) => (
              <g key={`callout-${idOf(m.entry)}`}>
                <line
                  x1={m.x}
                  x2={m.x}
                  y1={LABEL_Y + 5}
                  y2={cy(m.row) - R - 3}
                  strokeWidth={1}
                  className="stroke-rule-strong"
                />
                <text
                  x={m.tx}
                  y={LABEL_Y}
                  textAnchor={m.anchor}
                  className="fill-ink text-label font-medium capitalize"
                >
                  {m.entry.name}
                </text>
              </g>
            ))}

            <g
              ref={group}
              role="group"
              tabIndex={0}
              onKeyDown={onKey}
              aria-label={`${entries.length} failed ALS trial drugs by predicted permeability. Left and right arrow keys to move along the axis, Enter to open the trial record, Escape to leave.`}
            >
              {dots.map((d) => {
                const e = d.entry;
                const never = e.bucket === "never_arrived";
                return (
                  <a
                    key={idOf(e)}
                    ref={(el) => {
                      if (el) dotEls.current.set(idOf(e), el);
                      else dotEls.current.delete(idOf(e));
                    }}
                    href={e.source_url}
                    target="_blank"
                    rel="noreferrer"
                    tabIndex={active && idOf(active.entry) === idOf(e) ? 0 : -1}
                    aria-label={`${e.name}, ${e.year}, phase ${e.phase}, predicted permeability ${prob(e.bbb_prob)}, ${never ? "never arrived" : "arrived and still failed"}. ${e.note}. Opens the trial record in a new tab.`}
                    onPointerEnter={() => setRead(idOf(e))}
                    onFocus={() => setRead(idOf(e))}
                  >
                    {/* Comfortable target without inflating the mark. */}
                    <circle cx={d.x} cy={cy(d.row)} r={9} fill="transparent" />
                    {/* whileInView, not animate: this panel mounts ~5,000px
                        below the fold, so an on-mount stagger plays to nobody
                        and the dots are already settled by the time anyone
                        scrolls here. The parent Reveal only sets opacity,
                        which hides the animation rather than holding it. */}
                    <motion.circle
                      cx={d.x}
                      cy={cy(d.row)}
                      r={never ? R - 0.75 : R}
                      fill={never ? "none" : undefined}
                      strokeWidth={never ? 1.75 : 0}
                      className={never ? "stroke-bucket-never" : "fill-bucket-arrived"}
                      style={{ transformBox: "fill-box", transformOrigin: "center" }}
                      initial={reduce ? false : { opacity: 0, scale: 0.6, y: 8 }}
                      whileInView={{ opacity: 1, scale: 1, y: 0 }}
                      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
                      transition={{
                        duration: 0.4,
                        ease: [0.23, 1, 0.32, 1],
                        delay: Math.min(d.order * 0.03, 0.5),
                      }}
                    />
                  </a>
                );
              })}
            </g>

            {/* Drawn last so the live reading is never under another dot. */}
            {active && (
              <circle
                cx={active.x}
                cy={cy(active.row)}
                r={R + 4}
                fill="none"
                strokeWidth={1.5}
                className="stroke-ink"
              />
            )}
          </svg>
        )}
      </div>

      </div>

      {/* The instrument's readout. It holds the last value rather than
          blanking, so a presenter can take their hand off the trackpad. */}
      {/* Not a live region: each point's own label already carries the whole
          record, so announcing this too would say everything twice. */}
      <div className="border-l border-rule pl-5 text-sm leading-normal">
        <div className="label">Trial record</div>
        {active && (
          <>
            <a
              href={active.entry.source_url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "mt-2 inline-block text-md leading-tight font-semibold capitalize",
                "underline decoration-rule-strong decoration-1 underline-offset-[3px]",
                "transition-colors duration-150 ease-out hover:decoration-ink",
              )}
            >
              {active.entry.name}
            </a>

            <p className="readout mt-2 text-xs text-ink-faint">
              {active.entry.year} · phase {active.entry.phase}
              <span className="text-ink-soft">
                {" · p "}
                {prob(active.entry.bbb_prob)}
                {" · "}
                {active.entry.bucket === "never_arrived"
                  ? "never arrived"
                  : "arrived, failed"}
              </span>
            </p>

            <p className="mt-3 text-ink-soft">{active.entry.note}</p>
          </>
        )}
        <p className="label mt-4">Point at any dot, or tab through them</p>
      </div>
      </div>
    </section>
  );
}
