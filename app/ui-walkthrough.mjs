import { chromium } from "playwright";
import { mkdirSync } from "fs";

const out = "/cursor/stores/bc-2ac397bd-200f-4775-a0e8-01e27e7de713/media";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5918/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/als-funnel-loaded.png`, fullPage: true });
await page.getByRole("button", { name: "Run the funnel" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/als-funnel-animated.png`, fullPage: true });
await page.getByRole("button", { name: /graveyard/i }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/als-graveyard.png`, fullPage: true });
await page.getByRole("button", { name: /^live$/i }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Sucrose/i }).click({ force: true });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/als-live-sucrose.png`, fullPage: true });
await browser.close();
console.log("walkthrough screenshots ok");
