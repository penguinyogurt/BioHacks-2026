import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";

type Pipeline = any;

const STAGES = ["universe", "kg_relevance", "bbb", "patient_filter", "trial_history"] as const;
const RULE_LABELS: Record<string, string> = {
  cyp1a2: "CYP1A2 vs riluzole",
  respiratory: "Respiratory depression",
  weight_loss: "Weight loss / appetite",
  myopathy: "Myopathy risk",
  swallow: "Swallowable formulation",
  dexterity: "Self-administration",
  bbb_direction: "Barrier direction vs target",
  canada: "Available in Ontario",
};

function num(n: number) {
  return n.toLocaleString();
}

function Molecule3D({ molblock }: { molblock: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !molblock) return;
    let viewer: any;
    import("3dmol/build/3Dmol.js").then((mod: any) => {
      const $3 = mod.default ?? mod;
      viewer = $3.createViewer(ref.current, { backgroundColor: "#020617" });
      viewer.addModel(molblock, "mol");
      viewer.setStyle({}, { stick: { radius: 0.14 }, sphere: { scale: 0.22 } });
      viewer.zoomTo();
      viewer.spin(true);
      viewer.render();
    });
    return () => viewer?.clear?.();
  }, [molblock]);
  if (!molblock) return <div className="grid h-72 place-items-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">No 3D structure</div>;
  return <div ref={ref} className="h-72 rounded-xl border border-slate-800" />;
}

function BbbPanel({ bbb }: { bbb: any }) {
  if (!bbb || bbb.scored === false || (bbb.prob == null && bbb.in_domain && !bbb.refusal))
    return <p className="text-sm text-slate-500">No BBB score yet.</p>;
  if (!bbb.in_domain)
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="font-bold text-amber-300">Out of domain · no prediction</p>
        <p className="mt-2 text-sm text-amber-100">{bbb.refusal || "The model refuses to score this chemistry."}</p>
      </div>
    );
  const p = bbb.prob ?? 0;
  return (
    <div>
      <p className="tnum text-5xl font-bold">{p.toFixed(2)}</p>
      <p className="text-xs uppercase text-slate-500">p(crosses)</p>
      <div className="mt-2 h-2 rounded-full bg-slate-800">
        <motion.div initial={{ width: 0 }} animate={{ width: `${p * 100}%` }} className={`h-full ${p >= 0.5 ? "bg-emerald-400" : "bg-rose-400"}`} />
      </div>
    </div>
  );
}

