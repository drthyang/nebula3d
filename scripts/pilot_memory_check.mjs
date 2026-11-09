// Memory check of a full NEBULA Pilot auto run: the tab's memory, DOM nodes,
// canvases and ImageData sampled every few seconds through a whole scripted
// auto session (scripts/demo/scripted-model.mjs), then while the finished run
// sits idle. It fails when, once the run is done and nothing happens, the
// tab's memory or DOM nodes keep growing, the page keeps rebuilding its DOM or
// burning CPU, or any of them passes a sane bound.
//
//   node scripts/demo/scripted-model.mjs 18790 100 &
//   PW=<path to playwright-core> node scripts/pilot_memory_check.mjs <base-url> <out-dir> \
//     [--model=http://127.0.0.1:18790] [--scenario=fix] [--follow=on|off]
//     [--idle=120] [--interval=5] [--run-limit=1800]
//     [--max-mb=3000] [--max-nodes=20000] [--grow-mb=150] [--grow-nodes=2000]
//     [--config='{"punchMinSig":"60"}']
//     [--max-cpu=0.5] [--max-mutations=200] [--max-layouts=10] [--shell] [--profile] [--snapshot]
//
// <base-url> is a running console: the native server with a synthetic volume
// (a realistic size is 401 × 401 × 301, which scripts/demo/synthetic_volume.py
// writes; the auto run runs its pipeline), or
// the Pyodide build with --demo (it loads the demo volume first). Synthetic
// data only: never point it at measured data you may not publish.
//
// Each sample (<out-dir>/memory.json, and a line on stdout):
//   js        performance.memory: the JS heap used / total (MB)
//   v8, oilpan, buffers  CDP Runtime.getHeapUsage: the V8 heap, the Blink
//             (Oilpan) heap and the ArrayBuffer backing stores (MB)
//   nodes, docs, listeners  CDP Memory.getDOMCounters (nodes not yet
//             collected count too: a page that rebuilds its DOM shows here),
//             and the nodes in the document now ("in DOM")
//   layout    CDP Performance.getMetrics: layout objects
//   lay/s     layouts a second (Performance.getMetrics LayoutCount): a page
//             at rest lays out a few times a second at most (a clock); one
//             caught in a layout loop does it hundreds of times with no DOM
//             change and no script, and its renderer's memory grows
//   rss, gpu  the renderer's and the GPU process's resident memory (MB), by
//             their pids from CDP SystemInfo.getProcessInfo
//   cpu       the renderer's CPU over the last interval (1 = one core)
//   canvases  live canvases (made and not yet collected; in the DOM) and
//             their pixels' bytes (MB)
//   images    live ImageData objects and their bytes (MB)
//   mut       DOM nodes added (each node of a subtree) or removed, and text
//             changed, per second
//   anim      the CSS animations running (each one restyles every frame)
// A call the page does not answer within 10 s is left out of its sample and
// named (slow=…): a busy main thread shows there. A gap between samples far
// longer than the interval is this script starved of CPU, not the page: on a
// loaded machine, read the renderer's cpu over that gap before calling it a hang.
//
// The checks, over the idle window after the run is done (each end measured
// after a forced garbage collection, so only what is kept counts):
//   - renderer memory grows by no more than --grow-mb, and stays under --max-mb
//     (the whole session's peak too);
//   - DOM nodes grow by no more than --grow-nodes, and stay under --max-nodes;
//   - the renderer's CPU averages under --max-cpu of a core;
//   - the DOM changes at no more than --max-mutations nodes a second (a clock
//     ticking is a few; a view drawn again and again is thousands);
//   - the page lays out no more than --max-layouts times a second (a CSS
//     layout loop shows here even when the DOM and the scripts are still);
// and over the whole session:
//   - the Bragg punch's record (GET /api/bragg/<id>/profile) is downloaded once
//     per version of its file: a read of a version already downloaded is a 304
//     (no body; Chromium reports it as a failed request, net::ERR_ABORTED, so
//     those are counted as the 304s they are), and no read fails otherwise.
// --config seeds the Configure form of every dataset the server lists (a
// stage set to need attention, so the auto run fixes or tunes it: with
// --scenario=tune its fix is a tuning run, whose card the transcript keeps).
// A run with tuning cards, as the Pilot's idle layout loop needed (on the
// synthetic volume a punch threshold of 60 leaves the punch needing attention):
//   ... --scenario=tune --config='{"punchMinSig":"60"}'
// --shell runs Playwright's headless shell instead of Chromium (its default
// for headless runs); --profile writes a CPU profile of the idle window, and
// --snapshot a heap snapshot at its end.
// Exits 1 when a check fails, 2 when the run itself did not finish.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pw = require(process.env.PW ?? "playwright-core");

