/**
 * Capture full-resolution stills of each section, exactly as the recorder's
 * browser renders them.
 *
 *   node tools/shot.mjs [url]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL_ = process.argv[2] ?? "http://localhost:5173/";
const TARGETS = [
  ["hero", null],
  ["figures", "#funnel-heading"],
  ["patient", "#patient-heading"],
  ["kg", "#kg-heading, #knowledge-graph-heading, [id$='graph-heading']"],
  ["cards", "#candidates-heading"],
  ["graveyard", "#graveyard-heading"],
  ["validation", "#validation-heading"],
  ["provenance", "#provenance-heading"],
];

mkdirSync("demo", { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "no-preference",
});
const page = await context.newPage();

page.on("console", (m) => {
  if (m.type() === "error") console.log(`  [console error] ${m.text().slice(0, 160)}`);
});
page.on("pageerror", (e) => console.log(`  [page error] ${String(e).slice(0, 160)}`));

await page.goto(URL_, { waitUntil: "networkidle" });
await page.waitForTimeout(6000);

for (const [name, selector] of TARGETS) {
  if (selector) {
    const found = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ block: "start" });
      return true;
    }, selector);
    if (!found) {
      console.log(`  (no ${name}: ${selector})`);
      continue;
    }
    await page.waitForTimeout(1800);
  }
  await page.screenshot({ path: `demo/frame-${name}.png` });
  console.log(`  ✓ demo/frame-${name}.png`);
}

await browser.close();