function FunnelView({ pipeline, onPick }: { pipeline: Pipeline; onPick: (c: any) => void }) {
  const [revealed, setRevealed] = useState(pipeline.funnel.length);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!play || revealed >= pipeline.funnel.length) return setPlay(false);
    const t = setTimeout(() => setRevealed((r: number) => r + 1), 900);
    return () => clearTimeout(t);
  }, [play, revealed, pipeline.funnel.length]);
  const survivors = useMemo(
    () => pipeline.candidates.filter((c: any) => !c.eliminated_at || STAGES.indexOf(c.eliminated_at) >= revealed),
    [pipeline, revealed],
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-3xl font-semibold">
          {num(pipeline.meta.n_input)} approved drugs → {num(pipeline.funnel.at(-1).count)}
        </h2>
        <button onClick={() => { setRevealed(1); setPlay(true); }} className="rounded-lg bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-200 ring-1 ring-sky-400/40">
          Run the funnel
        </button>
      </div>
      {pipeline.funnel.map((s: any, i: number) => (
        <motion.div key={s.stage} animate={{ opacity: i < revealed ? 1 : 0.3 }} className="flex gap-4">
          <div className="w-28 text-right text-xs uppercase text-slate-500">Stage {i + 1}</div>
          <div className="flex-1">
            <div className="rounded-xl bg-gradient-to-r from-sky-700 to-violet-600 px-4 py-3" style={{ width: `${Math.max(10, (Math.log10(s.count) / Math.log10(pipeline.meta.n_input)) * 100)}%` }}>
              <span className="tnum text-3xl font-bold text-slate-950">{num(s.count)}</span>
              <span className="ml-2 text-sm font-semibold text-slate-900">{s.label}</span>
            </div>
            {s.eliminated > 0 && <p className="mt-1 text-sm text-rose-400">−{num(s.eliminated)}: {s.top_reason}</p>}
          </div>
        </motion.div>
      ))}
      <div className="flex flex-wrap gap-2 pt-4">
        <AnimatePresence>
          {survivors.map((c: any) => (
            <motion.button key={c.inchikey} layout exit={{ opacity: 0, y: 20 }} onClick={() => onPick(c)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left hover:border-sky-500/50">
              <span className="font-semibold capitalize">{c.name}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

function GraveyardView({ pipeline }: { pipeline: Pipeline }) {
  const buckets = ["never_arrived", "arrived_failed"] as const;
  const part = pipeline.validation?.partition || {};
  return (
    <section>
      <h2 className="text-3xl font-semibold">Failed ALS trials, split two ways</h2>
      <p className="mt-2 max-w-3xl text-slate-400">The headline partition: never reached the target vs arrived and still failed.</p>
      <div className="mt-6 flex gap-4">
        {buckets.map((b) => (
          <div key={b} className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-3">
            <p className="tnum text-4xl font-bold text-sky-300">{part[b] ?? pipeline.graveyard.filter((g: any) => g.bucket === b).length}</p>
            <p className="text-sm">{b === "never_arrived" ? "Never reached target" : "Arrived, still failed"}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {buckets.map((b) => (
          <div key={b} className="rounded-2xl border border-slate-800 p-4">
            <h3 className="text-lg font-semibold capitalize">{b.replace(/_/g, " ")}</h3>
            <ul className="mt-3 space-y-2 max-h-96 overflow-y-auto">
              {pipeline.graveyard.filter((g: any) => g.bucket === b).map((g: any) => (
                <li key={g.name} className="rounded-lg border border-slate-800 p-3 text-sm">
                  <div className="font-semibold">{g.name} <span className="text-slate-500">({g.year}, ph {g.phase})</span></div>
                  {g.bbb_prob != null ? <p className="tnum text-sky-300">p = {g.bbb_prob.toFixed(2)}</p> : <p className="text-amber-300 text-xs">no prediction</p>}
                  <p className="text-slate-400">{g.note}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function CandidateDetail({ c, chart }: { c: any; chart: Record<string, string> }) {
  const failIdx = c.filters?.findIndex((f: any) => !f.passed) ?? -1;
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <header className="flex justify-between">
        <div>
          <h3 className="text-2xl font-semibold capitalize">{c.name}</h3>
          <p className="text-xs text-slate-500">{c.verdict} {c.eliminated_at ? `· out at ${c.eliminated_at}` : ""}</p>
        </div>
        <p className="tnum text-2xl font-bold">#{c.kg?.rank}</p>
      </header>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-xs uppercase text-slate-500">Path receipt</h4>
          <ol className="mt-2 space-y-1 font-mono text-xs">
            {(c.path || []).map((h: any, i: number) => (
              <li key={i}>{h.from} —{h.rel}→ {h.to}</li>
            ))}
          </ol>
          <h4 className="mt-4 text-xs uppercase text-slate-500">Barrier</h4>
          <div className="mt-2"><BbbPanel bbb={c.bbb} /></div>
        </div>
        <div>
          <h4 className="text-xs uppercase text-slate-500">Patient rules</h4>
          <ol className="mt-2 space-y-2">
            {(c.filters || []).map((f: any, i: number) => (
              <li key={f.rule} className={`rounded-lg border p-2 text-sm ${i === failIdx ? "border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/30" : "border-slate-800"}`}>
                <span className="font-semibold">{RULE_LABELS[f.rule] || f.rule}</span> {f.passed ? "✓" : "✕"}
                <p className="text-slate-400">{f.reason}</p>
                {chart?.[f.rule] && <p className="text-xs italic text-slate-600">Chart: {chart[f.rule]}</p>}
              </li>
            ))}
            {!c.filters?.length && <li className="text-slate-500 text-sm">Removed before patient rules ran.</li>}
          </ol>
        </div>
      </div>
    </article>
  );
}

function LiveView() {
  const [smiles, setSmiles] = useState("Nc1nc2ccc(OC(F)(F)F)cc2s1");
  const [result, setResult] = useState<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { api.getPresets().then((d) => setPresets(d.presets || [])); run("Nc1nc2ccc(OC(F)(F)F)cc2s1"); }, []);
  async function run(s: string) {
    setLoading(true); setErr(null);
    try { setResult(await api.predict(s)); } catch (e: any) { setErr(e.message); setResult(null); }
    finally { setLoading(false); }
  }
  return (
    <section>
      <h2 className="text-3xl font-semibold">Live BBB prediction</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.name} disabled={!p.smiles && p.kind !== "no_structure"} onClick={() => p.smiles ? (setSmiles(p.smiles), run(p.smiles)) : setResult(null)} className="rounded border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800">{p.name}</button>
        ))}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(smiles); }}>
        <input value={smiles} onChange={(e) => setSmiles(e.target.value)} className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm" />
        <button className="rounded-lg bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-200">{loading ? "…" : "Predict"}</button>
      </form>
      {err && <p className="mt-3 text-rose-300 text-sm">{err}</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {loading ? <div className="h-72 animate-pulse rounded-xl bg-slate-800" /> : <Molecule3D molblock={result?.molblock || ""} />}
        <div>
          {result && !result.in_domain ? (
            <div className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-6">
              <p className="text-xl font-bold text-amber-200">We will not guess.</p>
              <p className="mt-2 text-sm text-amber-100">{result.refusal}</p>
            </div>
          ) : result ? (
            <>
              <p className="tnum text-6xl font-bold">{result.prob?.toFixed(2)}</p>
              <p className="text-xs text-slate-500">MPO-lite {result.mpo_lite?.score}/{result.mpo_lite?.max}</p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"funnel" | "graveyard" | "live">("funnel");
  const [pick, setPick] = useState<any>(null);

  useEffect(() => {
    api.getPipeline().then(setPipeline).catch((e) => setErr(e.message));
  }, []);

  if (err) return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-xl text-rose-300">Cannot load pipeline</h1>
      <p className="mt-2 text-slate-400">{err}</p>
      <pre className="mt-4 rounded bg-slate-900 p-3 text-xs text-sky-300">PYTHONPATH=. python3 -m uvicorn server.main:app --port 8731</pre>
    </div>
  );
  if (!pipeline) return <div className="p-10 text-slate-400">Loading pipeline…</div>;

  const chart = pipeline.meta?.chart || {};
  const sample = pipeline.meta?.is_sample || pipeline.meta?.data_mode === "sample";

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Patient-constrained ALS repurposing</h1>
            <p className="text-sm text-slate-400">Alex Chen · Hamilton, Ontario · reads only <code className="text-sky-300">data/pipeline.json</code></p>
          </div>
          {sample && <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold uppercase text-amber-300 ring-1 ring-amber-500/40">Sample data</span>}
        </div>
        <nav className="mx-auto mt-4 flex max-w-7xl gap-2">
          {(["funnel", "graveyard", "live"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${tab === t ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"}`}>{t}</button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {tab === "funnel" && (
          <>
            <FunnelView pipeline={pipeline} onPick={(c) => setPick(c)} />
            {pick && <CandidateDetail c={pick} chart={chart} />}
            {!pick && pipeline.candidates[0] && <CandidateDetail c={pipeline.candidates.find((c: any) => c.verdict === "shortlisted") || pipeline.candidates[0]} chart={chart} />}
          </>
        )}
        {tab === "graveyard" && <GraveyardView pipeline={pipeline} />}
        {tab === "live" && <LiveView />}
      </main>
    </div>
  );
}
