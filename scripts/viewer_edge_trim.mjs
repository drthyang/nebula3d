// Run the NeXus Viewer's own coverage-edge erosion under node, for
// scripts/viewer_edge_trim_fixture.py. Only reads the viewer: its loader
// (js/nexus.js) and its mask (js/mask.js edgeMask, maskStats), from the checkout
// in NEXUS_VIEWER.
//
//   node scripts/viewer_edge_trim.mjs <file.nxs> <outdir> <r> [<r> ...]
//
// For each erosion radius r it writes valid_<r>.u8: 1 where the viewer keeps a
// measured voxel (finite, unmasked, not EDGE), in the order of the viewer's
// volume, and meta.json with the volume's shape and maskStats for each r.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const V = resolve(process.env.NEXUS_VIEWER ?? '../neutron-nexus-viewer');
const h5wasm = (await import(`${V}/node_modules/h5wasm/dist/node/hdf5_hl.js`)).default;
const { describeFile, loadVolume } = await import(`${V}/js/nexus.js`);
const { EDGE, edgeMask, maskStats } = await import(`${V}/js/mask.js`);

const [file, outdir, ...radii] = process.argv.slice(2);
await h5wasm.ready;
const f = new h5wasm.File(file, 'r');
const info = describeFile(f);
const { volume } = loadVolume(f, info);
f.close();
mkdirSync(outdir, { recursive: true });
const stats = {};
for (const r of radii.map(Number)) {
  const mask = edgeMask(volume, info.shape, r);
  const valid = new Uint8Array(volume.length);
  for (let i = 0; i < volume.length; i++) valid[i] = volume[i] === volume[i] && !(mask[i] & EDGE) ? 1 : 0;
  writeFileSync(join(outdir, `valid_${r}.u8`), Buffer.from(valid.buffer));
  stats[r] = maskStats(volume, mask);
}
writeFileSync(join(outdir, 'meta.json'), JSON.stringify({ shape: info.shape, storageShape: info.storageShape, stats }));
