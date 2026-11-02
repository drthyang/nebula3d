// Mockup scenes for docs/pilot-auto-mode-design.md (Linear THY-65, THY-66).
//
// The page is a static snapshot of the console on the built-in synthetic demo
// (the hosted Pyodide build, 2026-11-02): its canvases saved as img/slice-*.png
// and its scripts removed. This script draws the proposed UI over it: the
// Apply cards, the Auto panel, the Now examining bar and the overlays. Pick a
// scene with the URL hash: #cards, #auto, #paused, #bragg, #rings. Every value
// shown is made up for the mockup; nothing is wired to the app.

(function () {
  "use strict";

  const phone = document.documentElement.dataset.device === "phone";
  const scene = (location.hash || "#cards").slice(1);
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const node = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  // ------------------------------------------------------------ icons

  const BRAND = (size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="2.4" fill="currentColor"></circle><g fill="currentColor" opacity="0.55"><circle cx="9" cy="2.8" r="1.2"></circle><circle cx="9" cy="15.2" r="1.2"></circle><circle cx="2.8" cy="9" r="1.2"></circle><circle cx="15.2" cy="9" r="1.2"></circle><circle cx="4.6" cy="4.6" r="0.9"></circle><circle cx="13.4" cy="4.6" r="0.9"></circle><circle cx="4.6" cy="13.4" r="0.9"></circle><circle cx="13.4" cy="13.4" r="0.9"></circle></g></svg>`;
  const GEAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
  const TOOLS = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.2 2.3a3.3 3.3 0 0 0-4.1 4.3L2.4 10.3a1.4 1.4 0 0 0 2 2l3.7-3.7a3.3 3.3 0 0 0 4.3-4.1l-2 2-1.7-.4-.4-1.7 1.9-2.1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path></svg>`;
  const FOLLOW = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.3"></circle><circle cx="8" cy="8" r="1.8" fill="currentColor"></circle><path d="M8 0.8v2.4M8 12.8v2.4M0.8 8h2.4M12.8 8h2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path></svg>`;
  const HIGHLIGHT = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.6 1.8"></rect><circle cx="8" cy="8" r="2.3" fill="currentColor"></circle></svg>`;
  const VISION = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" stroke-width="1.3"></path><circle cx="8" cy="8" r="2.1" fill="currentColor"></circle></svg>`;
  const PLAY = `<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style="margin-right:5px;vertical-align:-1px"><path d="M3 1.8 10.2 6 3 10.2Z" fill="currentColor"></path></svg>`;
  const SEND = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M8 3l-4 4M8 3l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  const Q = `<button type="button" class="gh-trigger pc-q" aria-label="Details">?</button>`;

  // ------------------------------------------------------------ the Pilot panel

  function panel({ above = "", transcript, auto = false, placeholder = "Ask about this reduction…", usage = "≈ 14.2k tokens" }) {
    const chips = auto
      ? `<button type="button" class="ai-chip ai-chip-stop">■ Stop auto analysis</button>`
      : [
          `<button type="button" class="ai-chip ai-chip-act">${PLAY}Run auto analysis</button>`,
          `<button type="button" class="ai-chip ai-chip-act">Assess the run</button>`,
          `<button type="button" class="ai-chip ai-chip-act">Tune for the best result</button>`,
          ...["Assess ring removal", "Review Bragg punch", "Check backfill", "Check background correction", "Analyse ΔPDF features"].map(
            (l) => `<button type="button" class="ai-chip">${l}</button>`,
          ),
        ].join("");
    return `
      <div class="ai-panel-head"><span class="ai-panel-title">${BRAND(16)}NEBULA Pilot<span class="nav-beta">Beta</span></span>
        <button type="button" class="ai-panel-close" aria-label="Collapse NEBULA Pilot"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="${phone ? "M3 5l4 4 4-4" : "M5 3l4 4-4 4"}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button></div>
      <div class="ai-topbar"><div class="ai-conn-bar"><span class="ai-conn-status ok"><span class="api-dot"></span>Connected</span><span class="ai-provider-badge">Ollama</span>
        <select class="ai-model-select" aria-label="Model"><option>gemma4:26b</option></select><button type="button" class="ai-gear" aria-label="Connection settings">${GEAR}</button></div></div>
      ${above}
      <div class="ai-chat"><div class="ai-transcript">${transcript}</div>
        <div class="ai-dock"><div class="ai-reviews">${chips}</div>
          <div class="ai-toggles">
            <button type="button" class="ai-vision-chip on">${TOOLS}Tools</button>
            <button type="button" class="ai-vision-chip on">${FOLLOW}Follow</button>
            <button type="button" class="ai-vision-chip on" title="Highlights on: the views show what each check measured">${HIGHLIGHT}Highlights</button>
            ${phone ? "" : `<button type="button" class="ai-vision-chip">${VISION}Vision</button>`}
            <span class="ai-usage-total">${usage}</span>
          </div>
          <div class="ai-composer${auto ? " is-disabled" : ""}"><textarea rows="1" placeholder="${placeholder}"${auto ? " disabled" : ""}></textarea><button type="button" class="ai-send" disabled>${SEND}</button></div>
        </div></div>`;
  }

  const user = (text) => `<div class="ai-msg ai-msg-user"><div class="ai-user-bubble">${text}</div></div>`;
  const assistant = (inner, live = false) =>
    `<div class="ai-msg ai-msg-assistant"><span class="ai-avatar${live ? " ai-avatar-spin" : ""}" aria-hidden="true">${BRAND(22)}</span><div class="ai-msg-main">${inner}</div></div>`;
  const steps = (rows, summary, open = true) =>
    `<details class="ai-steps"${open ? " open" : ""}><summary>${summary}</summary><ol class="ai-step-list">${rows.join("")}</ol></details>`;
  const step = ({ name, sum = "", status = "done", show = false, auto = false, shown = false, watch = false }) =>
    `<li class="ai-step ai-step-${status}${shown ? " is-shown" : ""}"><details><summary><span class="ai-step-dot"></span>${auto ? '<span class="auto-tag">auto</span>' : ""}<span class="ai-step-name">${name}</span><span class="ai-step-summary">${sum}</span></summary></details>${shown ? '<span class="hl-swatch" title="Drawn on the views"></span>' : ""}${show ? '<button type="button" class="ai-step-open">Show</button>' : ""}${watch ? '<button type="button" class="ai-step-open">Watch</button>' : ""}</li>`;
  const answer = (paras) => `<div class="ai-answer"><div class="md">${paras.map((p) => `<p class="md-p">${p}</p>`).join("")}</div></div>`;
  const thinking = (text) => `<details class="ai-think" open><summary>Thinking…</summary><div class="ai-think-body">${text}</div></details>`;

  // ------------------------------------------------------------ cards

  const change = (what, from, to) => `${what} <span class="from">${from}</span><span class="arrow">→</span>${to}`;

  const factCard = ({ line, ev, src, details = "", skip = false }) => `
    <div class="pc pc--fact">
      <div class="pc-row"><span class="pc-kind pc-kind--fact">Sample fact</span><span class="pc-line">${line}</span>${Q}</div>
      <div class="pc-ev">${ev} · <span class="pc-src">${src}</span></div>
      ${details ? `<div class="pc-details">${details}</div>` : ""}
      <div class="pc-note">Apply counts as you stating this value.</div>
      <div class="pc-actions"><button type="button" class="btn btn-primary">Apply</button><button type="button" class="btn btn-ghost">Edit</button><button type="button" class="btn btn-ghost btn-quiet">${skip ? "Skip" : "Dismiss"}</button></div>
    </div>`;

  const SUPERCELL = {
    line: change("Supercell along L:", "1", "2"),
    ev: "9 of the 12 sharp peaks left sit at L = n + ½",
    src: "Bragg punch check, step 2",
  };
  const MODULATION = {
    line: change("Modulation:", "none", "k = (0, ⅓, 0)"),
    ev: "7 of the 31 sharp peaks punched off the lattice sit at K = n ± ⅓; chance puts 0.4",
    src: "punch record, step 3",
    details:
      "From the run's punch record: 7 of the 31 sharp peaks the search punched off the lattice lie within 0.08 r.l.u. of K ≡ ±1/3 (mod 1), where chance puts 0.4 (binomial tail 3.1 × 10⁻⁶). Apply declares k = (0, 1/3, 0), order 1, form points, so the search leaves G ± k alone. Edit sets the order, form or width.",
  };

  const proposals = () => `
    <div class="pc-group">
      <div class="pc-group-head">Proposed changes · 4</div>
      ${factCard(SUPERCELL)}
      ${factCard({ ...MODULATION, details: "" })}
      <div class="pc-done"><span class="ok">✓</span><span><b>Punch min σ 8 → 6</b> · applied by you</span><button type="button" class="pc-link">Undo</button></div>
      <div class="pc">
        <div class="pc-row"><span class="pc-kind pc-kind--run">Run</span><span class="pc-line">Run from Bragg punch</span><span class="pc-note">4 stages</span></div>
        <div class="pc-ev">The outputs predate Punch min σ 8 → 6.</div>
        <div class="pc-actions"><button type="button" class="btn btn-primary">Run</button><button type="button" class="btn btn-ghost btn-quiet">Dismiss</button></div>
      </div>
    </div>`;

  const changesList = (rows) => `
    <section class="ai-marks" aria-label="Changes">
      <div class="ai-marks-head"><button type="button" class="ai-marks-toggle">Changes<span class="ai-marks-count">${rows.length}</span></button><button type="button" class="ai-marks-act">Undo all</button></div>
      <ul class="ai-mark-list">${rows
        .map(
          (r) =>
            `<li class="ch-row"><span class="who${r.auto ? " auto" : ""}">${r.auto ? "auto" : "you"}</span><span class="what">${r.what}</span><span class="when">${r.when}</span><button type="button" class="ai-marks-act">Undo</button></li>`,
        )
        .join("")}</ul>
    </section>`;

  // ------------------------------------------------------------ the Auto panel

  const PLAN = [
    ["Preflight", "coverage, UB, Laue", "done"],
    ["Run pipeline", "", "41 s"],
    ["Ring removal", "", "passed"],
    ["Bragg punch", "", ""],
    ["Backfill", "", ""],
    ["Background correction", "", ""],
    ["3D-ΔPDF", "", ""],
    ["Report", "", ""],
  ];

  function autoPanel({ paused }) {
    const rows = PLAN.map(([name, sub, meta], i) => {
      const cls = i < 3 ? "done" : i === 3 ? (paused ? "wait" : "now") : "";
      const sub2 = i === 3 ? (paused ? "needs you" : "fix 1 of 2") : sub;
      const meta2 = i === 3 ? (paused ? "supercell" : "round 3 of 6") : meta;
      return `<li class="auto-step ${cls}"><span class="dot"></span><span>${name}${sub2 ? ` <span class="sub">· ${sub2}</span>` : ""}</span><span class="meta">${meta2}</span></li>`;
    }).join("");
    return `
      <section class="auto${paused ? " auto--paused" : ""}" aria-label="Auto analysis">
        <div class="auto-head"><span class="auto-title">Auto analysis</span><span class="auto-state">${paused ? "Paused" : "Running"}</span>
          <span class="auto-clock">${paused ? "7:40 of 30:00" : "6:12 of 30:00"}</span><button type="button" class="auto-stop">Stop</button></div>
        <div class="auto-bar"><i style="width:${paused ? 47 : 44}%"></i></div>
        <ol class="auto-plan">${rows}</ol>
        ${
          paused
            ? `<div class="auto-msg">Paused for a sample fact, clock stopped. It goes on when you apply or skip.</div>${factCard({ ...SUPERCELL, skip: true })}`
            : `<div class="auto-foot"><span>Model replies 2 of 12 · fixes 1 of 2 · 9.4k tokens</span>${Q}</div>`
        }
      </section>`;
  }

  const autoLine = ({ paused }) =>
    paused
      ? `<div class="auto-line"><span class="auto-state" style="color:var(--amber);background:var(--amber-soft)">Paused</span><span>Bragg punch · <b>needs you</b></span><span class="auto-clock">7:40</span><span class="chev">▾</span></div>`
      : `<div class="auto-line run"><span class="auto-state">Auto</span><span>Bragg punch · fix 1 of 2</span><span class="auto-clock">6:12</span><span class="chev">▾</span></div>`;

  // ------------------------------------------------------------ transcripts

  const T = {
    cards: () =>
      user("Review the Bragg punch.") +
      assistant(
        steps(
          [
            step({ name: "Read a skill", sum: "bragg-node-audit" }),
            step({ name: "Assessed a stage", sum: "Bragg punch: 3 missed at nodes, 9 off-lattice sharp", show: true, shown: true }),
            step({ name: "Ran the pipeline", sum: "punch record: 7 of 31 off-lattice at K = n ± ⅓", watch: true }),
            step({ name: "Changed settings", sum: "refused, a fact about the sample: punchSupercellL, modulation", status: "error" }),
          ],
          "Used 4 tools",
          !phone,
        ) +
          answer([
            "The punch leaves <strong>12</strong> sharp peaks: <strong>3</strong> at Bragg nodes, which it missed, and <strong>9</strong> off the lattice at L = n + ½. The punch's cell may be doubled along L, and the run's record points to a modulation at k = (0, ⅓, 0). Both are yours to say: apply or dismiss the cards below.",
            "A lower <code class=\"md-code\">punchMinSig</code> of 6 would catch the 3 missed at nodes.",
          ]) +
          proposals(),
      ),

    auto: () =>
      user(`${PLAY}Run auto analysis`) +
      assistant(
        steps(
          [
            step({ name: "Checked Qmax against coverage", sum: "inside the coverage", auto: true }),
            step({ name: "Checked the UB", sum: "0.02° turn, within its limit", auto: true }),
            step({ name: "Compared the Laue classes by R_int", sum: "suggests m-3m", auto: true }),
            step({ name: "Ran the pipeline", sum: "done in 41 s · 5 computed", auto: true, watch: true }),
            step({ name: "Assessed a stage", sum: "Ring removal: clean", auto: true, show: true }),
            step({ name: "Assessed a stage", sum: "Bragg punch: 3 missed at nodes", auto: true, show: true, shown: true }),
            step({ name: "Read a skill", sum: "bragg-node-audit" }),
            step({ name: "Tuning the pipeline", sum: "1/1 Bragg punch · trial 2/3 running", status: "running", watch: true }),
          ],
          "Tuning the pipeline…",
          true,
        ) +
          `<div class="tune-progress"><div class="tune-progress-head"><span>Tuning · synthetic_rocksalt</span></div>
            <div class="tune-stage tune-running"><div class="tune-stage-head"><span class="tune-stage-name">Bragg punch</span><span class="tune-status busy">running</span></div>
            <ol class="tune-trials">
              <li class="tune-trial tune-trial-done"><div class="tune-trial-row"><span class="tune-trial-n">#1</span><span class="tune-trial-what">your settings</span></div><div class="tune-trial-metrics">3 left at nodes · 9 off-lattice sharp<span class="tune-secs"> · 38s</span></div></li>
              <li class="tune-trial tune-trial-running"><div class="tune-trial-row"><span class="tune-trial-n">#2</span><span class="tune-trial-what"><code>punchMinSig=6</code></span></div><div class="tune-trial-metrics">running…</div></li>
              <li class="tune-trial tune-trial-pending"><div class="tune-trial-row"><span class="tune-trial-n">#3</span><span class="tune-trial-what"><code>punchFootprint=fitted</code></span></div><div class="tune-trial-metrics">queued</div></li>
            </ol></div></div>`,
        true,
      ),

    paused: () =>
      user(`${PLAY}Run auto analysis`) +
      assistant(
        steps(
          [
            step({ name: "Assessed a stage", sum: "Bragg punch: 9 off-lattice sharp at L = n + ½", auto: true, show: true, shown: true }),
            step({ name: "Read a skill", sum: "bragg-node-audit" }),
            step({ name: "Changed settings", sum: "refused, a fact about the sample: punchSupercellL", status: "error" }),
          ],
          "Used 3 tools",
          true,
        ) +
          answer([
            "The 9 sharp peaks off the lattice sit at L = n + ½. A punch indexed on a cell doubled along L would leave them alone; that is yours to say.",
          ]) +
          `<div class="ai-note">Paused: waiting for you on the supercell.</div>`,
        true,
      ),

    bragg: () =>
      user("Review Bragg punch") +
      assistant(
        steps(
          [
            step({ name: "Read a skill", sum: "bragg-node-audit" }),
            step({ name: "Assessed a stage", sum: "Bragg punch: 3 missed at nodes, 9 off-lattice sharp, 4 broad", show: true, shown: true }),
          ],
          "Used 2 tools",
          true,
        ) + thinking("3 lattice peaks were missed at their nodes. 9 sharp peaks sit at L = n + ½: a doubled cell along L, or satellites…"),
        true,
      ),

    rings: () =>
      user("Assess ring removal") +
      assistant(
        steps(
          [
            step({ name: "Assessed a stage", sum: "Ring removal: 1 ring left; 4 removed on Al lines", show: true, shown: true }),
            step({ name: "Took a radial profile", sum: "raw · ring-removed, 0kl", status: "running" }),
          ],
          "Took a radial profile…",
          true,
        ),
        true,
      ),
  };

  // ------------------------------------------------------------ overlays

  /** A view's map from (K, L) in r.l.u. to its overlay's units, read from its own tick marks. */
  function mapOf(view) {
    const svg = $("svg.vf-overlay", view);
    const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const xs = [];
    const ys = [];
    $$("g.vf-ticks > g", svg).forEach((g) => {
      const ln = $("line.vf-tick", g);
      const t = $("text", g);
      if (!ln || !t) return;
      const v = Number(t.textContent.replace("−", "-"));
      const [x1, y1, x2] = ["x1", "y1", "x2"].map((a) => Number(ln.getAttribute(a)));
      if (Math.abs(x1 - x2) < 1e-6) xs.push([v, x1]);
      else ys.push([v, y1]);
    });
    const fit = (pts) => {
      const a = pts[0];
      const b = pts[pts.length - 1];
      const s = (b[1] - a[1]) / (b[0] - a[0]);
      return { s, o: a[1] - s * a[0] };
    };
    const fx = fit(xs);
    const fy = fit(ys);
    return { w: vb[2], h: vb[3], X: (k) => fx.o + fx.s * k, Y: (l) => fy.o + fy.s * l, s: Math.abs(fx.s) };
  }

  const viewNamed = (title) => $$("section.view").find((v) => $(".view-title", v)?.textContent.startsWith(title));

  function overlay(view, inner) {
    const m = mapOf(view);
    const svg = node(`<svg class="hl-overlay" viewBox="0 0 ${m.w} ${m.h}" aria-hidden="true">${inner(m)}</svg>`);
    $(".vf", view).insertBefore(svg, $("svg.vf-overlay", view));
    return m;
  }

  const HALO = "rgba(8,10,14,0.72)";
  const C = { red: "#ef6a6a", amber: "#e8b454", green: "#34c98e", cyan: "#00e5ff", grey: "rgba(214,219,228,0.9)", white: "#ffffff", r2: "#ff4fd8" };
  const haloed = (shape, color, width, extra = "") =>
    shape(`fill="none" stroke="${HALO}" stroke-width="${width + 2.2}" ${extra}`) + shape(`fill="none" stroke="${color}" stroke-width="${width}" ${extra}`);
  const circle = (x, y, r) => (attrs) => `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`;
  const diamond = (x, y, d) => (attrs) => `<path d="M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z" ${attrs}/>`;
  const chip = (x, y, text, color) => {
    const w = 6.2 * text.length + 7;
    return `<g><rect x="${x - w / 2}" y="${y - 7}" width="${w}" height="13" rx="3" fill="rgba(11,13,16,0.82)" stroke="${color}" stroke-width="0.8"/><text x="${x}" y="${y + 0.5}" text-anchor="middle" dominant-baseline="central" fill="${color}" style="font:700 9px ui-monospace,Menlo,monospace">${text}</text></g>`;
  };

  // The punch's leftovers on the 0kl plane (made up for the mockup): at nodes,
  // sharp off the lattice at L = n + ½, and broad diffuse maxima (kept).
  const NODES = [];
  for (let k = -4; k <= 4; k += 2) for (let l = -4; l <= 4; l += 2) NODES.push([k, l]);
  const AT_NODE = [[2, 2], [-2, -2], [4, -2]];
  const OFF_SHARP = [[0, 1.5], [0, -1.5], [2, 0.5], [-2, -0.5], [2, -2.5], [-2, 2.5], [0, 3.5], [-4, 1.5], [4, -1.5]];
  const BROAD = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

  function braggOverlay(m, { focus = null, reading = false } = {}) {
    const px = m.w / 160;
    const dim = (what) => (focus && focus !== what ? ' opacity="0.3"' : "");
    let s = "";
    if (!reading) {
      // the punch holes, from the slice's own NaN voxels, and round 2's voxels beside them
      s += `<g${dim("holes")}><path d="${HOLES_PATH}" transform="scale(${px})" fill="none" stroke="${HALO}" stroke-width="2.4" vector-effect="non-scaling-stroke"/>`;
      s += `<path d="${HOLES_PATH}" transform="scale(${px})" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="0.9" vector-effect="non-scaling-stroke"/></g>`;
      s += `<g${dim("r2")}>${R2_VOXELS.map(([x, y]) => `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="rgba(255,79,216,0.55)" stroke="${C.r2}" stroke-width="0.6"/>`).join("")}</g>`;
    }
    s += `<g${dim("nodes")}>${NODES.map(([k, l]) => `<circle cx="${m.X(k)}" cy="${m.Y(l)}" r="1.7" fill="#fff" stroke="${HALO}" stroke-width="1"/>`).join("")}</g>`;
    const dash = reading ? 'stroke-dasharray="3 2"' : "";
    s += `<g${dim("node")}>${AT_NODE.map(([k, l]) => haloed(circle(m.X(k), m.Y(l), 0.42 * m.s), C.red, reading ? 1.2 : 2, dash)).join("")}</g>`;
    if (!reading) {
      s += `<g${dim("sharp")}>${OFF_SHARP.map(([k, l]) => haloed(diamond(m.X(k), m.Y(l), 0.2 * m.s), C.amber, 1.8)).join("")}</g>`;
      s += `<g${dim("broad")}>${BROAD.map(([k, l]) => haloed(circle(m.X(k), m.Y(l), 0.5 * m.s), C.cyan, 1.3, 'stroke-dasharray="4 3"')).join("")}</g>`;
      if (!focus) s += chip(m.X(1), m.Y(2), "6.8σ", C.red);
    }
    return s;
  }

  // The ring shells on the 0kl plane, in r.l.u. (the demo's Al lines and
  // three made-up others), by verdict code.
  const SHELLS = [
    { r: 1.41, code: "XTAL", color: C.grey, dash: "5 3", at: -90 },
    { r: 1.79, code: "AL", color: C.green, dash: "4 3", at: 150 },
    { r: 2.08, code: "AL", color: C.green, dash: "4 3", at: 30 },
    { r: 2.95, code: "AL", color: C.green, dash: "4 3", at: -30 },
    { r: 3.44, code: "AL", color: C.green, dash: "4 3", at: 222 },
    { r: 3.6, code: "GRID", color: C.amber, dash: "1.5 2.5", at: 250 },
    { r: 3.92, code: "NJ", color: C.white, dash: "1 3", at: 120 },
  ];
  const deg = (a) => (a * Math.PI) / 180;

  function ringsOverlay(m, { after = false } = {}) {
    let s = "";
    for (const sh of SHELLS) {
      const r = sh.r * m.s;
      const left = after && sh.code === "GRID";
      const color = left ? C.red : sh.color;
      const width = left ? 2 : after && sh.code === "AL" ? 0.9 : 1.4;
      const dash = left ? "" : `stroke-dasharray="${sh.dash}"`;
      const op = after && sh.code === "AL" ? ' opacity="0.55"' : "";
      if (after && sh.code === "XTAL") continue;
      s += `<g${op}>${haloed(circle(m.X(0), m.Y(0), r), color, width, dash)}</g>`;
      if (left) {
        // where the 3D test finds the ring left: ticks along the shell
        for (const a of [20, 110, 200, 290]) {
          const x = m.X(sh.r * Math.cos(deg(a)));
          const y = m.Y(sh.r * Math.sin(deg(a)));
          s += `<path d="M${x} ${y - 5}l4.5 7.5h-9z" fill="${C.red}" stroke="${HALO}" stroke-width="1"/>`;
        }
      }
      if (!after || left) {
        const a = deg(sh.at);
        s += chip(m.X(sh.r * Math.cos(a)), m.Y(sh.r * Math.sin(a)), left ? "LEFT" : sh.code, color);
      }
    }
    return s;
  }

  // ------------------------------------------------------------ Now examining

  const lgIcon = {
    nodes: `<svg width="12" height="12"><circle cx="6" cy="6" r="2" fill="#fff" stroke="${HALO}"/></svg>`,
    node: `<svg width="12" height="12"><circle cx="6" cy="6" r="4.2" fill="none" stroke="${C.red}" stroke-width="2"/></svg>`,
    sharp: `<svg width="12" height="12"><path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" fill="none" stroke="${C.amber}" stroke-width="1.8"/></svg>`,
    broad: `<svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="${C.cyan}" stroke-width="1.3" stroke-dasharray="3 2"/></svg>`,
    holes: `<svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="#808080" stroke="#fff" stroke-width="1"/></svg>`,
    r2: `<svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="rgba(255,79,216,0.55)" stroke="${C.r2}"/></svg>`,
  };
  const ringIcon = (color, dash, width = 1.6) =>
    `<svg width="16" height="12"><line x1="1" y1="6" x2="15" y2="6" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""}/></svg>`;

  function exBar({ label = "Now examining", what, where, stepNo, legend, paused = false }) {
    return node(`
      <div class="ex-bar${paused ? " ex-bar--paused" : ""}" role="status">
        <span class="ex-pulse"></span><span class="ex-label">${label}</span><span class="ex-what">${what}</span><span>${where}</span>
        <span class="ex-end"><button type="button" class="ex-step">step ${stepNo} ↗</button>${Q}</span>
        <div class="ex-legend">${legend}</div>
      </div>`);
  }

  const BRAGG_LEGEND = (focus) =>
    [
      ["nodes", "nodes", 25],
      ["node", "left at a node", 3],
      ["sharp", "off-lattice", 9],
      ["broad", "broad, kept", 4],
      ["holes", "holes", 25],
      ["r2", "round 2", 35],
    ]
      .map(([k, label, n]) => `<span class="lg${focus && focus !== k ? " off" : ""}">${lgIcon[k]}${label} <b>${n}</b></span>`)
      .join("");

  const RINGS_LEGEND = [
    [ringIcon(C.green, "4 3"), "AL", "removed on an Al line", 4, C.green],
    [ringIcon(C.red, ""), "LEFT", "ring left", 1, C.red],
    [ringIcon(C.amber, "1.5 2.5"), "GRID", "not confirmable on this grid", 1, C.amber],
    [ringIcon(C.grey, "5 3"), "XTAL", "the crystal's own", 1, C.grey],
    [ringIcon(C.white, "1 3"), "NJ", "not judged", 1, C.white],
  ]
    .map(([icon, code, label, n, color]) => `<span class="lg">${icon}<span class="code" style="color:${color}">${code}</span>${label} <b>${n}</b></span>`)
    .join("");

  // ------------------------------------------------------------ the page

  function mountPanel(html, sheetH, scrollToSel = null) {
    if (phone) {
      const app = $(".app");
      app.className = "app dock-sheet dock-open";
      app.style.setProperty("--sheet-h", `${sheetH}px`);
      const bar = $("aside.ai-sheetbar");
      const side = node(
        `<aside class="ai-side" aria-label="NEBULA Pilot" data-mode="sheet"><div class="ai-resize-y" role="separator" aria-orientation="horizontal" aria-label="Resize NEBULA Pilot"><span aria-hidden="true"></span></div><div class="ai-panel"></div></aside>`,
      );
      bar.replaceWith(side);
    }
    $(".ai-side .ai-panel").innerHTML = html;
    // Show the newest of the conversation, as the chat pins to its end.
    requestAnimationFrame(() => {
      const t = $(".ai-transcript");
      const target = scrollToSel && $(scrollToSel, t);
      t.scrollTop = target ? target.getBoundingClientRect().top - t.getBoundingClientRect().top + t.scrollTop - 6 : t.scrollHeight;
    });
  }

  function scrollTo(view) {
    const main = $(".main");
    if (!main || !view) return;
    requestAnimationFrame(() => {
      const top = view.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      main.scrollTop = Math.max(0, top - 64);
    });
  }

  function decorate() {
    if (phone) document.body.append(node(`<div class="mk-copy">© 2026 Tsung-Han Yang · mockup on the synthetic demo</div>`));
    else document.body.append(node(`<div class="mk-badge">Mockup · synthetic demo</div>`));
  }

  const ws = () => $(".ws");

  const SCENES = {
    cards() {
      mountPanel(
        panel({ above: changesList([{ what: "Punch min σ 8 → 6", when: "10:42" }]), transcript: T.cards() }),
        phone ? 690 : 0,
        ".pc-group",
      );
    },
    auto() {
      mountPanel(
        panel({
          above: autoPanel({ paused: false }),
          transcript: T.auto(),
          auto: true,
          placeholder: "Auto analysis is running…",
          usage: "≈ 9.4k tokens",
        }),
        phone ? 700 : 0,
        ".ai-msg-assistant",
      );
      const punched = viewNamed("Bragg-punched");
      punched.classList.add("hl-primary");
      overlay(punched, (m) => braggOverlay(m));
      ws().before(
        exBar({ label: "Auto", what: "Bragg punch fix", where: "· tuning, trial 2 of 3 · showing the punch check", stepNo: 6, legend: BRAGG_LEGEND() }),
      );
    },
    paused() {
      mountPanel(
        panel({
          above: phone ? autoLine({ paused: true }) + `<div style="flex:none">${factCard({ ...SUPERCELL, skip: true })}</div>` : autoPanel({ paused: true }),
          transcript: T.paused(),
          auto: true,
          placeholder: "Auto analysis is paused…",
          usage: "≈ 11.0k tokens",
        }),
        phone ? 620 : 0,
      );
      const punched = viewNamed("Bragg-punched");
      punched.classList.add("hl-primary");
      overlay(punched, (m) => braggOverlay(m, { focus: "sharp" }));
      ws().before(
        exBar({
          label: "Paused",
          what: "Needs you: supercell along L",
          where: "· the 9 peaks behind it are lit",
          stepNo: 1,
          legend: BRAGG_LEGEND("sharp"),
          paused: true,
        }),
      );
      if (phone) scrollTo(punched);
    },
    bragg() {
      mountPanel(panel({ transcript: T.bragg() }), 330);
      const punched = viewNamed("Bragg-punched");
      const raw = viewNamed("Raw");
      punched.classList.add("hl-primary");
      raw.classList.add("hl-reading");
      overlay(punched, (m) => braggOverlay(m));
      overlay(raw, (m) => braggOverlay(m, { reading: true }));
      ws().before(exBar({ what: "Bragg punch", where: "· leftover peaks on 0kl, H = 0", stepNo: 2, legend: BRAGG_LEGEND() }));
      if (phone) scrollTo(punched);
    },
    rings() {
      mountPanel(panel({ transcript: T.rings() }), 330);
      const raw = viewNamed("Raw");
      const removed = viewNamed("Ring-removed");
      raw.classList.add("hl-primary");
      removed.classList.add("hl-reading");
      overlay(raw, (m) => ringsOverlay(m));
      overlay(removed, (m) => ringsOverlay(m, { after: true }));
      ws().before(exBar({ what: "Ring removal", where: "· 7 shells judged in 3D", stepNo: 1, legend: RINGS_LEGEND }));
      if (phone) scrollTo(raw);
    },
  };

  decorate();
  (SCENES[scene] || SCENES.cards)();
})();
