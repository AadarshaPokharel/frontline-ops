import * as THREE from 'three';

// Gun models shared by the first-person viewmodel and third-person characters, built from primitives.
// Gun space: the grip is the origin, the barrel points down -Z, +Y is up. Sizes are in metres.

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });
export const MATS = {
  metal: mat('#5a5f66', { metalness: 0.7, roughness: 0.38 }),
  dark: mat('#33363b', { metalness: 0.45, roughness: 0.5 }),
  poly: mat('#2a2c2f', { roughness: 0.7 }),
  wood: mat('#6e4527', { roughness: 0.7 }),
  glass: mat('#3d6fa0', { metalness: 0.9, roughness: 0.1 }),
  window: mat('#a8d8ff', { metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.28 }),
  dot: mat('#ff2a1a', { emissive: '#ff2a1a', emissiveIntensity: 2 }),
  glove: mat('#24221f', { roughness: 0.9 }),
};

// [material, shape, w|r, h|len, d, x, y, z, rotX, tag]; shape 'b' = box, 'c' = cylinder along Z. `mag` marks the magazine.
// sight = height of the iron-sight line; rail/mount = where an optic sits on top of the receiver.
export const GUNS = {
  ar: {
    muzzle: -0.68, fore: -0.34, sight: 0.078, rail: 0.079, mount: -0.15, parts: [
      ['dark', 'b', 0.05, 0.08, 0.32, 0, 0.02, -0.1], ['poly', 'b', 0.056, 0.062, 0.24, 0, 0.022, -0.36], ['metal', 'c', 0.012, 0.2, 0, 0, 0.03, -0.56],
      ['metal', 'c', 0.018, 0.05, 0, 0, 0.03, -0.66], ['poly', 'b', 0.045, 0.07, 0.2, 0, 0.005, 0.15], ['poly', 'b', 0.03, 0.09, 0.04, 0, -0.06, 0.02, -0.3],
      ['dark', 'b', 0.03, 0.022, 0.16, 0, 0.068, -0.12], ['metal', 'b', 0.018, 0.035, 0.02, 0, 0.09, -0.02, 0, 'rear'], ['metal', 'b', 0.018, 0.04, 0.02, 0, 0.088, -0.44],
      ['dark', 'b', 0.034, 0.15, 0.07, 0, -0.09, -0.13, 0.18, 'mag'],
    ],
  },
  smg: {
    muzzle: -0.38, fore: -0.22, sight: 0.072, rail: 0.06, mount: -0.09, parts: [
      ['dark', 'b', 0.05, 0.08, 0.26, 0, 0.02, -0.06], ['poly', 'b', 0.046, 0.055, 0.12, 0, 0.02, -0.25], ['metal', 'c', 0.011, 0.08, 0, 0, 0.025, -0.34],
      ['poly', 'b', 0.035, 0.05, 0.16, 0, 0.0, 0.13], ['poly', 'b', 0.03, 0.09, 0.04, 0, -0.06, 0.02, -0.3], ['metal', 'b', 0.016, 0.03, 0.02, 0, 0.074, 0.0, 0, 'rear'],
      ['metal', 'b', 0.016, 0.034, 0.02, 0, 0.072, -0.17], ['dark', 'b', 0.03, 0.16, 0.05, 0, -0.1, -0.1, 0.12, 'mag'],
    ],
  },
  shotgun: {
    muzzle: -0.68, fore: -0.33, sight: 0.06, rail: 0.053, mount: -0.08, parts: [
      ['metal', 'c', 0.016, 0.56, 0, 0, 0.032, -0.38], ['metal', 'c', 0.013, 0.45, 0, 0, -0.002, -0.33], ['dark', 'b', 0.05, 0.075, 0.17, 0, 0.015, -0.05],
      ['wood', 'b', 0.054, 0.05, 0.15, 0, -0.004, -0.33], ['wood', 'b', 0.045, 0.09, 0.27, 0, -0.02, 0.16], ['metal', 'b', 0.012, 0.018, 0.012, 0, 0.055, -0.64],
      ['dark', 'b', 0.02, 0.03, 0.05, 0, -0.035, -0.08, 0, 'mag'],
    ],
  },
  sniper: {
    muzzle: -0.78, fore: -0.3, sight: 0.064, rail: 0.05, mount: -0.1, parts: [
      ['dark', 'b', 0.05, 0.07, 0.34, 0, 0.015, -0.08], ['metal', 'c', 0.013, 0.5, 0, 0, 0.03, -0.5], ['metal', 'c', 0.018, 0.05, 0, 0, 0.03, -0.76],
      ['metal', 'b', 0.008, 0.026, 0.01, 0, 0.055, -0.72], ['metal', 'b', 0.02, 0.014, 0.01, 0, 0.057, 0.02, 0, 'rear'],
      ['poly', 'b', 0.05, 0.1, 0.3, 0, -0.01, 0.2], ['metal', 'b', 0.05, 0.015, 0.015, 0.035, 0.03, 0.02], ['dark', 'b', 0.034, 0.06, 0.08, 0, -0.06, -0.08, 0, 'mag'],
    ],
  },
  lmg: {
    muzzle: -0.68, fore: -0.3, sight: 0.09, rail: 0.07, mount: 0.03, parts: [
      ['dark', 'b', 0.065, 0.1, 0.36, 0, 0.02, -0.08], ['metal', 'c', 0.015, 0.4, 0, 0, 0.03, -0.46], ['metal', 'c', 0.022, 0.06, 0, 0, 0.03, -0.66],
      ['poly', 'b', 0.05, 0.08, 0.22, 0, 0.005, 0.17], ['poly', 'b', 0.03, 0.09, 0.04, 0, -0.065, 0.02, -0.3], ['metal', 'b', 0.018, 0.04, 0.12, 0, 0.09, -0.1],
      ['dark', 'b', 0.09, 0.1, 0.11, -0.03, -0.1, -0.08, 0, 'mag'],
    ],
  },
  pistol: {
    muzzle: -0.19, fore: 0.0, sight: 0.062, rail: 0.052, mount: -0.07, parts: [
      ['dark', 'b', 0.035, 0.04, 0.2, 0, 0.032, -0.07], ['poly', 'b', 0.03, 0.03, 0.16, 0, 0.006, -0.06], ['poly', 'b', 0.032, 0.1, 0.05, 0, -0.045, 0.02, -0.25],
      ['metal', 'b', 0.008, 0.012, 0.01, 0, 0.058, -0.16], ['metal', 'b', 0.02, 0.012, 0.01, 0, 0.058, 0.02, 0, 'rear'], ['dark', 'b', 0.026, 0.06, 0.035, 0, -0.1, 0.03, -0.25, 'mag'],
    ],
  },
};

