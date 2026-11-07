import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:1440,height:900}, reducedMotion:"no-preference" });
const p = await c.newPage();
p.on("pageerror", e => console.log("PAGE ERROR:", String(e).slice(0,150)));
await p.goto(process.argv[2] ?? "http://localhost:5174/", { waitUntil:"networkidle" });
await p.waitForTimeout(5000);

// Tooltip on a descriptor label
const tpsa = p.getByRole("button", { name: "TPSA" }).first();
await tpsa.scrollIntoViewIfNeeded();
await tpsa.hover();
await p.waitForTimeout(900);
const tip = await p.locator('[role="tooltip"]').first().textContent().catch(()=>null);
console.log("tooltip text:", tip ? tip.slice(0,90)+"..." : "NONE");
await p.screenshot({ path:"demo/probe-tooltip.png" });

// Keyboard reachability of the same control
await p.keyboard.press("Tab");
const focused = await p.evaluate(()=>document.activeElement?.textContent?.slice(0,30));
console.log("focus after Tab:", focused);

// shadcn button present?
const btn = await p.getByRole("button", { name: /Cut by the patient filter/i }).count();
console.log("filter buttons found:", btn);
await b.close();