const args = process.argv.slice(2);
const flag = (name, dflt) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;
const num = (name, dflt) => Number(flag(name, dflt));
const positional = args.filter((a) => !a.startsWith("--"));
const base = positional[0] ?? "http://127.0.0.1:8000/";
const out = positional[1] ?? "pilot-memory-out";
const MODEL = flag("model", "http://127.0.0.1:18790");
const SCENARIO = flag("scenario", "fix");
const FOLLOW = flag("follow", "on") !== "off";
const IDLE_S = num("idle", 120);
const INTERVAL_S = num("interval", 5);
const RUN_LIMIT_S = num("run-limit", 1800);
const MAX_MB = num("max-mb", 3000);
const MAX_NODES = num("max-nodes", 20000);
const GROW_MB = num("grow-mb", 150);
const GROW_NODES = num("grow-nodes", 2000);
const MAX_CPU = num("max-cpu", 0.5);
const MAX_MUT = num("max-mutations", 200);
const MAX_LAYOUTS = num("max-layouts", 10);
const demo = args.includes("--demo");
const shell = args.includes("--shell");
const profile = args.includes("--profile");
const snapshot = args.includes("--snapshot");
mkdirSync(out, { recursive: true });
const CONFIG = JSON.parse(flag("config", "null") ?? "null");
const configs = {};
if (CONFIG && !demo) {
  const list = await fetch(new URL("api/datasets", base)).then((r) => r.json());
  for (const d of list) configs[d.id] = CONFIG;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTINGS = { baseUrl: `${MODEL}/v1`, model: "scripted-pilot", apiKey: "", temperature: 0.2, attachImages: false, useTools: true, followViews: FOLLOW };
const MB = (b) => (b == null ? null : Math.round(b / 1e5) / 10);

// ------------------------------------------------------------ in the page: what it makes
// Canvases (however made) and ImageData, held weakly: a live one has not been
// collected yet. And a count of the DOM's changes.
function instrument() {
  if (window.__mem) return;
  const S = (window.__mem = { canvases: [], images: [], madeCanvases: 0, madeImages: 0, mutations: 0 });
  const keep = (list, o) => list.push(new WeakRef(o));
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) {
    const el = createElement.call(this, tag, ...rest);
    if (String(tag).toLowerCase() === "canvas") {
      S.madeCanvases++;
      keep(S.canvases, el);
    }
    return el;
  };
  if (typeof OffscreenCanvas === "function") {
    const Native = OffscreenCanvas;
    window.OffscreenCanvas = new Proxy(Native, {
      construct(target, a) {
        const c = Reflect.construct(target, a);
        S.madeCanvases++;
        keep(S.canvases, c);
        return c;
      },
    });
  }
  const image = (img) => {
    S.madeImages++;
    keep(S.images, img);
    return img;
  };
  for (const proto of [CanvasRenderingContext2D.prototype, typeof OffscreenCanvasRenderingContext2D === "function" ? OffscreenCanvasRenderingContext2D.prototype : null]) {
    if (!proto) continue;
    for (const m of ["createImageData", "getImageData"]) {
      const f = proto[m];
      proto[m] = function (...a) {
        return image(f.apply(this, a));
      };
    }
  }
  const NativeImageData = window.ImageData;
  window.ImageData = new Proxy(NativeImageData, { construct: (target, a) => image(Reflect.construct(target, a)) });
  const watch = () =>
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type !== "childList") S.mutations += 1;
        // A subtree added counts each of its nodes (one removed, its root: it is gone).
        else for (const n of r.addedNodes) S.mutations += 1 + (n.getElementsByTagName ? n.getElementsByTagName("*").length : 0);
        if (r.type === "childList") S.mutations += r.removedNodes.length;
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  if (document.documentElement) watch();
  else document.addEventListener("readystatechange", watch, { once: true });
}

