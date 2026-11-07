/**
 * THROWAWAY. Delete this file — it exists only so the component could be
 * looked at before it was integrated.
 *
 * Mount from the dev server's console:
 *   await import("/src/components/__kgpreview.tsx").then((m) => m.mount())
 *   await import("/src/components/__kgpreview.tsx").then((m) => m.mount(3))
 */
import { createRoot } from "react-dom/client";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { pipelineResult } from "@/lib/pipeline";

export function mount(n?: number, trim?: boolean) {
  if (!pipelineResult.ok) throw new Error(pipelineResult.problems.join("; "));

  document.getElementById("kgpreview")?.remove();
  const host = document.createElement("div");
  host.id = "kgpreview";
  host.style.cssText =
    "position:fixed;inset:0;z-index:99;overflow:auto;background:var(--paper);padding:24px 24px 120px";
  document.body.appendChild(host);

  let candidates = pipelineResult.data.candidates.slice(0, n ?? 999);
  // trim: simulates two-hop paths and an empty path, for the robustness check.
  if (trim) {
    candidates = candidates.map((c, i) =>
      i % 3 === 0
        ? { ...c, path: c.path.slice(1) }
        : i === 1
          ? { ...c, path: [] }
          : c,
    );
  }

  createRoot(host).render(
    <div className="mx-auto max-w-[84rem]">
      <KnowledgeGraph candidates={candidates} />
    </div>,
  );
}
