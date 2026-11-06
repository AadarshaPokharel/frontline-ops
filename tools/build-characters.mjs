// Turns the CC0 Quaternius "Universal Base Characters" and "Universal Animation Library" (Standard, free) packs
// into compact game files:
//   client/public/characters/soldier_m.glb, soldier_f.glb  (bodies: simplified, meshopt, 1024px WebP textures)
//   client/public/characters/animations.glb               (only the clips the game uses, no mesh)
// Usage (Node 20+): unzip both zips, then
//   node build-characters.mjs "<...>/Universal Base Characters[Standard]" "<...>/Universal Animation Library[Standard]"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [ubc, ual] = process.argv.slice(2);
if (!ubc || !ual) {
  console.error('usage: node build-characters.mjs <Universal Base Characters folder> <Universal Animation Library folder>');
  process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'characters');
mkdirSync(OUT, { recursive: true });
export const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Loop',
  'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Reload', 'Pistol_Shoot', 'Hit_Chest', 'Punch_Cross', 'Punch_Jab', 'Death01',
];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const kb = f => `${Math.round(statSync(f).size / 1024)} KB`;
const compress = meshopt({ encoder: MeshoptEncoder, level: 'medium' });

// Some image references in the pack say "X_png.png" where the file on disk is "X.png"; fall back to it.
function readGltf(path) {
  const dir = dirname(path), json = JSON.parse(readFileSync(path, 'utf8')), resources = {};
  for (const b of json.buffers || []) if (b.uri) resources[b.uri] = readFileSync(join(dir, b.uri));
  for (const img of json.images || []) {
    if (!img.uri) continue;
    const alt = img.uri.replace(/_png\.png$/, '.png');
    resources[img.uri] = readFileSync(join(dir, existsSync(join(dir, img.uri)) ? img.uri : alt));
  }
  return io.readJSON({ json, resources });
}

for (const [name, file] of [['soldier_m', 'Superhero_Male_FullBody.gltf'], ['soldier_f', 'Superhero_Female_FullBody.gltf']]) {
  const doc = await readGltf(join(ubc, 'Base Characters', 'Godot - UE', file));
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),   // ~12k -> ~6k triangles; seen from metres away
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    dedup(), prune(), compress,
  );
  const out = join(OUT, `${name}.glb`);
  await io.write(out, doc);
  console.log(`character ${name}: ${kb(out)}`);
}

const anim = await io.read(join(ual, 'Unreal-Godot', 'UAL1_Standard.glb'));
const root = anim.getRoot();
for (const a of root.listAnimations()) if (!CLIPS.includes(a.getName())) a.dispose();
// The rig keys translation and scale on every bone, but only the root and pelvis actually move; bones are rigid.
// Finger bones (almost half the skeleton) are invisible at game distances, so their tracks go too.
const FINGER = /^(index|middle|ring|pinky|thumb)_/;
for (const a of root.listAnimations())
  for (const ch of a.listChannels()) {
    const bone = ch.getTargetNode()?.getName() || '';
    if (FINGER.test(bone) || (ch.getTargetPath() !== 'rotation' && !['root', 'pelvis'].includes(bone))) { ch.getSampler()?.dispose(); ch.dispose(); }
  }
for (const node of root.listNodes()) node.setMesh(null);   // keep the skeleton, drop the mannequin
for (const m of root.listMeshes()) m.dispose();
await anim.transform(prune({ keepLeaves: true }), resample({ tolerance: 0.0005 }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
const out = join(OUT, 'animations.glb');
await io.write(out, anim);
console.log(`animations: ${root.listAnimations().map(a => a.getName()).join(', ')} (${kb(out)})`);

writeFileSync(join(OUT, 'CREDITS.txt'),
  'Characters and animations by Quaternius (https://quaternius.com), licensed CC0 1.0 (public domain):\n' +
  '  soldier_m.glb, soldier_f.glb  <-  Universal Base Characters (Standard)  https://quaternius.itch.io/universal-base-characters\n' +
  '  animations.glb                <-  Universal Animation Library (Standard) https://quaternius.itch.io/universal-animation-library\n' +
  'Simplified, recompressed and trimmed to the clips the game uses. Uniforms, helmets and vests are added by the game.\n');
