/**
 * Records the demo video.
 *
 *   node tools/record-demo.mjs [url] [outDir]
 *
 * Paced for a human watching, not for a test: the funnel is allowed to
 * finish, scrolls are smooth and land with a beat before anything moves
 * again. If you change DWELL_MS in useFunnelRun, change RUN_MS here too.
 */
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const URL_ = process.argv[2] ?? "http://localhost:5173/";
const OUT = resolve(process.argv[3] ?? "demo");

const VIEWPORT = { width: 1440, height: 900 };
/** 5 stages x 620ms dwell, plus the bar's 520ms settle and a beat. */
const RUN_MS = 5 * 620 + 520 + 600;

const beat = (page, ms) => page.waitForTimeout(ms);

/** Smooth-scrolls to an element and waits for it to settle. */
async function scrollTo(page, selector, { pause = 1200 } = {}) {
  const found = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    // Leave the panel's heading clear of the viewport edge.
    const y = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: y, behavior: "smooth" });
    return true;
  }, selector);
  if (!found) {
    console.warn(`  (skipped: no ${selector})`);
    return false;
  }
  await beat(page, pause);
  return true;
}

async function clickFilter(page, label, pause = 1600) {
  const button = page.getByRole("button", { name: new RegExp(label, "i") });
  if ((await button.count()) === 0) {
    console.warn(`  (skipped: no filter "${label}")`);
    return;
  }
  await button.first().click();
  await beat(page, pause);
}

/** Parks the pointer over a node so its readout panel fills in on camera. */
async function hoverFirst(page, selector, pause = 1600) {
  const target = page.locator(selector).first();
  if ((await target.count()) === 0) {
    console.warn(`  (skipped: nothing at ${selector})`);
    return;
  }
  try {
    await target.hover({ timeout: 2500 });
    await beat(page, pause);
  } catch {
    console.warn(`  (could not hover ${selector})`);
  }
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
  page.on("pageerror", (e) => console.log(`  [page error] ${String(e).slice(0, 140)}`));

  console.log(`Recording ${URL_}`);
  await page.goto(URL_, { waitUntil: "networkidle" });

  // Hold on the hero — the claim as arithmetic, counting up.
  console.log("  hero");
  await beat(page, 3200);

  console.log("  headline figures + funnel run");
  await scrollTo(page, "#funnel-heading", { pause: 600 });
  await beat(page, RUN_MS);
  await beat(page, 700);

  console.log("  replay");
  const replay = page.getByRole("button", { name: /replay/i });
  if (await replay.count()) {
    await replay.first().click();
    await beat(page, RUN_MS + 500);
  }

  console.log("  patient panel");
  await scrollTo(page, "#patient-heading", { pause: 2600 });

  console.log("  knowledge graph");
  if (await scrollTo(page, "#kg-heading", { pause: 2000 })) {
    // Land on a hub node so the convergence readout is populated on camera.
    await hoverFirst(page, "#kg-heading ~ * circle", 2200);
    await beat(page, 800);
  }

  console.log("  candidates");
  await scrollTo(page, "#candidates-heading", { pause: 2200 });

  // Story order: the contribution, then the state almost nobody builds,
  // then the ones already tried.
  console.log("  filters");
  await clickFilter(page, "Cut by the patient filter", 2800);
  await clickFilter(page, "Cut at the barrier", 2800);
  await clickFilter(page, "Already failed a trial", 2400);
  await clickFilter(page, "Survived every stage", 1600);

  console.log("  graveyard partition");
  await scrollTo(page, "#graveyard-heading", { pause: 4000 });

  console.log("  validation");
  await scrollTo(page, "#validation-heading", { pause: 2600 });

  console.log("  provenance");
  await scrollTo(page, "#provenance-heading", { pause: 3600 });

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
