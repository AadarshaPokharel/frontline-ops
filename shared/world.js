import { TILE, HEIGHTS } from './constants.js';
import { clamp } from './util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const WALL = HEIGHTS['#'];

// Stamp the map's rectangles onto a grid: '#' wall, 'C' tall cover, 'c' low cover, '.' floor. The border is always wall.
export function buildGrid(map) {
  const { w, h } = map, g = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.');
    g.push(row);
  }
  for (const [x, y, rw, rh, c = '#'] of map.rects)
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++)
      if (j > 0 && i > 0 && j < h - 1 && i < w - 1) g[j][i] = c;
  return g;
}

/** The map as a height field of 2 m columns. Movement is 2D (x/z); shots and sight lines are 3D. */
export class World {
  constructor(map) {
    this.map = map;
    this.w = map.w;
    this.h = map.h;
    this.grid = buildGrid(map);
    this.heights = new Float32Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.heights[y * this.w + x] = HEIGHTS[this.grid[y][x]] || 0;
    this.prev = new Int32Array(this.w * this.h);   // reused by findPath
    this.queue = new Int32Array(this.w * this.h);
    this.hit = { t: 0, nx: 0, ny: 0, nz: 0 };
  }

  heightT(tx, tz) { return tx < 0 || tz < 0 || tx >= this.w || tz >= this.h ? WALL : this.heights[tz * this.w + tx]; }
  solidT(tx, tz) { return this.heightT(tx, tz) > 0; }
  solidAt(x, z) { return this.solidT(Math.floor(x / TILE), Math.floor(z / TILE)); }
  heightAt(x, z) { return this.heightT(Math.floor(x / TILE), Math.floor(z / TILE)); }

  collides(x, z, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE), z0 = Math.floor((z - r) / TILE), z1 = Math.floor((z + r) / TILE);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      if (!this.solidT(tx, tz)) continue;
      const cx = clamp(x, tx * TILE, tx * TILE + TILE), cz = clamp(z, tz * TILE, tz * TILE + TILE);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  // Slide along walls by resolving each axis separately; a blocked axis loses its velocity.
  move(s, dx, dz, r) {
    s.x += dx;
    if (this.collides(s.x, s.z, r)) { s.x -= dx; s.vx = 0; }
    s.z += dz;
    if (this.collides(s.x, s.z, r)) { s.z -= dz; s.vz = 0; }
  }

  /**
   * First solid surface along a ray (direction must be normalised): walls/cover columns and the floor.
   * Grid traversal (DDA) in x/z, checking the ray's height inside each column. Returns this.hit or null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const hit = this.hit, tFloor = dy < 0 ? -oy / dy : Infinity;
    let tx = Math.floor(ox / TILE), tz = Math.floor(oz / TILE);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(TILE / dx) : Infinity, tdz = dz ? Math.abs(TILE / dz) : Infinity;
    let tmx = dx ? (dx > 0 ? (tx + 1) * TILE - ox : ox - tx * TILE) / Math.abs(dx) : Infinity;
    let tmz = dz ? (dz > 0 ? (tz + 1) * TILE - oz : oz - tz * TILE) / Math.abs(dz) : Infinity;
    let tIn = 0, nx = 0, nz = 0;
    for (let guard = 0; guard < 512 && tIn <= maxT; guard++) {
      const h = this.heightT(tx, tz), tOut = Math.min(tmx, tmz);
      if (h > 0) {
        if (oy + dy * tIn <= h) return set(hit, tIn, nx, nx || nz ? 0 : 1, nz, maxT);   // side face (or starting inside)
        if (dy < 0) {
          const tTop = (h - oy) / dy;
          if (tTop <= tOut) return set(hit, tTop, 0, 1, 0, maxT);                        // came down onto the top
        }
      } else if (tFloor <= tOut) return set(hit, tFloor, 0, 1, 0, maxT);
      if (tmx < tmz) { tIn = tmx; tmx += tdx; tx += sx; nx = -sx; nz = 0; }
      else { tIn = tmz; tmz += tdz; tz += sz; nx = 0; nz = -sz; }
    }
    return null;
  }

  // Clear line between two points?
  visible(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05);
  }

  // 8-way breadth-first search over walkable tiles; returns tile centres (metres) from start (exclusive) to goal, or null.
  findPath(x0, z0, x1, z1) {
    const { w, h, heights, prev, queue } = this;
    const sx = Math.floor(x0 / TILE), sz = Math.floor(z0 / TILE), gx = Math.floor(x1 / TILE), gz = Math.floor(z1 / TILE);
    if (this.solidT(gx, gz) || this.solidT(sx, sz)) return null;
    const start = sz * w + sx, goal = gz * w + gx;
    if (start === goal) return [];
    prev.fill(-1);
    prev[start] = start;
    let head = 0, tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      if (c === goal) break;
      const cx = c % w, cz = (c / w) | 0;
      for (const [ddx, ddz] of DIRS) {
        const nx = cx + ddx, nz = cz + ddz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const ni = nz * w + nx;
        if (prev[ni] !== -1 || heights[ni] > 0) continue;
        if (ddx && ddz && (heights[cz * w + nx] > 0 || heights[nz * w + cx] > 0)) continue;   // no corner cutting
        prev[ni] = c;
        queue[tail++] = ni;
      }
    }
    if (prev[goal] === -1) return null;
    const path = [];
    for (let c = goal; c !== start; c = prev[c]) path.push({ x: ((c % w) + 0.5) * TILE, z: (((c / w) | 0) + 0.5) * TILE });
    return path.reverse();
  }
}

function set(hit, t, nx, ny, nz, maxT) {
  if (t > maxT) return null;
  hit.t = t;
  hit.nx = nx;
  hit.ny = ny;
  hit.nz = nz;
  return hit;
}

// Distance along a normalised ray to a sphere, or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz, c = fx * fx + fy * fy + fz * fz - r * r, disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

// Distance along a normalised ray to an upright cylinder (side or top cap), or Infinity.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const fx = ox - cx, fz = oz - cz, a = dx * dx + dz * dz;
  let best = Infinity;
  if (a > 1e-9) {
    const b = fx * dx + fz * dz, c = fx * fx + fz * fz - r * r, disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a, y = oy + dy * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  if (dy < 0) {   // coming down onto the top cap
    const t = (y1 - oy) / dy, px = fx + dx * t, pz = fz + dz * t;
    if (t >= 0 && t < best && px * px + pz * pz <= r * r) best = t;
  }
  return best;
}
