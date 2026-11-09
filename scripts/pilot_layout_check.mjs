// Layout check of the NEBULA Pilot panel: the dock (chips, meter, composer)
// whole and inside the screen, the boxes over the transcript (marked regions,
// Changes, the Auto panel) each in its own space, nothing covering the
// transcript or the composer, and the panel itself never a scroll pane. It
// walks the panel through its busy states on the synthetic demo with the
// scripted model (scripts/demo/scripted-model.mjs), on desktops and on a phone
// with the bottom sheet (at its lowest, default and highest heights).
//
//   node scripts/demo/scripted-model.mjs 18790 100 &
//   PW=<path to playwright-core> node scripts/pilot_layout_check.mjs <base-url> <out-dir> \
//     [--model=http://127.0.0.1:18790] [--viewports=1440x900,1280x800,390x844t]
//     [--engines=chromium,webkit] [--states=idle,marks,cards,meter,auto] [--demo] [--no-shots]
//
// <base-url> is a running console: the native server (its dataset's stages
// run, or the script runs them), or the Pyodide build with --demo (it loads
// the demo volume and runs the pipeline first). A viewport ending in "t" is a
// touch screen. Synthetic data only: every screenshot carries the © line.
// It writes <out-dir>/pilot-layout.json and one screenshot per state, and
// exits 1 when a state breaks the layout.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pw = require(process.env.PW ?? "playwright-core");

const args = process.argv.slice(2);
const flag = (name, dflt) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;
const positional = args.filter((a) => !a.startsWith("--"));
const base = positional[0] ?? "http://127.0.0.1:8000/";
const out = positional[1] ?? "pilot-layout-out";
const MODEL = flag("model", "http://127.0.0.1:18790");
const VIEWPORTS = flag("viewports", "1440x900,1280x800,390x844t").split(",").map((v) => {
  const [, w, h, t] = /^(\d+)x(\d+)(t?)$/.exec(v);
  return { name: v, w: Number(w), h: Number(h), touch: t === "t" };
});
const ENGINES = flag("engines", "chromium").split(",");
const STATES = flag("states", "idle,marks,cards,meter,auto").split(",");
const demo = args.includes("--demo");
const shots = !args.includes("--no-shots");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Follow off: on a phone it lowers the sheet to show the views the replies examine.
const SETTINGS = { baseUrl: `${MODEL}/v1`, model: "scripted-pilot", apiKey: "", temperature: 0.2, attachImages: false, useTools: true, followViews: false };
const COPY = "© 2026 Tsung-Han Yang";

