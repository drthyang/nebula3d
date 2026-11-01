// Run the NeXus Viewer's own symmetry averaging and metric check under node, for
// scripts/viewer_symmetry_fixture.py. Only reads the viewer: its loader (js/nexus.js),
// its export's averaging (js/export.js symmetrizeForExport) and its group code
// (js/symmetry.js), from the checkout in NEXUS_VIEWER.
//
//   node scripts/viewer_symmetry_average.mjs average <file.nxs> <laue> <outdir>
//   node scripts/viewer_symmetry_average.mjs metric '<json [[cell, laue], ...]>'
//   node scripts/viewer_symmetry_average.mjs presets
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const V = resolve(process.env.NEXUS_VIEWER ?? '../neutron-nexus-viewer');
const { closeGroup, formatOp, indexMaps, metricChange, parseOps, PRESETS } = await import(`${V}/js/symmetry.js`);
const ops = (laue) => {
  const preset = PRESETS.find(([name]) => name === laue);
  return closeGroup(parseOps(preset ? preset[1] : laue));
};

const [mode, ...args] = process.argv.slice(2);
if (mode === 'presets') {
  console.log(JSON.stringify({ names: PRESETS.map(([n]) => n), ops: Object.fromEntries(PRESETS.map(([n]) => [n, ops(n).map(formatOp)])) }));
} else if (mode === 'metric') {
  const cases = JSON.parse(args[0]);
  console.log(JSON.stringify(cases.map(([[a, b, c, alpha, beta, gamma], laue]) => metricChange(ops(laue), { a, b, c, alpha, beta, gamma }))));
} else if (mode === 'average') {
  const [file, laue, outdir] = args;
  const h5wasm = (await import(`${V}/node_modules/h5wasm/dist/node/hdf5_hl.js`)).default;
  const { describeFile, loadVolume, loadVariance } = await import(`${V}/js/nexus.js`);
  const { exportPlan, symmetrizeForExport } = await import(`${V}/js/export.js`);
  await h5wasm.ready;
  const f = new h5wasm.File(file, 'r');
  const info = describeFile(f);
  const { volume } = loadVolume(f, info);
  const variance = loadVariance(f, info);
  f.close();
  const group = ops(laue);
  const plan = exportPlan(info.dims, info.lattice);
  const res = symmetrizeForExport(volume, info.shape, plan, indexMaps(group, plan.paddedDims), { variance });
  mkdirSync(outdir, { recursive: true });
  writeFileSync(join(outdir, 'data.f32'), Buffer.from(res.data.buffer));
  writeFileSync(join(outdir, 'valid.u8'), Buffer.from(res.valid.buffer));
  writeFileSync(join(outdir, 'sigma.f32'), Buffer.from(res.sigma.buffer));
  writeFileSync(join(outdir, 'meta.json'), JSON.stringify({
    shape: plan.shape, padded: plan.padded, ops: group.map(formatOp), stats: res.stats,
    metric: metricChange(group, info.lattice),
  }));
} else {
  throw new Error(`unknown mode ${mode}`);
}