function pageSample() {
  const S = window.__mem;
  const live = (list) => {
    const kept = [];
    for (const w of list) if (w.deref()) kept.push(w);
    list.length = 0;
    list.push(...kept);
    return kept.map((w) => w.deref()).filter(Boolean);
  };
  const canvases = S ? live(S.canvases) : [];
  const images = S ? live(S.images) : [];
  const m = performance.memory ?? {};
  // The nodes in the document now (the CDP counter counts those not yet collected too).
  let inDom = 0;
  for (const w = document.createTreeWalker(document, NodeFilter.SHOW_ALL); w.nextNode(); ) inDom++;
  return {
    inDom,
    jsUsed: m.usedJSHeapSize ?? null,
    jsTotal: m.totalJSHeapSize ?? null,
    canvases: canvases.length,
    canvasesInDom: document.querySelectorAll("canvas").length,
    canvasBytes: canvases.reduce((a, c) => a + (c.width || 0) * (c.height || 0) * 4, 0),
    images: images.length,
    imageBytes: images.reduce((a, i) => a + i.data.byteLength, 0),
    madeCanvases: S?.madeCanvases ?? 0,
    madeImages: S?.madeImages ?? 0,
    mutations: S?.mutations ?? 0,
    autoState: document.querySelector(".auto-panel .auto-state")?.textContent?.trim() ?? null,
    // The animations running: each one repaints (and restyles) every frame.
    animations: document.getAnimations().filter((a) => a.playState === "running").map((a) => {
      const t = a.effect?.target;
      const cls = t?.getAttribute?.("class")?.split(" ")[0] ?? t?.tagName ?? "?";
      return `${a.animationName ?? "anim"}@${cls}${a.effect?.pseudoElement ?? ""}`;
    }),
  };
}

// ------------------------------------------------------------ the browser side
// Asynchronously, with a timeout: the sampler never blocks the script's event loop.
const rssOf = (pids) =>
  new Promise((resolve) => {
    if (!pids.length) return resolve({});
    execFile("ps", ["-o", "pid=,rss=", "-p", pids.join(",")], { encoding: "utf8", timeout: 5000 }, (err, txt) => {
      if (err) return resolve({});
      resolve(Object.fromEntries(txt.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number)).map(([p, kb]) => [p, kb * 1024])));
    });
  });

