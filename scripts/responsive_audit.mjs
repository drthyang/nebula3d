// Responsive audit of the web console: every page on phones, iPads (both
// orientations) and desktops, with NEBULA Pilot's drawer open and closed.
// Touch screens are emulated (isMobile, hasTouch, deviceScaleFactor 2-3).
//
//   PW=<path to playwright-core> node scripts/responsive_audit.mjs <base-url> <out-dir> \
//     [--viewports=phone,ipad,desktop | --viewports=390x844,1024x768] [--pages=config,dpdf] \
//     [--drawer=closed,open] [--no-shots] [--demo]
//
// It needs a running console with a dataset whose stages exist: the native
// server, or the Pyodide build with --demo (it loads the demo volume and runs
// the pipeline in each browser context first). For each page × viewport ×
// drawer state it records:
//   - doc:     document.scrollingElement's height and width against the viewport
//              (the app shell must stay one screen; `.main` is the scroll pane)
//   - main:    `.main`'s horizontal overflow (scrollWidth > clientWidth)
//   - widest:  elements reaching past the viewport's right edge, or past the
//              card they sit in, that no scrolling ancestor clips
//   - clipped: text cut by its box (overflow hidden or spilling), excluding
//              intended ellipses (text-overflow: ellipsis) and scroll panes
//   - offscreen: controls placed outside the viewport horizontally, or, inside
//              a fixed layer (the drawer, a popover), vertically
//   - titles:  (touch only) elements whose information is only in a `title`
//              tooltip: no visible text or aria-label says it; "(held: shown)"
//              when the console's press-and-hold path to titles is active
//   - taps:    (touch only) controls whose hit area, padding and positioned
//              ::before/::after included, is under 44 × 44 CSS px
// and writes <out-dir>/audit.json, <out-dir>/audit.md and one screenshot per state.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? "playwright-core");

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const positional = args.filter((a) => !a.startsWith("--"));
const base = positional[0] ?? "http://127.0.0.1:8026/";
const out = positional[1] ?? "audit-out";
const shots = !args.includes("--no-shots");
// the Pyodide build (npm run dev:pyodide / build:pages): load the demo volume
// and run the pipeline in each browser context before measuring
const demo = args.includes("--demo");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const VIEWPORTS = [
  { group: "phone", name: "phone 390×844", w: 390, h: 844, touch: true, dsf: 3 },
  { group: "phone", name: "phone 430×932", w: 430, h: 932, touch: true, dsf: 3 },
  { group: "phone", name: "phone 844×390", w: 844, h: 390, touch: true, dsf: 3 },
  { group: "ipad", name: "iPad 768×1024", w: 768, h: 1024, touch: true, dsf: 2 },
  { group: "ipad", name: "iPad 1024×768", w: 1024, h: 768, touch: true, dsf: 2 },
  { group: "ipad", name: "iPad 820×1180", w: 820, h: 1180, touch: true, dsf: 2 },
  { group: "ipad", name: "iPad 1180×820", w: 1180, h: 820, touch: true, dsf: 2 },
  { group: "ipad", name: "iPad 1024×1366", w: 1024, h: 1366, touch: true, dsf: 2 },
  { group: "ipad", name: "iPad 1366×1024", w: 1366, h: 1024, touch: true, dsf: 2 },
  { group: "desktop", name: "desktop 1280×800", w: 1280, h: 800, touch: false, dsf: 1 },
  { group: "desktop", name: "desktop 1512×982", w: 1512, h: 982, touch: false, dsf: 1 },
  { group: "desktop", name: "desktop 1920×1080", w: 1920, h: 1080, touch: false, dsf: 1 },
  { group: "desktop", name: "desktop 2560×1440", w: 2560, h: 1440, touch: false, dsf: 1 },
];

// nav index = position in App.tsx's NAV (the labels shorten in the top bar)
export const PAGES = [
  { key: "config", nav: 0, views: 1 },
  { key: "execution", nav: 1, views: 0 },
  { key: "recip-grid", nav: 2, views: 6, layout: "All views the same size" },
  { key: "recip-focus", nav: 2, views: 6, layout: "One large view with the others beside it" },
  { key: "bragg", nav: 3, views: 0 },
  { key: "dpdf", nav: 4, views: 3 },
  { key: "qr", nav: 5, views: 3 },
];

const pick = (list, spec, keyOf) => {
  if (!spec) return list;
  const want = spec.split(",");
  return list.filter((x) => want.some((s) => keyOf(x).includes(s)));
};
const viewports = pick(VIEWPORTS, flag("viewports"), (v) => `${v.group} ${v.w}x${v.h}`);
const pages = pick(PAGES, flag("pages"), (p) => p.key);
const drawers = (flag("drawer") ?? "closed,open").split(",");

