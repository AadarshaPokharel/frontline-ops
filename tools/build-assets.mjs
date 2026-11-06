// Downloads the CC0 assets used by the game from Poly Haven (https://polyhaven.com, public domain)
// and compresses them for the browser:
//   models   -> client/public/models/<key>.glb   (meshopt geometry, 512px WebP textures)
//   textures -> client/public/textures/<key>_{diff,nor,rough}.webp (1024px)
// Usage (needs Node 20+): cd tools && npm install && npm run assets
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'client', 'public');
const GLTF_TRANSFORM = join(HERE, 'node_modules', '.bin', 'gltf-transform');

// Poly Haven models are scanned/high-poly (a crate is ~13k triangles). In this top-down view a prop is a few dozen
// pixels across, so each is simplified to a few hundred triangles; the normal maps keep the surface detail.
// `error` is the allowed deviation as a fraction of the model's size.
const MODELS = {
  crate: { id: 'wooden_military_crate', ratio: 0.02, error: 0.06 },
  ammo: { id: 'ammo_box', ratio: 0.08, error: 0.02 },
  barrel: { id: 'Barrel_01', ratio: 0.15, error: 0.02 },
  barrier: { id: 'concrete_road_barrier', ratio: 0.01, error: 0.04 },
  jerrycan: { id: 'metal_jerrycan_green', ratio: 0.05, error: 0.02 },
};
const TEXTURES = {
  concrete: 'concrete_floor_02',
  iron: 'corrugated_iron_02',
  sand: 'aerial_sand',
  sandstone: 'sandstone_blocks_08',
  asphalt: 'asphalt_02',
  brick: 'brick_wall_001',
};
const TEXTURE_MAPS = { diff: 'Diffuse', nor: 'nor_gl', rough: 'Rough' };

const keepTmp = !!process.env.ASSET_TMP;
const tmp = process.env.ASSET_TMP || mkdtempSync(join(tmpdir(), 'frontline-assets-'));

async function download(url, file) {
  if (existsSync(file)) return;            // re-runs reuse what is already downloaded
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
async function filesOf(id) {
  const meta = join(tmp, `${id}.files.json`);
  await download(`https://api.polyhaven.com/files/${id}`, meta);
  return JSON.parse(readFileSync(meta, 'utf8'));
}
const kb = file => `${Math.round(statSync(file).size / 1024)} KB`;

const credits = [];
mkdirSync(join(OUT, 'models'), { recursive: true });
mkdirSync(join(OUT, 'textures'), { recursive: true });

const gltfTransform = (...args) => execFileSync(GLTF_TRANSFORM, args, { stdio: ['ignore', 'ignore', 'inherit'] });
for (const [key, { id, ratio, error }] of Object.entries(MODELS)) {
  const gltf = (await filesOf(id)).gltf['1k'].gltf, dir = join(tmp, id), src = join(dir, `${id}.gltf`);
  await download(gltf.url, src);
  for (const [rel, inc] of Object.entries(gltf.include)) await download(inc.url, join(dir, rel));
  const welded = join(dir, 'welded.glb'), simple = join(dir, 'simple.glb'), out = join(OUT, 'models', `${key}.glb`);
  gltfTransform('weld', src, welded);
  gltfTransform('simplify', welded, simple, '--ratio', String(ratio), '--error', String(error));
  gltfTransform('optimize', simple, out, '--simplify', 'false', '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512');
  console.log(`model   ${key.padEnd(9)} <- ${id}  (${kb(out)})`);
  credits.push(`models/${key}.glb  <-  ${id}  https://polyhaven.com/a/${id}`);
}

for (const [key, id] of Object.entries(TEXTURES)) {
  const files = await filesOf(id);
  for (const [suffix, map] of Object.entries(TEXTURE_MAPS)) {
    const src = join(tmp, `${id}_${suffix}.jpg`), out = join(OUT, 'textures', `${key}_${suffix}.webp`);
    await download(files[map]['1k'].jpg.url, src);
    await sharp(src).resize(1024, 1024).webp({ quality: suffix === 'nor' ? 88 : 80 }).toFile(out);   // seen up close in first person
    console.log(`texture ${`${key}_${suffix}`.padEnd(15)} <- ${id}  (${kb(out)})`);
  }
  credits.push(`textures/${key}_*.webp  <-  ${id}  https://polyhaven.com/a/${id}`);
}

writeFileSync(join(OUT, 'CREDITS.txt'),
  'All models and textures in this folder come from Poly Haven (https://polyhaven.com)\n' +
  'and are licensed CC0 1.0 (public domain). They were resized and recompressed for the web.\n\n' +
  credits.join('\n') + '\n');

if (!keepTmp) rmSync(tmp, { recursive: true, force: true });
console.log('done');