const browser = await pw.chromium.launch(shell ? {} : { channel: "chromium", args: ["--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([s, c]) => {
  try {
    if (!sessionStorage.getItem("pilot-memory-init")) {
      localStorage.clear();
      localStorage.setItem("nebula3d-llm-settings-v1", JSON.stringify(s));
      if (Object.keys(c).length) localStorage.setItem("nebula3d.configByDataset.v1", JSON.stringify(c));
      sessionStorage.setItem("pilot-memory-init", "1");
    }
  } catch {}
}, [SETTINGS, configs]);
await ctx.addInitScript(instrument);
const page = await ctx.newPage();
let crashed = false;
page.on("crash", () => {
  crashed = true;
  console.log("PAGE CRASH");
});
page.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
// The punch record's reads: bodies by ETag (one per version), 304s, and
// reads that failed with no answer at all.
const PROFILE = /\/api\/bragg\/[^/]+\/profile$/;
const punchReads = { bodies: {}, notModified: 0, failed: 0, answered: new WeakSet() };
page.on("response", (r) => {
  if (!PROFILE.test(new URL(r.url()).pathname)) return;
  punchReads.answered.add(r.request());
  if (r.status() === 304) punchReads.notModified += 1;
  else if (r.ok()) {
    const tag = r.headers().etag ?? "(no tag)";
    punchReads.bodies[tag] = (punchReads.bodies[tag] ?? 0) + 1;
  }
});
page.on("requestfailed", (r) => {
  if (PROFILE.test(new URL(r.url()).pathname) && !punchReads.answered.has(r)) punchReads.failed += 1;
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
const bcdp = await browser.newBrowserCDPSession();

const t0 = Date.now();
const clock = () => {
  const s = Math.round((Date.now() - t0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const samples = [];
let last = null;
// A sample's call that does not answer in time (the page's main thread busy)
// is said, and the sample goes without it.
const within = (label, p, dflt, ms = 10000) => {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      slow[label] = (slow[label] ?? 0) + 1;
      resolve(dflt);
    }, ms);
  });
  return Promise.race([Promise.resolve(p).catch(() => dflt), late]).finally(() => clearTimeout(timer));
};
const slow = {};
async function sample(phase) {
  if (crashed) return null;
  const [p, dom, heap, perf, procs] = await Promise.all([
    within("page", page.evaluate(pageSample), {}),
    within("dom", cdp.send("Memory.getDOMCounters"), {}),
    within("heap", cdp.send("Runtime.getHeapUsage"), {}),
    within("metrics", cdp.send("Performance.getMetrics"), { metrics: [] }),
    within("processes", bcdp.send("SystemInfo.getProcessInfo"), { processInfo: [] }),
  ]);
  const metric = (n) => perf.metrics.find((m) => m.name === n)?.value ?? null;
  const renderers = procs.processInfo.filter((x) => x.type === "renderer");
  const gpu = procs.processInfo.filter((x) => x.type === "GPU");
  const rss = await within("rss", rssOf([...renderers, ...gpu].map((x) => x.id)), {});
  const cpuTime = renderers.reduce((a, x) => a + x.cpuTime, 0);
  const now = Date.now();
  const s = {
    t: Math.round((now - t0) / 1000),
    phase,
    js: MB(p.jsUsed),
    jsTotal: MB(p.jsTotal),
    v8: MB(heap.usedSize),
    oilpan: MB(heap.embedderHeapUsedSize),
    buffers: MB(heap.backingStorageSize),
    nodes: dom.nodes,
    inDom: p.inDom,
    docs: dom.documents,
    listeners: dom.jsEventListeners,
    layout: metric("LayoutObjects"),
    rss: MB(renderers.reduce((a, x) => a + (rss[x.id] ?? 0), 0)),
    gpu: MB(gpu.reduce((a, x) => a + (rss[x.id] ?? 0), 0)),
    cpu: last ? Math.round(((cpuTime - last.cpuTime) / ((now - last.now) / 1000)) * 100) / 100 : null,
    layouts: metric("LayoutCount"),
    lps: last && metric("LayoutCount") != null && last.layouts != null ? Math.round(((metric("LayoutCount") - last.layouts) / ((now - last.now) / 1000)) * 10) / 10 : null,
    canvases: p.canvases,
    canvasesInDom: p.canvasesInDom,
    canvasMB: MB(p.canvasBytes),
    images: p.images,
    imageMB: MB(p.imageBytes),
    madeCanvases: p.madeCanvases,
    madeImages: p.madeImages,
    mut: last ? Math.round((p.mutations - last.mutations) / ((now - last.now) / 1000)) : null,
    auto: p.autoState,
    animations: p.animations?.length ?? null,
    running: p.animations?.length ? [...new Set(p.animations)].slice(0, 6) : undefined,
    slow: Object.keys(slow).length ? { ...slow } : undefined,
  };
  for (const k of Object.keys(slow)) delete slow[k];
  last = { cpuTime, now, mutations: p.mutations, layouts: metric("LayoutCount") };
  samples.push(s);
  console.log(
    `[${clock()}] ${phase.padEnd(5)} ${String(s.auto ?? "-").padEnd(9)} rss=${s.rss}MB gpu=${s.gpu}MB js=${s.js}/${s.jsTotal}MB oilpan=${s.oilpan}MB buffers=${s.buffers}MB ` +
      `nodes=${s.nodes}(${s.inDom} in DOM) layout=${s.layout} listeners=${s.listeners} cpu=${s.cpu} lay/s=${s.lps} canvases=${s.canvases}(${s.canvasesInDom} in DOM, ${s.canvasMB}MB) ` +
      `images=${s.images}(${s.imageMB}MB) made=${s.madeCanvases}/${s.madeImages} mut/s=${s.mut} anim=${s.animations}${s.running ? `(${s.running.join(" ")})` : ""}${s.slow ? ` slow=${Object.keys(s.slow).join(",")}` : ""}`,
  );
  return s;
}
// A full collection, twice (what one frees can free more); a page too busy to
// answer in a minute is left as it is.
const gc = async () => {
  await within("gc", cdp.send("HeapProfiler.collectGarbage"), null, 60000);
  await sleep(1500);
  await within("gc", cdp.send("HeapProfiler.collectGarbage"), null, 60000);
  await sleep(500);
};

let ticker = null;
const every = (phase) => {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => void sample(phase()).catch((e) => console.log(`sample: ${e.message}`)), INTERVAL_S * 1000);
};
let phase = "load";
every(() => phase);

const panel = page.locator(".auto-panel");
const state = async () => ((await panel.locator(".auto-state").textContent({ timeout: 1000 }).catch(() => "")) ?? "").trim();
let outcome = "done";
try {
  await page.goto(base, { waitUntil: "load" });
  await page.locator("nav button").first().waitFor({ timeout: 60000 });
  await sleep(1500);
  if (demo) {
    await page.getByRole("button", { name: /^Use demo$/ }).click();
    await page.waitForFunction(() => /synthetic/i.test(document.querySelector(".data-card")?.textContent ?? "") && !document.querySelector(".data-card .spin"), null, { timeout: 600000 });
  }
  // The Pilot's panel, and the auto run on the scripted model's scenario.
  if (!(await page.locator(".ai-side .ai-panel").isVisible().catch(() => false))) {
    await page.locator(".ai-sheetbar button, .ai-rail button").first().click();
    await sleep(600);
  }
  await fetch(`${MODEL}/scenario?name=${SCENARIO}`);
  const go = page.locator(".ai-chip-act", { hasText: "Run auto analysis" });
  await go.waitFor({ state: "visible", timeout: 120000 });
  await page.waitForFunction(() => { const t = document.querySelector(".ai-composer textarea"); return t && !t.disabled && !document.querySelector(".ai-avatar-spin"); }, null, { timeout: 600000 });
  phase = "run";
  await go.click();
  const started = Date.now();
  for (;;) {
    if (crashed) throw new Error("the page crashed during the run");
    const s = await state();
    if (/^(Done|Stopped)$/.test(s)) break;
    if (s === "Needs you") await panel.locator(".pc button", { hasText: /^Skip$/ }).first().click().catch(() => {});
    if (Date.now() - started > RUN_LIMIT_S * 1000) throw new Error(`the run did not end in ${RUN_LIMIT_S} s (state: ${s || "none"})`);
    await sleep(1000);
  }
  console.log(`[${clock()}] the run ended: ${await state()}, after ${Math.round((Date.now() - started) / 1000)} s`);
} catch (e) {
  outcome = e.message;
  console.log(`RUN FAILED: ${e.message}`);
}

// ------------------------------------------------------------ idle, after the run
const problems = [];
let start = null;
let end = null;
if (outcome === "done" && !crashed) {
  phase = "idle";
  await sleep(10000); // the report and the views settle
  await gc();
  start = await sample("gc0");
  every(() => phase);
  if (profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  await sleep(IDLE_S * 1000);
  if (profile && !crashed) {
    const { profile: prof } = await cdp.send("Profiler.stop");
    writeFileSync(join(out, "idle.cpuprofile"), JSON.stringify(prof));
  }
  clearInterval(ticker);
  if (!crashed) {
    await gc();
    end = await sample("gc1");
  }
  if (snapshot && !crashed) {
    // The heap at the end, its DOM (detached nodes a script still holds show as "Detached …").
    const { createWriteStream } = await import("node:fs");
    const file = createWriteStream(join(out, "idle.heapsnapshot"));
    cdp.on("HeapProfiler.addHeapSnapshotChunk", (e) => file.write(e.chunk));
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
    await new Promise((r) => file.end(r));
  }
  const idle = samples.filter((s) => s.phase === "idle");
  if (crashed || !end) problems.push("the page crashed while idle");
  else if (start.rss == null || end.rss == null || start.nodes == null || end.nodes == null) problems.push("the page did not answer the measurement at an end of the idle window");
  else {
    const grew = Math.round((end.rss - start.rss) * 10) / 10;
    if (grew > GROW_MB) problems.push(`renderer memory grew ${grew} MB while idle (${start.rss} → ${end.rss} MB; limit ${GROW_MB})`);
    if (end.rss > MAX_MB) problems.push(`renderer memory ${end.rss} MB is over ${MAX_MB} MB`);
    if (end.nodes - start.nodes > GROW_NODES) problems.push(`DOM nodes grew ${end.nodes - start.nodes} while idle (${start.nodes} → ${end.nodes}; limit ${GROW_NODES})`);
    const peakNodes = Math.max(end.nodes, ...idle.map((s) => s.nodes));
    if (peakNodes > MAX_NODES) problems.push(`DOM nodes reached ${peakNodes} while idle (limit ${MAX_NODES})`);
    const cpus = idle.map((s) => s.cpu).filter((c) => c != null);
    const cpu = cpus.length ? cpus.reduce((a, c) => a + c, 0) / cpus.length : 0;
    if (cpu > MAX_CPU) problems.push(`the renderer averaged ${cpu.toFixed(2)} of a core while idle (limit ${MAX_CPU})`);
    const muts = idle.map((s) => s.mut).filter((m) => m != null);
    const mut = muts.length ? muts.reduce((a, m) => a + m, 0) / muts.length : 0;
    if (mut > MAX_MUT) problems.push(`the DOM changed ${Math.round(mut)} nodes a second while idle (limit ${MAX_MUT})`);
    // Layouts a second over the whole idle window (its ends' counts, so a gap in the samples does not hide them).
    const idleS = (end.t - start.t) || 1;
    const lps = start.layouts != null && end.layouts != null ? (end.layouts - start.layouts) / idleS : null;
    if (lps == null) problems.push("the page did not report its layout count while idle");
    else if (lps > MAX_LAYOUTS) problems.push(`the page laid out ${lps.toFixed(1)} times a second while idle (limit ${MAX_LAYOUTS}): a layout loop`);
  }
  // The punch record: each version downloaded once, no read lost.
  const twice = Object.entries(punchReads.bodies).filter(([, n]) => n > 1);
  if (twice.length) problems.push(`the Bragg punch record was downloaded again for a version already read (${twice.map(([t, n]) => `${t} ×${n}`).join(", ")})`);
  if (punchReads.failed) problems.push(`${punchReads.failed} read(s) of the Bragg punch record failed with no answer`);
  // And the run itself kept within the bound.
  const peak = Math.max(0, ...samples.map((s) => s.rss ?? 0));
  if (peak > MAX_MB) problems.push(`renderer memory peaked at ${peak} MB during the session (limit ${MAX_MB})`);
} else {
  clearInterval(ticker);
}

const summary = {
  base,
  scenario: SCENARIO,
  follow: FOLLOW,
  browser: shell ? "headless shell" : "chromium",
  outcome,
  crashed,
  idleSeconds: IDLE_S,
  start,
  end,
  braggProfile: { versions: Object.keys(punchReads.bodies).length, bodies: Object.values(punchReads.bodies).reduce((a, n) => a + n, 0), notModified: punchReads.notModified, failed: punchReads.failed },
  peak: samples.length ? { rss: Math.max(...samples.map((s) => s.rss ?? 0)), nodes: Math.max(...samples.map((s) => s.nodes ?? 0)), oilpan: Math.max(...samples.map((s) => s.oilpan ?? 0)), buffers: Math.max(...samples.map((s) => s.buffers ?? 0)) } : null,
  problems,
  samples,
};
writeFileSync(join(out, "memory.json"), JSON.stringify(summary, null, 1));
await browser.close().catch(() => {});
if (outcome !== "done" || crashed) {
  console.log(`the run did not finish: ${crashed ? "the page crashed" : outcome}`);
  process.exit(2);
}
console.log(`Bragg punch record: ${summary.braggProfile.bodies} downloads of ${summary.braggProfile.versions} version(s), ${summary.braggProfile.notModified} answered 304, ${summary.braggProfile.failed} failed`);
console.log(problems.length ? `FAIL\n  ${problems.join("\n  ")}` : `ok: idle ${IDLE_S} s, renderer ${start.rss} → ${end.rss} MB, DOM nodes ${start.nodes} → ${end.nodes}`);
process.exit(problems.length ? 1 : 0);
