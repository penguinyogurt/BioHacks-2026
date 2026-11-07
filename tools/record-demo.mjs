/**
 * Records the demo video.
 *
 *   node tools/record-demo.mjs [url] [outDir]
 *
 * Defaults to the dev server on :5173, writing a .webm into demo/.
 *
 * Paced for a human watching, not for a test: the funnel is allowed to finish,
 * scrolls are smooth and land with a beat before anything moves again. If you
 * change the run's DWELL_MS in useFunnelRun, change RUN_MS here too.
 */
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const URL_ = process.argv[2] ?? "http://localhost:5173/";
const OUT = resolve(process.argv[3] ?? "demo");

const VIEWPORT = { width: 1440, height: 900 };
/** 5 stages × 620ms dwell, plus the bar's 520ms settle and a beat. */
const RUN_MS = 5 * 620 + 520 + 600;

const beat = (page, ms) => page.waitForTimeout(ms);

/** Smooth-scrolls to an element and waits for it to actually settle. */
async function scrollTo(page, selector, { block = "start", pause = 1100 } = {}) {
  const found = await page.evaluate(
    ([sel, blk]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: blk });
      return true;
    },
    [selector, block],
  );
  if (!found) {
    console.warn(`  (skipped: no ${selector})`);
    return false;
  }
  await beat(page, pause);
  return true;
}

/** Clicks a filter button by its visible label. */
async function clickFilter(page, label, pause = 1600) {
  const button = page.getByRole("button", { name: new RegExp(label, "i") });
  if ((await button.count()) === 0) {
    console.warn(`  (skipped: no filter "${label}")`);
    return;
  }
  await button.first().click();
  await beat(page, pause);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: VIEWPORT },
    // The run autoplays and the whole point is watching it move.
    reducedMotion: "no-preference",
  });

  const page = await context.newPage();

  console.log(`Recording ${URL_}`);
  await page.goto(URL_, { waitUntil: "networkidle" });

  // Hold on the headline figures, then let the funnel run uninterrupted.
  console.log("  headline + funnel run");
  await beat(page, 1800);
  await beat(page, RUN_MS);
  await beat(page, 900);

  // Replay it once — this is the control that makes the demo repeatable at a
  // table, and it's worth showing that it exists.
  console.log("  replay");
  const replay = page.getByRole("button", { name: /replay/i });
  if (await replay.count()) {
    await replay.first().click();
    await beat(page, RUN_MS + 600);
  }

  console.log("  patient panel");
  await scrollTo(page, "#patient-heading", { pause: 2400 });

  console.log("  candidates");
  await scrollTo(page, "#candidates-heading", { pause: 1600 });
  await beat(page, 1800); // let the molecules and card stagger land

  console.log("  filters");
  await clickFilter(page, "Cut by the patient filter", 2600);
  await clickFilter(page, "Cut at the barrier", 2600);
  await clickFilter(page, "Survived every stage", 1800);

  console.log("  graveyard partition");
  await scrollTo(page, "#graveyard-heading", { pause: 3200 });

  console.log("  validation");
  await scrollTo(page, "#validation-heading", { pause: 2600 });

  await beat(page, 800);

  await context.close();
  await browser.close();

  const file = readdirSync(OUT).find((f) => f.endsWith(".webm"));
  if (!file) throw new Error("playwright wrote no video");
  const final = join(OUT, "biohacks-demo.webm");
  renameSync(join(OUT, file), final);
  console.log(`\n✓ ${final}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
