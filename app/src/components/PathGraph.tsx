import { motion, useReducedMotion } from "motion/react";
import type { PathHop } from "@/lib/contract";
import { cn } from "@/lib/utils";

/**
 * The knowledge-graph path, drawn as a derivation.
 *
 * A horizontal chain would be more compact but truncates real pathway names
 * ("Glutamate excitotoxicity") into uselessness at card width. Vertical reads
 * as a proof, which is what this is: the reason the model connected this drug
 * to ALS at all. Each node is a real entity in DRKG; each edge is a typed
 * relation, printed rather than implied.
 */

const EASE = [0.23, 1, 0.32, 1] as const;

type Node = { id: string; label: string; rel: string | null; terminal: boolean };

function toNodes(path: PathHop[]): Node[] {
  if (path.length === 0) return [];

  const nodes: Node[] = [
    { id: `0-${path[0].from}`, label: path[0].from, rel: null, terminal: false },
  ];
  path.forEach((hop, i) => {
    nodes.push({
      id: `${i + 1}-${hop.to}`,
      label: hop.to,
      rel: hop.rel,
      terminal: i === path.length - 1,
    });
  });
  return nodes;
}

export function PathGraph({ path }: { path: PathHop[] }) {
  const reduceMotion = useReducedMotion();
  const nodes = toNodes(path);
  if (nodes.length === 0) return null;

  return (
    <div>
      <span className="label">Path to ALS</span>

      <ol className="mt-2">
        {nodes.map((node, i) => (
          <li key={node.id}>
            {node.rel && (
              <div className="flex items-center gap-2 pl-[0.1875rem]">
                {/* Connector draws downward, so the chain reads as derived
                    rather than as a list that happens to be vertical. */}
                <motion.span
                  className="block w-px bg-rule-strong"
                  style={{ transformOrigin: "top" }}
                  initial={reduceMotion ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1, height: 14 }}
                  transition={{
                    duration: 0.18,
                    ease: EASE,
                    delay: 0.1 + i * 0.07,
                  }}
                  aria-hidden="true"
                />
                <motion.span
                  className="readout text-[0.6875rem] leading-none text-ink-faint"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{
                    duration: 0.2,
                    ease: EASE,
                    delay: 0.14 + i * 0.07,
                  }}
                >
                  {node.rel}
                </motion.span>
              </div>
            )}

            <motion.div
              className="flex items-center gap-2"
              initial={reduceMotion ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, ease: EASE, delay: i * 0.07 }}
            >
              <span
                className={cn(
                  "size-[7px] shrink-0 rounded-full",
                  node.terminal
                    ? "bg-ink ring-[2.5px] ring-ink/15"
                    : i === 0
                      ? "bg-ink"
                      : "border border-ink-soft bg-surface",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "readout truncate text-[0.75rem] leading-tight",
                  node.terminal ? "font-semibold text-ink" : "text-ink-soft",
                )}
                title={node.label}
              >
                {node.label}
              </span>
            </motion.div>
          </li>
        ))}
      </ol>
    </div>
  );
}
