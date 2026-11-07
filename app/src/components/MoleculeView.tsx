import { useEffect, useRef, useState } from "react";
import SmilesDrawer from "smiles-drawer";
import { cn } from "@/lib/utils";

/**
 * Renders a 2D structure from a SMILES string.
 *
 * The structure is the first thing a chemist reads on a card — a drug is its
 * shape, and the barrier model's entire argument is about that shape. Drawing
 * it from the same SMILES the model consumed means the picture can't drift
 * from the prediction.
 *
 * smiles-drawer is CJS with a namespace default export, so it's imported as
 * a default and the classes come off it as statics. Parsing can fail on a
 * malformed SMILES; that's a data problem, not a reason to break the card.
 */

// Monochrome on purpose: colour means elimination in this app, and a
// CPK-coloured molecule would be the loudest thing on screen for no
// information gain.
const INK = "#2b2f36";
const INK_SOFT = "#5c626c";

const CLINICAL_THEME: Record<string, string> = {
  C: INK,
  N: INK,
  O: INK,
  F: INK,
  CL: INK,
  BR: INK,
  I: INK,
  P: INK,
  S: INK,
  B: INK,
  SI: INK,
  H: INK_SOFT,
  BACKGROUND: "#00000000",
};

type Props = {
  smiles: string;
  /** The drug name, so the figure isn't anonymous to a screen reader. */
  name: string;
  height?: number;
  className?: string;
};

export function MoleculeView({ smiles, name, height = 108, className }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;

    let cancelled = false;
    setFailed(false);
    target.innerHTML = "";

    const drawer = new SmilesDrawer.SmiDrawer({
      // The drawer scales the structure to fit this box, so a narrower box
      // means a larger molecule. 240×height fills the card without the wide
      // side margins a 300-wide box leaves on compact molecules.
      width: 240,
      height,
      bondThickness: 1.2,
      bondLength: 22,
      fontSizeLarge: 7,
      fontSizeSmall: 5,
      padding: 4,
      terminalCarbons: false,
      compactDrawing: false,
      themes: { clinical: CLINICAL_THEME },
    });

    try {
      drawer.draw(
        smiles,
        target,
        "clinical",
        () => {},
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    } catch {
      if (!cancelled) setFailed(true);
    }

    return () => {
      cancelled = true;
      // The drawer appends into the node; clear it so a re-render doesn't
      // stack two structures on top of each other.
      if (target) target.innerHTML = "";
    };
  }, [smiles, height]);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[3px] bg-surface-sunk",
          className,
        )}
        style={{ height }}
      >
        <span className="label">Structure unavailable</span>
      </div>
    );
  }

  return (
    <div
      className={cn("overflow-hidden rounded-[3px] bg-surface-sunk", className)}
      style={{ height }}
    >
      <svg
        ref={ref}
        viewBox={`0 0 240 ${height}`}
        role="img"
        aria-label={`Chemical structure of ${name}`}
        className="h-full w-full"
      />
    </div>
  );
}
