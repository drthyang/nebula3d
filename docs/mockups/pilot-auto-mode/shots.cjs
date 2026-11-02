// Screenshots of every mockup scene, desktop (1440x900) and phone (390x844), at 2x.
const { chromium } = require(process.argv[2]);
const dir = process.argv[3];
const out = process.argv[4];
const scenes = (process.argv[5] || "cards,auto,paused,bragg,rings").split(",");
(async () => {
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  for (const [dev, w, h] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    for (const s of scenes) {
      const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      p.on("pageerror", (e) => console.log(dev, s, "pageerror", e.message));
      p.on("console", (m) => { if (m.type() === "error") console.log(dev, s, "console", m.text().slice(0, 160)); });
      await p.goto(`file://${dir}/${dev}.html#${s}`, { waitUntil: "load" });
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${out}/${dev}-${s}.png` });
      await p.close();
    }
  }
  await b.close();
})();