/** Runs in the page: every measurement for the current state. */
function measure(touch) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const se = document.scrollingElement;
  const main = document.querySelector(".main");
  const r1 = (n) => Math.round(n * 10) / 10;

  const describe = (el) => {
    const cls = [...el.classList].filter((c) => !/^(active|on|open|gh-new|ai-glow)$/.test(c)).slice(0, 3);
    let s = el.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "");
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim();
    if (el.type && el.tagName === "INPUT") s += `[type=${el.type}]`;
    const p = el.parentElement?.closest("[class]");
    const pc = p ? "." + [...p.classList].slice(0, 1).join(".") : "";
    return { sel: `${pc} > ${s}`.trim(), label: label.replace(/\s+/g, " ").slice(0, 40) };
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest("[aria-hidden=true], [inert]");
  };
  // a scrolling or clipping ancestor
  const clipper = (el, axis) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p)[axis === "x" ? "overflowX" : "overflowY"];
      if (o !== "visible") return p;
    }
    return null;
  };
  const CARD = ".card, .ws-head, .view, .vf, .cfg-box, .exec-panel, .exec-head, .bragg-card, .data-card, .cfg-preview, .cfg-workflow, .qr-cluster, .qr-header, .gh-card, .ai-side, .main-foot";
  const all = [...document.querySelectorAll("body *")].filter((el) => !(el instanceof SVGElement && el.tagName !== "svg"));

  // wider than the viewport, or than its card, with nothing clipping it in between
  const widest = [];
  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const clip = clipper(el, "x");
    const clipR = clip?.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      if (clip && clipR.right <= vw + 1 && clipR.left >= -1) continue; // scrolled or clipped inside the viewport
      widest.push({ ...describe(el), right: r1(r.right), left: r1(r.left), kind: "viewport" });
      continue;
    }
    const card = el.parentElement?.closest(CARD);
    // a resize handle straddles its panel's edge on purpose
    if (card && !el.matches(".ai-resize-x")) {
      const c = card.getBoundingClientRect();
      if ((r.right > c.right + 1 || r.left < c.left - 1) && !(clip && card.contains(clip))) {
        widest.push({ ...describe(el), right: r1(r.right), card: describe(card).sel, cardRight: r1(c.right), kind: "card" });
      }
    }
  }

  // text cut by its box: each direct text node's extent against the element
  // (when it hides overflow) or the nearest ancestor that clips it
  const hidden = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width <= 2 || r.height <= 2 || cs.clipPath === "inset(50%)" || /rect\(0/.test(cs.clip) || el.closest(".visually-hidden, .sr-only") !== null;
  };
  const clipped = [];
  const range = document.createRange();
  for (const el of all) {
    if (!visible(el) || hidden(el)) continue;
    if (/^(INPUT|SELECT|TEXTAREA|OPTION|CANVAS|IMG|svg)$/.test(el.tagName)) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === "ellipsis") continue;
    let box = null;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX !== "visible" || ps.overflowY !== "visible") {
        // a pane that scrolls its content into reach clips nothing for good
        if (/auto|scroll/.test(ps.overflowX + ps.overflowY) && p !== el) break;
        if (getComputedStyle(p).textOverflow === "ellipsis") break;
        box = p.getBoundingClientRect();
        break;
      }
    }
    if (!box) continue;
    let worst = 0;
    for (const t of texts) {
      range.selectNodeContents(t);
      for (const tr of range.getClientRects()) {
        if (tr.width < 1) continue;
        worst = Math.max(worst, tr.right - box.right, box.left - tr.left, tr.bottom - box.bottom, box.top - tr.top);
      }
    }
    if (worst > 1.5) clipped.push({ ...describe(el), by: r1(worst) });
  }

  const CONTROL = "button, select, input:not([type=hidden]), textarea, a[href], summary, [role=button], [role=tab], [role=switch], [role=separator][tabindex], [role=slider]";
  const controls = [...document.querySelectorAll(CONTROL)];
  const hitBox = (el) => {
    // a hidden checkbox inside a switch: its label is the target
    let t = el;
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || getComputedStyle(el).opacity === "0") t = el.closest("label") ?? el;
    }
    const r = t.getBoundingClientRect();
    let w = r.width;
    let h = r.height;
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(t, pseudo);
      if (ps.content === "none" || ps.position !== "absolute" || ps.pointerEvents === "none") continue;
      w = Math.max(w, parseFloat(ps.width) || 0);
      h = Math.max(h, parseFloat(ps.height) || 0);
    }
    return { t, w, h, r };
  };

  const offscreen = [];
  const taps = [];
  const titles = [];
  const marks = { n: 0, min: Infinity };
  for (const el of controls) {
    if (el.matches(".visually-hidden, .sr-only") || (el.type === "file" && hidden(el))) continue;
    if (!visible(el) && !(el.tagName === "INPUT" && el.closest("label.switch, label") && visible(el.closest("label")))) continue;
    const { t, w, h, r } = hitBox(el);
    // horizontally outside the viewport with nothing scrolling it into reach
    const clip = clipper(t, "x");
    const scrollsX = clip && getComputedStyle(clip).overflowX !== "hidden";
    if ((r.right > vw + 1 || r.left < -1) && !scrollsX) offscreen.push({ ...describe(t), left: r1(r.left), right: r1(r.right) });
    // inside a fixed layer: vertically too
    const fixed = (() => {
      for (let p = t; p; p = p.parentElement) if (getComputedStyle(p).position === "fixed") return true;
      return false;
    })();
    if (fixed && (r.bottom > vh + 1 || r.top < -1)) offscreen.push({ ...describe(t), top: r1(r.top), bottom: r1(r.bottom), fixed: true });
    // the Bragg scatter's points: data marks, tapped through the peak table
    if (el.matches(".bragg-dot")) {
      marks.n++;
      marks.min = Math.min(marks.min, w);
      continue;
    }
    if (touch && (w < 44 - 0.5 || h < 44 - 0.5) && !el.disabled) {
      taps.push({ ...describe(t), w: r1(w), h: r1(h) });
    }
  }
  if (touch) {
    for (const el of document.querySelectorAll("[title]")) {
      if (!visible(el) || el.tagName === "OPTION" || el.closest("svg") !== null && el.tagName !== "svg") continue;
      const title = el.getAttribute("title").trim();
      if (!title) continue;
      const said = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""} ${el.getAttribute("aria-describedby") ? "described" : ""}`.replace(/\s+/g, " ").trim().toLowerCase();
      const words = title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3);
      const missing = words.filter((w) => !said.includes(w));
      // the title says notably more than the visible text or aria-label
      if (missing.length >= 3 || (!said && words.length)) titles.push({ ...describe(el), title: title.slice(0, 70) });
    }
  }

  return {
    vw,
    vh,
    docH: se.scrollHeight,
    docW: se.scrollWidth,
    docScrollable: se.scrollHeight > vh + 1,
    mainOverflowX: main ? main.scrollWidth - main.clientWidth : null,
    mainScrollH: main?.scrollHeight ?? null,
    mainClientH: main?.clientHeight ?? null,
    mainBottom: main ? r1(main.getBoundingClientRect().bottom) : null,
    widest,
    clipped,
    offscreen,
    taps,
    titles,
    marks: marks.n ? marks : null,
    // TouchTitles.tsx: a press held on a control (or a field's focus) shows its title
    titlePath: document.documentElement.hasAttribute("data-touch-titles"),
  };
}

async function settle(p, n) {
  for (let i = 0; i < 40; i++) {
    const c = await p.locator(".main .vf").count();
    if (c >= n) break;
    await sleep(250);
  }
  await sleep(900);
}

const uniq = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    const prev = m.get(k);
    if (!prev) m.set(k, { ...r, n: 1 });
    else {
      prev.n++;
      if (r.w != null) prev.w = Math.min(prev.w, r.w);
      if (r.h != null) prev.h = Math.min(prev.h, r.h);
    }
  }
  return [...m.values()];
};

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const errors = [];
  for (const vp of viewports) {
    for (const drawer of drawers) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: vp.dsf,
        isMobile: vp.touch,
        hasTouch: vp.touch,
      });
      await ctx.addInitScript((open) => {
        try {
          localStorage.setItem("nebula3d.assistantOpen", open ? "1" : "0");
          localStorage.setItem("nebula3d.gestureHintSeen", "1");
        } catch {
          /* no storage */
        }
      }, drawer === "open");
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(`${vp.name}: ${e.message}`));
      await p.goto(base);
      await sleep(2000);
      if (demo) {
        await p.getByRole("button", { name: "Use demo" }).click({ timeout: 180_000 });
        await p.getByRole("button", { name: "Run pipeline" }).click({ timeout: 180_000 });
        await sleep(1500);
        await p.waitForFunction(() => !document.querySelector(".nav-dot"), null, { timeout: 600_000 });
      }
      for (const pg of pages) {
        try {
          await p.locator(".nav button").nth(pg.nav).click();
          await sleep(300);
          if (pg.layout) {
            const b = p.locator(`.layout-control button[aria-label="${pg.layout}"]`).first();
            if (await b.isVisible().catch(() => false)) await b.click({ timeout: 3000 });
            else if (pg.key === "recip-focus") continue; // no layout switch at this width
          }
          await settle(p, pg.views);
          const m = await p.evaluate(measure, vp.touch);
          const shot = `${vp.w}x${vp.h}-${drawer}-${pg.key}.png`;
          if (shots) await p.screenshot({ path: join(out, shot) });
          results.push({ viewport: vp.name, group: vp.group, drawer, page: pg.key, shot, ...m });
          process.stdout.write(
            `${vp.name.padEnd(18)} ${drawer.padEnd(6)} ${pg.key.padEnd(11)} doc ${m.docH}/${m.vh}${m.docScrollable ? " SCROLLS" : ""}` +
              ` w ${m.docW}/${m.vw} mainX ${m.mainOverflowX} wide ${m.widest.length} clip ${m.clipped.length} off ${m.offscreen.length} taps ${m.taps.length} titles ${m.titles.length}\n`,
          );
        } catch (e) {
          errors.push(`${vp.name} ${drawer} ${pg.key}: ${e.message.split("\n")[0]}`);
        }
      }
      await ctx.close();
    }
  }
  await browser.close();
  writeFileSync(join(out, "audit.json"), JSON.stringify({ base, results, errors }, null, 1));

  // the summary table: one row per viewport × drawer
  const lines = ["| Viewport | Drawer | Doc scrolls | Doc wider | .main x-overflow | Wider than viewport/card | Clipped text | Off-screen | Taps < 44 | Title-only |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const vp of viewports) {
    for (const drawer of drawers) {
      const rows = results.filter((r) => r.viewport === vp.name && r.drawer === drawer);
      if (!rows.length) continue;
      const scrolls = rows.filter((r) => r.docScrollable).map((r) => r.page);
      const wider = rows.filter((r) => r.docW > r.vw + 1).map((r) => r.page);
      const mainX = rows.filter((r) => r.mainOverflowX > 1).map((r) => r.page);
      const n = (k, key) => uniq(rows.flatMap((r) => r[k]), key).length;
      lines.push(
        `| ${vp.name} | ${drawer} | ${scrolls.join(", ") || "–"} | ${wider.join(", ") || "–"} | ${mainX.join(", ") || "–"} | ${n("widest", (x) => x.sel)} | ${n("clipped", (x) => x.sel)} | ${n("offscreen", (x) => x.sel)} | ${vp.touch ? n("taps", (x) => x.sel) : "n/a"} | ${vp.touch ? n("titles", (x) => x.sel) + (rows.every((r) => r.titlePath) ? " (held: shown)" : "") : "n/a"} |`,
      );
    }
  }
  // the detail lists, deduplicated across states
  const section = (title, k, key, fmt) => {
    const rows = uniq(results.flatMap((r) => r[k].map((x) => ({ ...x, at: `${r.viewport}/${r.page}` }))), key);
    if (!rows.length) return;
    lines.push("", `### ${title} (${rows.length})`, "");
    for (const x of rows.sort((a, b) => (a.w ?? 0) * (a.h ?? 0) - (b.w ?? 0) * (b.h ?? 0))) lines.push(`- ${fmt(x)}`);
  };
  section("Tap targets under 44 × 44", "taps", (x) => x.sel, (x) => `\`${x.sel}\` "${x.label}" min ${x.w}×${x.h} (${x.n}×, e.g. ${x.at})`);
  section("Wider than the viewport or its card", "widest", (x) => x.sel, (x) => `\`${x.sel}\` ${x.kind} right ${x.right}${x.card ? ` > ${x.card} ${x.cardRight}` : ""} (${x.n}×, e.g. ${x.at})`);
  section("Clipped text", "clipped", (x) => x.sel, (x) => `\`${x.sel}\` "${x.label}" cut by ${x.by} px (${x.n}×, e.g. ${x.at})`);
  section("Controls off-screen", "offscreen", (x) => x.sel, (x) => `\`${x.sel}\` "${x.label}" ${JSON.stringify({ l: x.left, r: x.right, t: x.top, b: x.bottom })} (${x.n}×, e.g. ${x.at})`);
  section("Information only in a title tooltip", "titles", (x) => x.sel + x.title, (x) => `\`${x.sel}\` "${x.title}" (${x.n}×, e.g. ${x.at})`);
  if (errors.length) lines.push("", "### Errors", "", ...errors.map((e) => `- ${e}`));
  writeFileSync(join(out, "audit.md"), lines.join("\n") + "\n");
  console.log(`\nwrote ${join(out, "audit.md")} (${results.length} states, ${errors.length} errors)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
