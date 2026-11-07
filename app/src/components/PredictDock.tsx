import { useEffect, useState } from "react";
import { predict, getPresets } from "@/api";
import { cn, prob } from "@/lib/utils";

type Preset = { name: string; smiles: string | null; role: string; note: string };
type Result = {
  in_domain?: boolean;
  prob?: number | null;
  nearest_tanimoto?: number | null;
  refusal?: string;
  descriptors?: Record<string, number>;
};

export function PredictDock() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [smiles, setSmiles] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    getPresets()
      .then((j) => setPresets((j.presets ?? []).filter((p: Preset) => p.smiles)))
      .catch(() => setPresets([]));
  }, []);

  async function run(next: string, name?: string) {
    setBusy(true);
    setError(null);
    setPicked(name ?? null);
    try {
      const j = await predict(next);
      setResult(j);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const showProb = result && result.in_domain && result.prob != null;

  return (
    <section aria-labelledby="predict-heading" className="hairline-t pt-4">
      <header className="mb-3">
        <h3 id="predict-heading" className="text-md leading-tight font-semibold">
          Live barrier predict
        </h3>
        <p className="mt-1 text-sm leading-snug text-ink-soft">
          Out of domain still shows no probability.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => {
              if (!p.smiles) return;
              setSmiles(p.smiles);
              void run(p.smiles, p.name);
            }}
            data-preset={p.name}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium",
              picked === p.name
                ? "border-ink bg-ink text-paper"
                : "border-rule-strong bg-surface text-ink-soft hover:text-ink",
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (smiles.trim()) void run(smiles.trim());
        }}
      >
        <input
          value={smiles}
          onChange={(ev) => setSmiles(ev.target.value)}
          placeholder="SMILES"
          className="readout min-w-0 flex-1 rounded-md border border-rule-strong bg-surface-sunk px-2.5 py-1.5 text-xs text-ink"
          aria-label="SMILES"
        />
        <button
          type="submit"
          disabled={busy || !smiles.trim()}
          className="rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft hover:text-ink disabled:opacity-40"
        >
          {busy ? "…" : "Predict"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-cut">{error}</p>}

      {result && (
        <div className="mt-3 rounded-md border border-rule bg-surface-sunk px-3 py-2.5">
          {showProb ? (
            <p className="flex items-baseline justify-between">
              <span className="label">Barrier permeability</span>
              <span className="readout text-lg font-semibold">{prob(result.prob as number)}</span>
            </p>
          ) : (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="label">Barrier permeability</span>
                <span className="text-sm font-medium text-ink-faint">not predicted</span>
              </div>
              <p className="mt-1.5 text-sm leading-snug text-ink-soft">
                {result.refusal ??
                  (result.nearest_tanimoto != null
                    ? `Outside the applicability domain — nearest Tanimoto ${prob(result.nearest_tanimoto)}.`
                    : "Outside the applicability domain.")}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