// ------------------------------------------------------------ the measurement (runs in the page)
function measure() {
  const P = [];
  const cls = (el) => "." + [...el.classList].join(".");
  const box = (el) => el.getBoundingClientRect();
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const inside = (a, b, tol = 1) => a.top >= b.top - tol && a.bottom <= b.bottom + tol && a.left >= b.left - tol && a.right <= b.right + tol;
  const screen = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  const panel = document.querySelector(".ai-side .ai-panel");
  if (!shown(panel)) return { problems: ["the panel is not open"] };
  const pr = box(panel);
  if (panel.scrollHeight > panel.clientHeight + 1) P.push(`the panel scrolls (${panel.scrollHeight} > ${panel.clientHeight})`);
  // The dock: every row whole, inside the panel and the screen.
  const dock = panel.querySelector(".ai-dock");
  const composer = panel.querySelector(".ai-composer");
  if (!shown(dock) || !shown(composer)) P.push("no dock or composer");
  else {
    for (const el of [...dock.children].filter(shown)) {
      if (!inside(box(el), pr)) P.push(`dock row ${cls(el)} is cut by the panel`);
      if (!inside(box(el), screen)) P.push(`dock row ${cls(el)} is off-screen`);
    }
  }
  // Nothing on top of the composer or the transcript: hit-test a grid of points.
  // Only the part its scroll box shows (`clip`): a box cut by its room is clipped, not covered.
  const covered = (el, name, clip = screen) => {
    const b = box(el);
    const r = { left: b.left, width: b.width, top: Math.max(b.top, clip.top), height: Math.min(b.bottom, clip.bottom) - Math.max(b.top, clip.top) };
    if (r.height < 4) return;
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const x = r.left + fx * r.width, y = r.top + fy * r.height;
        if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) continue;
        const top = document.elementFromPoint(x, y);
        if (top && !el.contains(top) && !top.closest(".report-overlay")) {
          P.push(`${name} covered at (${Math.round(x)}, ${Math.round(y)}) by ${cls(top)}`);
          return;
        }
      }
    }
  };
  if (shown(composer)) covered(composer, "the composer");
  // The room over the dock: its boxes in order, none over the next or past the room.
  // (.ai-chat: the panel before it had a room of its own, to compare.)
  const body = panel.querySelector(".ai-body") ?? panel.querySelector(".ai-chat");
  const transcript = panel.querySelector(".ai-transcript");
  const br = box(body);
  // On a very short panel the room is put away (the title row and the dock only).
  if (!shown(body)) return { problems: P, sheet: true, panel: Math.round(pr.height), transcript: 0, boxes: [], dock: shown(dock) ? Math.round(box(dock).height) : 0 };
  if (shown(dock) && !body.contains(dock) && br.bottom > box(dock).top + 1) P.push("the transcript's room runs under the dock");
  const boxes = [...body.children].filter((el) => shown(el) && el !== dock);
  for (let i = 1; i < boxes.length; i++) {
    if (box(boxes[i]).top < box(boxes[i - 1]).bottom - 1) P.push(`${cls(boxes[i])} overlaps ${cls(boxes[i - 1])}`);
  }
  for (const b of boxes) if (b !== transcript && box(b).bottom > br.bottom + 1) P.push(`${cls(b)} runs past its room`);
  if (shown(body)) covered(transcript, "the transcript", br);
  // The Auto panel: its header, Now line and Report row inside it.
  const auto = body.querySelector(".auto-panel");
  // (Should even those not fit, a phone's short sheet, the panel scrolls: its header stays.)
  if (auto) {
    const scrolls = auto.scrollHeight > auto.clientHeight + 1;
    for (const el of auto.querySelectorAll(":scope > .auto-top, :scope > .auto-msg-row, :scope > .auto-more")) {
      if (shown(el) && !inside(box(el), box(auto)) && !(scrolls && !el.classList.contains("auto-top"))) P.push(`${cls(el)} is cut in the Auto panel`);
    }
  }
  const sheet = panel.closest(".ai-side")?.getAttribute("data-mode") === "sheet";
  const th = Math.round(box(transcript).height);
  return {
    problems: P,
    sheet,
    panel: Math.round(pr.height),
    transcript: th,
    boxes: boxes.map((b) => `${cls(b).split(".")[1]} ${Math.round(box(b).height)}`),
    dock: shown(dock) ? Math.round(box(dock).height) : 0,
  };
}

// ------------------------------------------------------------ the walk
const report = [];
let failed = 0;