// Optics, in mount space (origin on top of the rail). eye = height of the sight line above the rail.
const OPTICS = {
  reddot: { eye: 0.03, parts: [
    ['dark', 'b', 0.03, 0.012, 0.05, 0, 0.006, 0], ['dark', 'c', 0.019, 0.05, 0, 0, 0.03, 0], ['window', 'c', 0.016, 0.004, 0, 0, 0.03, -0.024], ['dot', 'b', 0.003, 0.003, 0.002, 0, 0.03, 0.02],
  ] },
  holo: { eye: 0.03, parts: [
    ['dark', 'b', 0.036, 0.014, 0.075, 0, 0.007, 0], ['dark', 'b', 0.006, 0.044, 0.014, -0.02, 0.03, -0.03], ['dark', 'b', 0.006, 0.044, 0.014, 0.02, 0.03, -0.03],
    ['dark', 'b', 0.046, 0.007, 0.014, 0, 0.053, -0.03], ['window', 'b', 0.034, 0.036, 0.002, 0, 0.03, -0.03], ['dark', 'b', 0.03, 0.02, 0.03, 0, 0.022, 0.022],
  ] },
  acog: { eye: 0.037, parts: [
    ['dark', 'b', 0.028, 0.016, 0.08, 0, 0.008, 0], ['poly', 'c', 0.021, 0.16, 0, 0, 0.037, 0], ['poly', 'c', 0.026, 0.035, 0, 0, 0.037, -0.08],
    ['glass', 'c', 0.021, 0.004, 0, 0, 0.037, -0.099], ['glass', 'c', 0.018, 0.004, 0, 0, 0.037, 0.081], ['dark', 'b', 0.012, 0.014, 0.02, 0, 0.062, -0.02],
  ] },
  sniper: { eye: 0.046, parts: [
    ['dark', 'b', 0.022, 0.024, 0.03, 0, 0.012, -0.08], ['dark', 'b', 0.022, 0.024, 0.03, 0, 0.012, 0.07], ['poly', 'c', 0.024, 0.3, 0, 0, 0.046, 0],
    ['poly', 'c', 0.034, 0.075, 0, 0, 0.046, -0.17], ['poly', 'c', 0.029, 0.05, 0, 0, 0.046, 0.16], ['glass', 'c', 0.031, 0.004, 0, 0, 0.046, -0.209],
    ['glass', 'c', 0.024, 0.004, 0, 0, 0.046, 0.186], ['dark', 'c', 0.012, 0.03, 0, 0.03, 0.046, 0],
  ] },
};

// Geometry is cached: every copy of a gun shares the same buffers.
const geometries = new Map();
const cached = (key, make) => geometries.get(key) || geometries.set(key, make()).get(key);
const box = (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (r, len) => cached(`c${r},${len}`, () => new THREE.CylinderGeometry(r, r, len, 16).rotateX(Math.PI / 2));

function addParts(parent, parts, castShadow) {
  const tagged = {};
  for (const [m, shape, a, b, c, x, y, z, rx = 0, tag] of parts) {
    const mesh = new THREE.Mesh(shape === 'c' ? cyl(a, b) : box(a, b, c), MATS[m]);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = castShadow && m !== 'window';
    parent.add(mesh);
    if (tag) tagged[tag] = mesh;
  }
  return tagged;
}

/** A gun with an optional optic. Returns the sight-line height so aiming down sights lines it up with the screen centre. */
export function buildGun(id, castShadow = false, optic = 'iron') {
  const spec = GUNS[id] || GUNS.ar, group = new THREE.Group(), tagged = addParts(group, spec.parts, castShadow);
  let sight = spec.sight;
  const model = OPTICS[optic];
  if (model) {
    const mount = new THREE.Group();
    mount.position.set(0, spec.rail, spec.mount);
    addParts(mount, model.parts, castShadow);
    group.add(mount);
    if (tagged.rear) tagged.rear.visible = false;   // the rear iron sight folds down under an optic
    sight = spec.rail + model.eye;
  }
  return { group, spec, mag: tagged.mag || null, sight };
}
