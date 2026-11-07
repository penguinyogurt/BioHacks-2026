import { useRef, type JSX } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";

/**
 * The engineering, made visible in about fifteen seconds.
 *
 * Judges score technical depth and the rest of this page shows only results.
 * The load-bearing fact is architectural, not numeric: the modules never import
 * each other, they integrate through files, and that is why four people could
 * build them at the same time. A numbered list would say that. Parallel lanes
 * funnelling into one join *shows* it, so the shape of the diagram is the
 * argument and the prose underneath is only the caption.
 *
 * Everything renders from props. The only strings written here are the join and
 * the consumer at the bottom of the flow — those are the repo's architecture
 * rule, not data, and there is no field for them.
 */

type Stat = { label: string; value: string; detail: string };

type Stage = {
  id: string;
  module: string;
  title: string;
  writes: string;
  method: string;
  inputs: string[];
};

type Source = {
  name: string;
  what: string;
  role: string;
  url: string;
  licence?: string;
};

/** The project's --ease-out. Never ease-in: it delays the first frame. */
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/**
 * The converge band is one SVG spanning the same box as the lane grid, in a
 * fixed viewBox that scales uniformly with it — so no measurement, no
 * ResizeObserver, and the lane anchors stay exact at every width. The column
 * gap is expressed as a percentage (`gap-x-[1.2%]`) precisely so it is knowable
 * in viewBox units here; a rem gap would drift away from these anchors.
 */
const VB = 1200;
const GAP = 0.012 * VB;
/** Tall enough that the outer lanes still leave and arrive vertically — a
    shallower band flattens them into a bracket instead of a funnel. */
const BAND = 96;
const CX = VB / 2;

/** Leaves the lane straight down, sweeps in, arrives straight down on the
    join. Monotonic in y, so nothing ever appears to flow back upward. */
const lane = (x: number) =>
  `M ${x} 0 C ${x} ${BAND * 0.45} ${CX} ${BAND * 0.62} ${CX} ${BAND - 10}`;

