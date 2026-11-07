import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A scroll-spy rail down the left edge.
 *
 * The page is long and a judge exploring it alone has no idea how much is
 * below them or what's coming. The rail answers both without taking layout
 * room: it's a column of ticks in the 48px gutter beside the centred content,
 * and the label only appears on hover or focus.
 *
 * Deliberately not a sticky header — a header would eat vertical space from
 * every section, and the funnel's payoff has to stay above the fold.
 */

type Section = { id: string; label: string };

const SECTIONS: Section[] = [
  { id: "funnel-heading", label: "The funnel" },
  { id: "patient-heading", label: "The patient" },
  { id: "kg-heading", label: "Knowledge graph" },
  { id: "candidates-heading", label: "Candidates" },
  { id: "graveyard-heading", label: "Failed trials" },
  { id: "validation-heading", label: "Validation" },
  { id: "provenance-heading", label: "How it's built" },
];

export function SectionNav() {
  const [active, setActive] = useState<string | null>(null);
  const [present, setPresent] = useState<Section[]>([]);

  useEffect(() => {
    // Only offer links to sections that actually rendered — the panels are
    // conditional on the data carrying them.
    const found = SECTIONS.filter((s) => document.getElementById(s.id));
    setPresent(found);
    if (found.length === 0) return;

    // rootMargin pulls the detection line to roughly a third down the
    // viewport, so the rail marks the section you're reading rather than the
    // one just entering from the bottom.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );

    for (const s of found) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  if (present.length === 0) return null;

  return (
    <nav
      aria-label="Sections"
      className="pointer-events-none fixed top-1/2 left-0 z-30 hidden -translate-y-1/2 pl-3 lg:block"
    >
      <ul className="flex flex-col gap-1">
        {present.map((section) => {
          const isActive = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="pointer-events-auto group flex items-center gap-2 py-1.5"
              >
                <span
                  className={cn(
                    "block h-px transition-all duration-300 ease-out",
                    isActive
                      ? "w-6 bg-ink"
                      : "w-3 bg-rule-strong group-hover:w-5 group-hover:bg-ink-soft",
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    // The label is ~144px wide and the gutter is narrower
                    // than that, so it overlaps the panel edge. It gets its
                    // own backing rather than printing onto the content.
                    "label rounded bg-paper/85 px-1.5 py-0.5 whitespace-nowrap backdrop-blur-sm transition-opacity duration-200 ease-out",
                    // Visible on hover, on keyboard focus, or when current —
                    // a rail you can only read with a mouse is no rail.
                    isActive
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-80 group-focus-visible:opacity-100",
                  )}
                >
                  {section.label}
                </span>
                {isActive && <span className="sr-only">(current section)</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
