const BASE = "/api";

export async function getPipeline() {
  const r = await fetch(`${BASE}/pipeline`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function predict(smiles: string) {
  const r = await fetch(`${BASE}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ smiles }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { detail?: string }).detail || r.statusText);
  }
  return r.json();
}

export async function getPresets() {
  const r = await fetch(`${BASE}/presets`);
  return r.ok ? r.json() : { presets: [] };
}
