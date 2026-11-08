/**
 * Validate any pipeline JSON against the contract, from the command line.
 *
 *   npm run validate --prefix backend/contract -- path/to/your.json
 *   npm run validate --prefix backend/contract    # defaults to backend/data/pipeline.json
 *
 * The path is relative to where you ran npm, not to backend/contract.
 *
 * This exists so the Python module owners can check merge.py output without
 * running the frontend. Exit code 1 on failure, so it drops into a script.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePipeline } from "./contract.ts";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
// which resolves to a nonexistent "C:\C:\..." path.
const DEFAULT = fileURLToPath(new URL("../data/pipeline.json", import.meta.url));
// `npm --prefix` runs this from backend/contract; INIT_CWD is where npm was invoked.
const target = process.argv[2] ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]) : DEFAULT;

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(target, "utf8"));
} catch (error) {
  console.error(`Could not read ${target}`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const result = parsePipeline(raw);

if (!result.ok) {
  console.error(`✕ ${target} does not satisfy the contract\n`);
  for (const problem of result.problems) console.error(`  ${problem}`);
  console.error(
    "\nThe contract is backend/contract/contract.ts. If the shape changed on " +
      "purpose, update it there, update backend/data/pipeline.json, and tell the team.",
  );
  process.exit(1);
}

const { meta, funnel, candidates, graveyard } = result.data;
const survivors = candidates.filter((c) => c.verdict === "survived").length;

console.log(`✓ ${target} satisfies the contract`);
console.log(
  `  ${funnel.length} stages · ${candidates.length} candidates ` +
    `(${survivors} surviving) · ${graveyard.length} graveyard entries`,
);
if (meta.sample) {
  console.log("  ⚠ meta.sample is true — the UI will show the sample-data badge");
}