async function run(engine, vp) {
  const tag = `${engine}-${vp.name}`;
  const browser = await pw[engine].launch();
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    isMobile: vp.touch && engine !== "firefox",
    hasTouch: vp.touch,
  });
  await ctx.addInitScript(([s, copy]) => {
    try {
      if (!sessionStorage.getItem("pilot-layout-init")) {
        localStorage.clear();
        localStorage.setItem("nebula3d-llm-settings-v1", JSON.stringify(s));
        sessionStorage.setItem("pilot-layout-init", "1");
      }
    } catch {}
    if (window.top !== window) return;
    const put = () => {
      if (document.getElementById("pilot-layout-copy") || !document.body) return;
      const d = document.createElement("div");
      d.id = "pilot-layout-copy";
      d.textContent = copy;
      d.style.cssText = "position:fixed;right:8px;" + (innerWidth < 700 ? "top:2px;" : "bottom:6px;") + "z-index:2147483647;font:600 11px/1.2 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:3px 7px;border-radius:4px;pointer-events:none";
      document.body.appendChild(d);
    };
    document.addEventListener("DOMContentLoaded", put);
    setInterval(put, 500);
  }, [SETTINGS, COPY]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  ${tag} pageerror: ${e.message}`));
  const box = page.locator(".ai-composer textarea");
  const panel = page.locator(".auto-panel");
  const idle = () => page.waitForFunction(() => { const t = document.querySelector(".ai-composer textarea"); return t && !t.disabled && !document.querySelector(".ai-avatar-spin"); }, null, { timeout: 300000 });
  const ask = async (text) => { await idle(); await box.fill(text); await box.press("Enter"); await sleep(600); await idle(); await sleep(300); };
  const openPanel = async () => {
    if (!(await page.locator(".ai-side .ai-panel").isVisible().catch(() => false))) {
      await page.locator(".ai-sheetbar button, .ai-rail button").first().click();
      await sleep(600);
    }
    await box.waitFor({ state: "visible", timeout: 60000 });
  };
  const handle = page.getByRole("separator", { name: "Resize NEBULA Pilot" });
  const sheetTo = async (dir, n) => {
    await handle.focus();
    for (let i = 0; i < n; i++) await handle.press(dir > 0 ? "Shift+ArrowUp" : "Shift+ArrowDown");
    await sleep(350);
  };
  const state = async () => ((await panel.locator(".auto-state").textContent({ timeout: 1000 }).catch(() => "")) ?? "").trim();
  const waitState = async (re, ms = 600000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const s = await state();
      if (re.test(s)) return s;
      if (s === "Needs you") await panel.locator(".pc button", { hasText: /^Skip$/ }).click().catch(() => {});
      await sleep(250);
    }
    throw new Error(`the Auto panel never showed ${re}`);
  };
  const check = async (name) => {
    await sleep(500);
    const heights = [["", await page.evaluate(measure)]];
    if (shots) await page.screenshot({ path: join(out, `${tag}-${name}.png`) });
    if ((await page.locator(".ai-side").getAttribute("data-mode")) === "sheet") {
      // the lowest sheet and the highest, then back near the default (48 %)
      await sheetTo(-1, 8);
      heights.push(["lowest", await page.evaluate(measure)]);
      if (shots) await page.screenshot({ path: join(out, `${tag}-${name}-lowest.png`) });
      await sheetTo(1, 8);
      heights.push(["highest", await page.evaluate(measure)]);
      await sheetTo(-1, 4);
      await page.evaluate(() => document.activeElement?.blur());
    }
    for (const [at, m] of heights) {
      const label = `${tag} ${name}${at ? ` (${at} sheet)` : ""}`;
      report.push({ engine, viewport: vp.name, state: name, sheet: at || null, ...m });
      if (m.problems.length) failed++;
      console.log(`${m.problems.length ? "FAIL" : "ok  "} ${label}: transcript ${m.transcript}px · ${m.boxes?.join(" · ")} · dock ${m.dock}px${m.problems.length ? "\n       " + m.problems.join("\n       ") : ""}`);
    }
  };

  try {
    await page.goto(base, { waitUntil: "load" });
    await page.locator("nav button").first().waitFor({ timeout: 60000 });
    await sleep(1000);
    if (demo) {
      await page.getByRole("button", { name: /^Use demo$/ }).click();
      await page.waitForFunction(() => /synthetic/i.test(document.querySelector(".data-card")?.textContent ?? "") && !document.querySelector(".data-card .spin"), null, { timeout: 600000 });
    }
    const missing = await page.evaluate(() => /missing/i.test(document.querySelector(".data-card, main")?.textContent ?? ""));
    if (demo || missing) {
      await page.getByRole("button", { name: /^Run pipeline$/ }).click();
      await sleep(1000);
      await page.waitForFunction(() => !/Running…/.test(document.querySelector(".config-toolbar-run")?.textContent ?? ""), null, { timeout: 900000, polling: 500 });
      await sleep(1000);
    }
    await openPanel();
    if (STATES.includes("idle")) await check("idle");
    if (STATES.includes("marks")) {
      // Three marks on the selected dataset, as the store keeps them: put in
      // the store itself on a dev server (the Pyodide build's engine empties
      // on a reload), else saved where the store reads them and the page reloaded.
      const live = await page.evaluate(async () => {
        const id = localStorage.getItem("nebula3d.dataset.v1");
        const frame = { target: { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5 }, fit: { cx: 0, cy: 0, half: 1 }, data: { x0: -6, x1: 6, y0: -6, y1: 6 }, minHalf: 0.5, maxHalf: 6 };
        const mark = (n, label, where, center) => ({
          id: `M${n}`, datasetId: id, where, region: { shape: "box", center, half: [0.3, 0.3, 0.3] }, label, evidence: ["assess_stage.verdict"],
          created: new Date().toISOString(), view: { page: "cleanup", axis: "L", value: center[2], frame },
        });
        const marks = [mark(1, "Leftover intensity at a Bragg node", "punch", [2, 0, 0]), mark(2, "Ring residue at |Q| 2.7", "rings", [1, 1, 0]), mark(3, "Diffuse streak along H", "flatten", [1.5, 0.5, 0])];
        try {
          const store = await import(/* @vite-ignore */ `${location.origin}/src/state/markStore.ts`);
          store.useMarkStore.getState().restore(marks);
          return true;
        } catch {
          sessionStorage.setItem("nebula3d.marks.v1", JSON.stringify({ marks, next: 4, showAll: true }));
          return false;
        }
      });
      if (!live) {
        await page.reload({ waitUntil: "load" });
        await page.locator("nav button").first().waitFor({ timeout: 60000 });
        await sleep(1500);
        await openPanel();
      }
      await check("marks");
    }
    if (STATES.includes("cards")) {
      // Replies with Apply cards: each one's sample-fact card applied by a
      // click, and undone but the last, so Changes lists 10. (On a phone the
      // sheet is raised to click, then put back.)
      if (vp.touch) await sheetTo(1, 8);
      for (let i = 0; i < 10; i++) {
        await ask("Show me cards for the punch.");
        const group = page.locator(".pc-group").last();
        const apply = group.locator(".pc", { hasText: "Supercell" }).getByRole("button", { name: "Apply" });
        if (!(await apply.count())) continue;
        await apply.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await apply.click();
        await sleep(500);
        if (i < 9) {
          const undo = group.locator(".pc-done button", { hasText: "Undo" }).first();
          await undo.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await undo.click();
          await sleep(400);
        }
      }
      if (vp.touch) await sheetTo(-1, 4);
      const changes = page.locator(".ai-changes .ai-marks-toggle");
      if ((await changes.getAttribute("aria-expanded").catch(() => null)) === "false") await changes.click();
      await page.locator(".pc-group").last().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
      await check("cards");
    }
    if (STATES.includes("meter")) {
      for (let i = 0; i < 12; i++) {
        const level = await page.evaluate(() => ["amber", "red"].find((l) => document.querySelector(".ai-meter")?.classList.contains(`is-${l}`)) ?? null);
        if (level) break;
        await ask("long 14000");
      }
      const help = page.locator(".ai-meter-help");
      if (await help.count()) await help.click();
      await check("meter");
      if (await help.count()) await help.click();
    }
    if (STATES.includes("auto")) {
      await fetch(`${MODEL}/scenario?name=fix`);
      const go = page.locator(".ai-chip-act", { hasText: "Run auto analysis" });
      await go.waitFor({ state: "visible", timeout: 60000 });
      await idle();
      await go.click();
      await waitState(/Running/, 60000);
      await sleep(4000);
      await check("auto-running");
      for (let i = 0; i < 200; i++) {
        const pause = panel.locator(".auto-actions button", { hasText: /^Pause$/ });
        if ((await state()) === "Running" && (await pause.isEnabled().catch(() => false))) { await pause.click().catch(() => {}); await sleep(300); }
        if (/Paused/.test(await state())) break;
        if ((await state()) === "Needs you") await panel.locator(".pc button", { hasText: /^Skip$/ }).click().catch(() => {});
        await sleep(300);
      }
      await waitState(/Paused/, 120000);
      if (vp.touch) {
        const more = panel.locator(".auto-more");
        if ((await more.getAttribute("aria-expanded")) === "true") await more.click();
      }
      await check("auto-paused");
      await panel.locator(".auto-btn--go").click();
      await waitState(/Done/);
      await sleep(1000);
      if (vp.touch) await panel.locator(".auto-more").click();
      await check("auto-done");
      await fetch(`${MODEL}/scenario?name=clean`);
      await page.locator(".auto-panel .auto-btn--quiet").click().catch(() => {});
      await idle();
      await go.click();
      await waitState(/Running/, 60000);
      await sleep(2500);
      await panel.locator(".auto-btn--stop").click();
      await waitState(/Stopped|Done/, 120000);
      await check("auto-stopped");
    }
  } catch (e) {
    failed++;
    console.log(`FAIL ${tag}: ${e.message}`);
    report.push({ engine, viewport: vp.name, error: e.message });
    if (shots) await page.screenshot({ path: join(out, `${tag}-zz-error.png`) }).catch(() => {});
  }
  await browser.close();
}

for (const engine of ENGINES) for (const vp of VIEWPORTS) await run(engine, vp);
writeFileSync(join(out, "pilot-layout.json"), JSON.stringify(report, null, 1));
console.log(failed ? `${failed} state(s) broke the layout` : "every state held its layout");
process.exit(failed ? 1 : 0);