export function PipelineProvenance({
  stages,
  sources,
  stats,
}: {
  stages: Stage[];
  sources: Source[];
  stats: Stat[];
}): JSX.Element {
  const band = useRef<HTMLDivElement>(null);
  const inView = useInView(band, { once: true, margin: "0px 0px 64px 0px" });
  const reduced = useReducedMotion();

  const n = stages.length;
  const colW = n > 0 ? (VB - (n - 1) * GAP) / n : VB;
  const laneX = (i: number) => i * (colW + GAP) + colW / 2;

  return (
    <section aria-labelledby="provenance-heading" className="hairline-b pb-10">
      <header className="mb-6">
        <h2 id="provenance-heading" className="text-xl leading-tight">
          The modules never import each other — the decoupling is the schedule
        </h2>
        <p className="mt-1 max-w-[74ch] text-sm leading-normal text-ink-soft">
          Each one reads public data and writes a single JSON file;{" "}
          <span className="readout">merge.py</span> joins them on InChIKey.
          Nothing imports anything, which is why all {n} were built at once and
          a broken one can&rsquo;t block the rest.
        </p>
      </header>

      {n > 0 && (
        <div
          // Narrow windows scroll rather than crushing six lanes into
          // unreadable columns, and the diagram keeps its alignment because the
          // grid and the band share this box.
          tabIndex={0}
          role="group"
          aria-label="Pipeline data flow"
          className="overflow-x-auto pb-1"
        >
          {/* A floor per lane rather than one for the block: six lanes in the
              space four want is unreadable, so past that the group scrolls. */}
          <div style={{ minWidth: `${Math.max(52, n * 13)}rem` }}>
            <div className="mb-2.5 flex items-baseline justify-between gap-4">
              <span className="label">
                {n} modules · run in any order, in parallel
              </span>
              <span className="label">each writes one file</span>
            </div>

            <ul
              className="grid gap-x-[1.2%]"
              style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
            >
              {stages.map((stage) => (
                <li
                  key={stage.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-rule bg-surface p-3.5"
                >
                  {/* One line, so every module name sits on the same baseline
                      across the lanes and they read as peers. The full input
                      list is the sources table below — a better way back to a
                      clipped name than a tooltip. */}
                  {stage.inputs.length > 0 && (
                    <p className="truncate text-label leading-snug text-ink-faint">
                      <span className="label">reads</span>{" "}
                      <span className="readout">{stage.inputs.join(" · ")}</span>
                    </p>
                  )}

                  <div>
                    <p className="readout text-base leading-snug font-medium text-ink">
                      {stage.module}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-ink-faint">
                      {stage.title}
                    </p>
                  </div>

                  <p className="text-sm leading-normal text-ink-soft">
                    {stage.method}
                  </p>

                  {/* Pinned to the foot of the lane, where its converging line
                      leaves: the file is the whole interface. Stacked so the
                      path gets the full column and never breaks mid-word. */}
                  <div className="mt-auto border-t border-rule pt-2">
                    <span className="label">writes</span>
                    <p className="readout mt-0.5 text-label leading-snug break-words text-ink">
                      {stage.writes}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {/* The drawing. Decorative: the DOM already states the flow in
                order, so announcing the curves twice would only be noise. */}
            <div ref={band}>
              <svg
                viewBox={`0 0 ${VB} ${BAND}`}
                aria-hidden="true"
                className="block h-auto w-full"
              >
                {stages.map((stage, i) => {
                  return (
                    <motion.path
                      key={stage.id}
                      d={lane(laneX(i))}
                      fill="none"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      className="stroke-rule-strong"
                      initial={reduced ? false : { pathLength: 0 }}
                      animate={
                        inView || reduced ? { pathLength: 1 } : { pathLength: 0 }
                      }
                      transition={{
                        duration: 0.5,
                        ease: EASE_OUT,
                        delay: 0.08 + i * 0.05,
                      }}
                    />
                  );
                })}
                {/* Direction without motion, for a reduced-motion reader. */}
                <path
                  d={`M ${CX - 5} ${BAND - 11} L ${CX + 5} ${BAND - 11} L ${CX} ${BAND} Z`}
                  className="fill-rule-strong"
                />
              </svg>
            </div>

            <div className="mx-auto flex max-w-[42rem] flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg border border-rule-strong bg-surface px-4 py-3">
              <p className="readout text-base leading-snug font-medium text-ink">
                merge.py
              </p>
              <p className="text-sm leading-normal text-ink-soft">
                Joins the {n} files on{" "}
                <span className="readout text-ink">InChIKey</span>
              </p>
              <p className="text-xs leading-snug">
                <span className="label">writes</span>{" "}
                <span className="readout text-ink">data/pipeline.json</span>
              </p>
            </div>

            <svg
              viewBox="0 0 12 26"
              aria-hidden="true"
              className="mx-auto block h-[26px] w-3"
            >
              <line
                x1="6"
                x2="6"
                y1="0"
                y2="18"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="stroke-rule-strong"
              />
              <path d="M 1.5 17 L 10.5 17 L 6 26 Z" className="fill-rule-strong" />
            </svg>

            {/* Dashed and sunk: the consumer produces nothing. */}
            <div className="mx-auto flex max-w-[34rem] flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg border border-dashed border-rule-strong bg-surface-sunk px-4 py-2.5">
              <p className="readout text-base leading-snug font-medium text-ink">
                app/
              </p>
              <p className="text-sm leading-normal text-ink-soft">
                Reads{" "}
                <span className="readout text-ink">data/pipeline.json</span> and
                nothing else
              </p>
            </div>
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-9">
          <h3 className="text-md leading-tight font-semibold">
            {sources.length} public datasets, joined on chemical structure
          </h3>

          <table className="mt-3 w-full border-collapse table-fixed text-left [&_th]:text-left">
            <caption className="sr-only">
              Public datasets this pipeline reads, what each contains and its
              licence
            </caption>
            <thead>
              <tr className="hairline-b">
                <th scope="col" className="label w-[10rem] pb-1.5">
                  Dataset
                </th>
                <th scope="col" className="label w-[14rem] pb-1.5">
                  Contents
                </th>
                <th scope="col" className="label pb-1.5">
                  What it contributes
                </th>
                <th scope="col" className="label w-[8rem] pb-1.5">
                  Licence
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.name} className="hairline-t align-top">
                  <td className="py-2 pr-3">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="readout text-sm leading-snug font-medium text-ink underline decoration-rule-strong decoration-1 underline-offset-[3px] transition-colors duration-150 ease-out hover:decoration-ink"
                    >
                      {source.name}
                      {/* Non-breaking space, so a name that wraps never leaves
                          arrow orphaned on a line of its own. */}
                      <span aria-hidden="true" className="text-ink-faint">
                        {" ↗"}
                      </span>
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </td>
                  <td className="readout py-2 pr-3 text-xs leading-snug text-ink-soft">
                    {source.what}
                  </td>
                  <td className="py-2 pr-3 text-sm leading-normal text-ink-soft">
                    {source.role}
                  </td>
                  <td className="readout py-2 text-xs leading-snug text-ink-faint">
                    {source.licence ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.length > 0 && (
        <dl className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-x-8 gap-y-4">
          {stats.map((stat) => (
            <div key={stat.label} className="hairline-t pt-2.5">
              <dt className="label">{stat.label}</dt>
              <dd>
                <p className="readout mt-1 text-md leading-snug font-semibold">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm leading-normal text-ink-soft">
                  {stat.detail}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
