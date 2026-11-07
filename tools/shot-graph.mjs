import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:5918/";
const OUT = resolve(
  process.argv[3] ??
    "C:/Users/neopr/AppData/Local/Cursor/AgentStores/cursor_agent_stores/bc-2ac397bd-200f-4775-a0e8-01e27e7de713/files/media/graph-ui.png",
);
const VIDEO_DIR = process.argv[4]
  ? resolve(process.argv[4])
  : resolve(dirname(OUT), "graph-ui-video");

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(VIDEO_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "no-preference",
  recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="kg-canvas"] circle', { timeout: 45000 });
await page.waitForTimeout(2800);

const survivor = page.locator('[data-kind="drug"][data-survivor="true"]').first();
await survivor.click({ force: true });
await page.waitForTimeout(900);
await page.screenshot({ path: OUT, fullPage: false });

await page.locator('[data-stage="trial_history"]').click();
await page.waitForTimeout(1400);
const graveyard = page.locator('[data-kind="bucket"]').first();
if (await graveyard.count()) {
  await graveyard.click({ force: true });
  await page.waitForTimeout(700);
}

await page.locator('[data-stage="patient_filter"]').click();
await page.waitForTimeout(1400);
const riluzole = page.locator('[data-name="riluzole"]');
if (await riluzole.count()) await riluzole.first().click({ force: true });
await page.waitForTimeout(800);

const lithium = page.locator('[data-preset="Lithium carbonate"]');
if (await lithium.count()) {
  await lithium.click();
  await page.waitForTimeout(1500);
}

await context.close();
await browser.close();
console.log(`wrote ${OUT}`);
console.log(`video dir ${VIDEO_DIR}`);
