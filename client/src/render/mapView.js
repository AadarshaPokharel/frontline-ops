import * as THREE from 'three';
import { TILE, HEIGHTS } from '@shared/constants.js';

const CHUNK = 8;           // tiles per chunk side: separate meshes let the camera cull what is off-screen
const WALL_TEX = 0.5;      // wall textures repeat every 2 m
const UP = new THREE.Vector3(0, 1, 0);

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Walls for one chunk: a top and only the side faces that are not hidden by a neighbouring wall.
function wallGeometry(world, cx0, cz0) {
  const pos = [], nor = [], uv = [], index = [], H = HEIGHTS['#'], S = WALL_TEX, T = TILE;
  const isWall = (x, z) => x >= 0 && z >= 0 && x < world.w && z < world.h && world.grid[z][x] === '#';
  const quad = (a, b, c, d, n, uvs) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nor.push(...n);
    uv.push(...uvs);
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  for (let tz = cz0; tz < Math.min(world.h, cz0 + CHUNK); tz++) for (let tx = cx0; tx < Math.min(world.w, cx0 + CHUNK); tx++) {
    if (!isWall(tx, tz)) continue;
    const x0 = tx * T, x1 = x0 + T, z0 = tz * T, z1 = z0 + T, h = H * S;
    quad([x0, H, z0], [x0, H, z1], [x1, H, z1], [x1, H, z0], [0, 1, 0], [x0 * S, z0 * S, x0 * S, z1 * S, x1 * S, z1 * S, x1 * S, z0 * S]);
    if (!isWall(tx, tz - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], [0, 0, -1], [-x1 * S, 0, -x0 * S, 0, -x0 * S, h, -x1 * S, h]);
    if (!isWall(tx, tz + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], [0, 0, 1], [x0 * S, 0, x1 * S, 0, x1 * S, h, x0 * S, h]);
    if (!isWall(tx - 1, tz)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], [-1, 0, 0], [z0 * S, 0, z1 * S, 0, z1 * S, h, z0 * S, h]);
    if (!isWall(tx + 1, tz)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], [1, 0, 0], [-z1 * S, 0, -z0 * S, 0, -z0 * S, h, -z1 * S, h]);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export class MapView {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.group = null;
    this.owned = [];
    this.token = 0;
  }

  // Resolves false if another build() started while this one was loading textures.
  async build(world, theme) {
    const token = ++this.token;
    const [floorTex, wallTex] = await Promise.all([this.assets.textureSet(theme.floor), this.assets.textureSet(theme.wall)]);
    if (token !== this.token) return false;
    this.dispose();
    const group = new THREE.Group(), W = world.w * TILE, D = world.h * TILE;

    // floor, extended well past the border so the horizon never shows the void
    const pad = 120, fw = W + pad * 2, fd = D + pad * 2, floorGeo = new THREE.PlaneGeometry(fw, fd).rotateX(-Math.PI / 2);
    const uv = floorGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * fw) / theme.floorRepeat, (uv.getY(i) * fd) / theme.floorRepeat);
    const floorMat = new THREE.MeshStandardMaterial({ ...floorTex, color: theme.floorTint, roughness: 1, metalness: 0 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(W / 2, 0, D / 2);
    floor.receiveShadow = true;
    group.add(floor);
    this.owned.push(floorGeo, floorMat);

    const wallMat = new THREE.MeshStandardMaterial({ ...wallTex, color: theme.wallTint, roughness: 0.95, metalness: 0.05 });
    this.owned.push(wallMat);
    for (let cz = 0; cz < world.h; cz += CHUNK) for (let cx = 0; cx < world.w; cx += CHUNK) {
      const geo = wallGeometry(world, cx, cz);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      this.owned.push(geo);
    }

    // props: one InstancedMesh per model part per chunk
    const placements = new Map();
    const put = (key, chunk, matrix) => {
      const k = `${key}|${chunk}`;
      if (!placements.has(k)) placements.set(k, { key, list: [] });
      placements.get(k).list.push(matrix);
    };
    this.placeCover(world, theme, put);
    this.placeDecor(world, theme, put);
    for (const { key, list } of placements.values()) {
      for (const { geometry, material } of this.assets.models[key].parts) {
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        list.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
        this.owned.push(mesh);
      }
    }
    this.group = group;
    this.scene.add(group);
    return true;
  }

  // Cover props are scaled to fill exactly the column the simulation uses, so what you see is what stops bullets.
  placeCover(world, theme, put) {
    const models = this.assets.models, q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const matrix = (x, y, z, yaw, sx, sy, sz) => new THREE.Matrix4().compose(p.set(x, y, z), q.setFromAxisAngle(UP, yaw), s.set(sx, sy, sz));
    for (let tz = 0; tz < world.h; tz++) for (let tx = 0; tx < world.w; tx++) {
      const ch = world.grid[tz][tx];
      if (ch !== 'c' && ch !== 'C') continue;
      const chunk = `${Math.floor(tx / CHUNK)},${Math.floor(tz / CHUNK)}`, cx = (tx + 0.5) * TILE, cz = (tz + 0.5) * TILE, r = hash(tx, tz);
      const kind = ch === 'C' ? 'crate' : theme.cover[Math.floor(hash(tx >> 1, tz >> 1) * theme.cover.length)];
      const size = models[kind].size, longX = size.x >= size.z, L = Math.max(size.x, size.z), Wd = Math.min(size.x, size.z);
      if (kind === 'crate') {
        // two crates side by side per layer; tall cover is two layers
        const layers = ch === 'C' ? 2 : 1, layerH = HEIGHTS[ch] / layers, k = (TILE - 0.04) / L, sy = layerH / size.y, wide = (TILE / 2 - 0.02) / Wd;
        const [sx, sz] = longX ? [k, wide] : [wide, k];
        for (let layer = 0; layer < layers; layer++) {
          // rot is the direction the pair is laid out in; the yaw turns the model's long side across that direction
          const rot = ((tx + tz + layer) % 2) * (Math.PI / 2), jitter = (hash(tx * 7 + layer, tz * 3) - 0.5) * 0.04;
          const yaw = rot + (longX ? 0 : Math.PI / 2) + jitter;
          for (const side of [-0.5, 0.5]) {
            const ox = side * (TILE / 2) * Math.sin(rot), oz = side * (TILE / 2) * Math.cos(rot);
            put('crate', chunk, matrix(cx + ox, layer * layerH, cz + oz, yaw, sx, sy, sz));
          }
        }
      } else {
        // a 2x2 cluster of barrels as tall as low cover
        const k = (TILE / 2 - 0.06) / L, sy = HEIGHTS.c / size.y;
        for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]])
          put('barrel', chunk, matrix(cx + ox, 0, cz + oz, (r + ox + oz) * 9, k, sy, k));
      }
    }
  }

  // Small props tucked against walls; purely visual.
  placeDecor(world, theme, put) {
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    let placed = 0;
    for (let tz = 1; tz < world.h - 1 && placed < 16; tz++) for (let tx = 7; tx < world.w - 7 && placed < 16; tx++) {
      if (world.grid[tz][tx] !== '.' || hash(tx * 13, tz * 29) > 0.07) continue;
      const wall = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => world.grid[tz + dz][tx + dx] === '#');
      if (!wall) continue;
      const key = theme.decor[placed % theme.decor.length], [dx, dz] = wall;
      q.setFromAxisAngle(UP, hash(tx, tz * 5) * Math.PI * 2);
      put(key, `${Math.floor(tx / CHUNK)},${Math.floor(tz / CHUNK)}`,
        new THREE.Matrix4().compose(p.set((tx + 0.5 + dx * 0.38) * TILE, 0, (tz + 0.5 + dz * 0.38) * TILE), q, s));
      placed++;
    }
  }

  dispose() {
    if (this.group) this.scene.remove(this.group);
    for (const o of this.owned) o.dispose();   // shared model geometry/materials and cached textures are kept
    this.owned = [];
    this.group = null;
  }
}
