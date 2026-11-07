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

const beat = (page, ms) => page.waitForTimeout(ms);

/**
 * Waits for the funnel run to actually finish, rather than guessing at its
 * duration. The run is nominally 3.1s, but it only starts once the funnel
 * scrolls into view and its interval competes with the background shader for
 * the main thread — a fixed timeout scrolled away mid-run. The Replay button
 * reads "Running…" until it lands, so that is the signal.
 */
async function waitForRun(page, { timeout = 20000 } = {}) {
  try {
    await page
      .getByRole("button", { name: /^replay$/i })
      .first()
      .waitFor({ state: "visible", timeout });
  } catch {
    console.warn("  (funnel run did not report finishing; carrying on)");
  }
}

/**
 * Smooth-scrolls to an element and waits for it to settle.
 *
 * `center` is for sections taller than the viewport — the knowledge graph is
 * ~840px plus its heading, so top-aligning it cuts the bottom of the circle
 * off camera.
 */
async function scrollTo(page, selector, { pause = 1200, center = false } = {}) {
  const found = await page.evaluate(
    ([sel, centre]) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const panel = el.closest("section") ?? el;
      const box = (centre ? panel : el).getBoundingClientRect();
      const y = centre
        ? box.top + window.scrollY - Math.max(0, (window.innerHeight - box.height) / 2)
        : box.top + window.scrollY - 72;
      window.scrollTo({ top: y, behavior: "smooth" });
      return true;
    },
    [selector, center],
  );
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
  const all = page.locator(selector);
  const n = await all.count();
  // A hub rather than the first node: hubs are the ones several drugs share,
  // which is what the readout is for.
  const target = n > 0 ? all.nth(Math.min(2, n - 1)) : all.first();
  if ((await target.count()) === 0) {
    console.warn(`  (skipped: nothing at ${selector})`);
    return;
  }
  try {
    // force: the graph's hit targets sit under their visible marks, so
    // Playwright's actionability check sees them as covered. We only want the
    // pointer parked there for the camera, so the check is noise.
    await target.hover({ timeout: 3000, force: true });
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
  await waitForRun(page);
  await beat(page, 900);

  console.log("  replay");
  const replay = page.getByRole("button", { name: /^replay$/i });
  if (await replay.count()) {
    await replay.first().click();
    await beat(page, 400);
    await waitForRun(page);
    await beat(page, 700);
  }

  console.log("  patient panel");
  await scrollTo(page, "#patient-heading", { pause: 2600 });

  console.log("  knowledge graph");
  if (await scrollTo(page, "#kg-heading", { pause: 2400, center: true })) {
    // Land on a hub node so the convergence readout is populated on camera.
    await hoverFirst(page, "section[aria-labelledby=\"kg-heading\"] circle", 2200);
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
