import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { cn } from "@/lib/utils";

const W = 1100;
const H = 680;
const PAD = 28;

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (node: GraphNode) => void;
};

function restLength(kind: GraphEdge["kind"], sourceKind: NodeKind, targetKind: NodeKind) {
  if (kind === "bucket") return 210;
  if (sourceKind === "rule" || targetKind === "rule") return 150;
  if (sourceKind === "gene" || targetKind === "gene") return 92;
  if (kind === "cut") return 170;
  return 118;
}

type NodeKind = GraphNode["kind"];

function radius(kind: NodeKind) {
  if (kind === "als") return 18;
  if (kind === "bucket") return 13;
  if (kind === "rule") return 8;
  if (kind === "drug") return 6.5;
  return 5;
}

function fill(n: SimNode, selected: boolean) {
  if (n.kind === "als") return "var(--ink)";
  if (n.kind === "bucket") {
    return n.bucket === "never_arrived" ? "var(--bucket-never)" : "var(--bucket-arrived)";
  }
  if (n.kind === "rule") return "var(--cut)";
  if (n.kind === "drug") return n.eliminated ? "var(--cut)" : "var(--ink)";
  if (selected) return "var(--ink)";
  return "var(--paper)";
}

function stroke(n: SimNode) {
  if (n.kind === "gene" || n.kind === "pathway") return "var(--ink-soft)";
  if (n.kind === "rule") return "var(--cut-rule)";
  return "transparent";
}

function seed(nodes: GraphNode[]): SimNode[] {
  const alsX = W * 0.42;
  const alsY = H * 0.5;
  let i = 0;
  return nodes.map((n) => {
    if (n.kind === "als") {
      return { ...n, x: alsX, y: alsY, vx: 0, vy: 0 };
    }
    if (n.kind === "bucket") {
      const y = n.bucket === "never_arrived" ? H * 0.28 : H * 0.72;
      return { ...n, x: W * 0.88, y, vx: 0, vy: 0 };
    }
    if (n.kind === "rule") {
      const a = i++ * 0.9 - 1.2;
      return {
        ...n,
        x: alsX + Math.cos(a) * 230,
        y: alsY + Math.sin(a) * 230,
        vx: 0,
        vy: 0,
      };
    }
    const ring = n.kind === "drug" ? 250 : 135;
    const a = i++ * 2.399963;
    return {
      ...n,
      x: alsX + Math.cos(a) * ring + (Math.random() - 0.5) * 24,
      y: alsY + Math.sin(a) * ring * 0.82 + (Math.random() - 0.5) * 24,
      vx: 0,
      vy: 0,
    };
  });
}

function tick(nodes: SimNode[], edges: GraphEdge[], byId: Map<string, SimNode>) {
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 16) {
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const min = radius(a.kind) + radius(b.kind) + 14;
      const force = ((min * min) / d2) * 2.4;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const rest = restLength(e.kind, a.kind, b.kind);
    const k = e.kind === "path" ? 0.045 : 0.02;
    const f = (d - rest) * k;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const node of nodes) {
    if (node.kind === "als") {
      node.x = W * 0.42;
      node.y = H * 0.5;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    if (node.kind === "bucket") {
      node.vx *= 0.6;
      node.vy *= 0.6;
    }
    node.vx *= 0.72;
    node.vy *= 0.72;
    node.x = Math.min(W - PAD, Math.max(PAD, node.x + node.vx));
    node.y = Math.min(H - PAD, Math.max(PAD, node.y + node.vy));
  }
}

export function GraphCanvas({ nodes, edges, selectedId, onSelect }: Props) {
  const [sim, setSim] = useState<SimNode[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(sim.map((n) => [n.id, n])), [sim]);
  const frame = useRef(0);

  useEffect(() => {
    const next = seed(nodes);
    const index = new Map(next.map((n) => [n.id, n]));
    for (let i = 0; i < 90; i++) tick(next, edges, index);
    setSim(next.map((n) => ({ ...n })));
    cancelAnimationFrame(frame.current);
    let steps = 0;
    const run = () => {
      steps += 1;
      tick(next, edges, index);
      if (steps % 2 === 0) setSim(next.map((n) => ({ ...n })));
      if (steps < 140) frame.current = requestAnimationFrame(run);
    };
    frame.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame.current);
  }, [nodes, edges]);

  const labelled = new Set<string>([selectedId ?? "", hoverId ?? ""]);
  for (const n of sim) {
    if (n.kind === "als" || n.kind === "bucket" || n.kind === "rule") labelled.add(n.id);
    if (n.kind === "drug" && n.candidate && n.candidate.kg.rank <= 12) labelled.add(n.id);
    if (n.kind === "drug" && n.eliminated && n.candidate?.eliminated_at === "patient_filter") {
      labelled.add(n.id);
    }
  }

  return (
    <svg
      data-testid="kg-canvas"
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label="Knowledge graph of drugs, genes, and ALS"
    >
      <rect width={W} height={H} fill="var(--paper)" fillOpacity="0.35" />
      <defs>
        <radialGradient id="als-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {sim
        .filter((n) => n.kind === "als")
        .map((n) => (
          <circle key="glow" cx={n.x} cy={n.y} r="64" fill="url(#als-glow)" />
        ))}

      {edges.map((e) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;
        const hot = e.source === selectedId || e.target === selectedId || e.source === hoverId || e.target === hoverId;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.kind === "cut" ? "var(--cut-rule)" : "var(--rule-strong)"}
            strokeWidth={hot ? 1.8 : e.kind === "path" ? 1.15 : 0.9}
            strokeOpacity={hot ? 0.95 : 0.38}
          />
        );
      })}

      {sim.map((n) => {
        const r = radius(n.kind);
        const selected = n.id === selectedId;
        const hover = n.id === hoverId;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            className="cursor-pointer"
            data-kind={n.kind}
            data-name={n.label}
            data-survivor={n.kind === "drug" && !n.eliminated ? "true" : "false"}
            tabIndex={0}
            role="button"
            aria-label={n.label}
            onClick={() => onSelect(n)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onSelect(n);
              }
            }}
            onMouseEnter={() => setHoverId(n.id)}
            onMouseLeave={() => setHoverId((id) => (id === n.id ? null : id))}
          >
            {selected && (
              <circle r={r + 8} fill="none" stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1.2" />
            )}
            <circle r={Math.max(r + 10, 16)} fill="transparent" />
            <circle
              r={r + (hover ? 1.4 : 0)}
              fill={fill(n, selected)}
              stroke={stroke(n)}
              strokeWidth={n.kind === "gene" || n.kind === "pathway" ? 1.4 : 0}
              className={cn(n.kind === "als" && "origin-center")}
            />
            {labelled.has(n.id) && (
              <text
                y={r + 12}
                textAnchor="middle"
                className="pointer-events-none"
                fill="var(--ink)"
                fontSize={n.kind === "als" ? 13 : 10}
                fontFamily="var(--font-sans)"
                fontWeight={n.kind === "als" ? 600 : 500}
              >
                {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
