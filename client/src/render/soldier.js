import * as THREE from 'three';
import { rand } from '@shared/util.js';

// A low-poly soldier built from primitives and animated procedurally (no skinning needed); used when the
// downloaded character models are not available. Model space: +X forward, +Y up, +Z right; scaled to ~1.8 m.
const SCALE = 1.55;

const PALETTE = {
  blue: { cloth: '#4b5a45', vest: '#2a5d8f', helmet: '#24405e', ring: '#4aa3ff' },
  red: { cloth: '#6a5a44', vest: '#8f2c25', helmet: '#4a221d', ring: '#ff5347' },
};
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const materials = new Map();
function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra }));
  return materials.get(key);
}
const geometries = new Map();
function box(w, h, d) {
  const key = `${w},${h},${d}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
  return geometries.get(key);
}
const ARM = new THREE.BoxGeometry(0.085, 0.085, 1).translate(0, 0, 0.5);   // spans 0..1 along z, stretched per frame
const HEAD = new THREE.SphereGeometry(0.11, 10, 8);
const HELMET = new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const GUN_MATS = {
  metal: mat('#2b2d30', { metalness: 0.6, roughness: 0.45 }),
  poly: mat('#151617', { roughness: 0.7 }),
  wood: mat('#6b4426', { roughness: 0.8 }),
};

// [material, width, height, depth, x, y, z, rotZ]; `fore` is where the left hand holds the gun.
const GUNS = {
  ar: { muzzle: 0.44, fore: 0.22, parts: [['metal', 0.34, 0.07, 0.05, 0.1, 0, 0], ['metal', 0.16, 0.03, 0.03, 0.35, 0.005, 0], ['poly', 0.05, 0.12, 0.04, 0.12, -0.08, 0, 0.2], ['poly', 0.12, 0.06, 0.045, -0.12, -0.01, 0], ['metal', 0.06, 0.03, 0.03, 0.12, 0.05, 0]] },
  smg: { muzzle: 0.28, fore: 0.14, parts: [['metal', 0.24, 0.07, 0.05, 0.06, 0, 0], ['metal', 0.08, 0.03, 0.03, 0.22, 0.005, 0], ['poly', 0.04, 0.14, 0.035, 0.08, -0.09, 0], ['poly', 0.08, 0.05, 0.04, -0.1, -0.01, 0]] },
  shotgun: { muzzle: 0.42, fore: 0.24, parts: [['metal', 0.42, 0.035, 0.035, 0.2, 0.01, 0], ['metal', 0.3, 0.03, 0.03, 0.16, -0.035, 0], ['wood', 0.1, 0.05, 0.05, 0.24, -0.035, 0], ['wood', 0.16, 0.07, 0.05, -0.12, -0.01, 0]] },
  sniper: { muzzle: 0.56, fore: 0.22, parts: [['metal', 0.3, 0.07, 0.05, 0.08, 0, 0], ['metal', 0.34, 0.025, 0.025, 0.38, 0.005, 0], ['poly', 0.22, 0.05, 0.05, 0.08, 0.07, 0], ['poly', 0.18, 0.08, 0.05, -0.14, -0.01, 0], ['poly', 0.04, 0.07, 0.035, 0.12, -0.06, 0]] },
  lmg: { muzzle: 0.53, fore: 0.24, parts: [['metal', 0.36, 0.09, 0.06, 0.1, 0, 0], ['metal', 0.24, 0.035, 0.035, 0.4, 0.005, 0], ['poly', 0.1, 0.1, 0.08, 0.08, -0.09, 0], ['poly', 0.14, 0.07, 0.05, -0.13, -0.01, 0]] },
  pistol: { muzzle: 0.12, fore: 0.02, parts: [['metal', 0.16, 0.045, 0.035, 0.04, 0.02, 0], ['poly', 0.05, 0.08, 0.03, -0.01, -0.04, 0, 0.25]] },
};

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,235,1)');
  grd.addColorStop(0.3, 'rgba(255,205,110,.85)');
  grd.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? 12 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FLASH_MAT = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

function part(geometry, material, x, y, z, parent) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class Soldier {
  constructor(actor) {
    this.actor = actor;
    const pal = PALETTE[actor.team], cloth = mat(pal.cloth), skin = mat('#c99a72');
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.vestMat = new THREE.MeshStandardMaterial({ color: pal.vest, roughness: 0.7, flatShading: true });   // own copy: flashes red on hit

    this.legs = [-1, 1].map(side => {
      const hip = new THREE.Group();
      hip.position.set(0, 0.52, side * 0.095);
      part(box(0.13, 0.5, 0.13), cloth, 0, -0.25, 0, hip);
      part(box(0.19, 0.08, 0.14), mat('#1a1b1c'), 0.03, -0.48, 0, hip);
      this.body.add(hip);
      return hip;
    });
    part(box(0.2, 0.14, 0.3), cloth, 0, 0.56, 0, this.body);
    this.torso = new THREE.Group();   // pivots at the waist so the upper body can lean
    this.torso.position.y = 0.6;
    this.body.add(this.torso);
    part(box(0.24, 0.36, 0.38), cloth, 0, 0.18, 0, this.torso);
    part(box(0.29, 0.3, 0.41), this.vestMat, 0.01, 0.2, 0, this.torso);
    part(box(0.13, 0.27, 0.27), mat('#2b2f27'), -0.2, 0.22, 0, this.torso);
    part(HEAD, skin, 0.01, 0.46, 0, this.torso);
    part(HELMET, mat(pal.helmet), 0, 0.48, 0, this.torso);

    // arms are boxes stretched from the shoulder to wherever the hand needs to be
    this.arms = [new THREE.Vector3(0.02, 0.32, 0.2), new THREE.Vector3(0.02, 0.32, -0.2)].map(shoulder => {
      const g = new THREE.Group();
      g.position.copy(shoulder);
      part(ARM, cloth, 0, 0, 0, g);
      this.torso.add(g);
      return g;
    });
    this.hands = [0, 1].map(() => part(box(0.075, 0.075, 0.075), skin, 0, 0, 0, this.torso));
    this.knife = part(box(0.2, 0.02, 0.035), mat('#cfd4d8', { metalness: 0.8, roughness: 0.3 }), 0, 0, 0, this.torso);
    this.knife.visible = false;

    this.root.scale.setScalar(SCALE);
    this.guns = {};
    this.gun = null;
    this.gunId = null;
    this.phase = Math.random() * 6;
    this.walk = this.sprint = this.ads = this.recoil = this.flinch = this.throwT = 0;
    this.flinchDir = 1;
    this.deathT = -1;
    this.deathRoll = 0;
    this.right = new THREE.Vector3();
    this.left = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }

  gunFor(id) {
    if (!this.guns[id]) {
      const spec = GUNS[id] || GUNS.ar, g = new THREE.Group();
      for (const [m, w, h, d, x, y, z, rz = 0] of spec.parts) part(box(w, h, d), GUN_MATS[m], x, y, z, g).rotation.z = rz;
      const flash = new THREE.Sprite(FLASH_MAT);
      flash.position.set(spec.muzzle + 0.1, 0.01, 0);
      flash.visible = false;
      g.add(flash);
      g.userData = { spec, flash };
      this.torso.add(g);
      this.guns[id] = g;
    }
    return this.guns[id];
  }

  onShot() { this.recoil = Math.min(1.4, this.recoil + 1); }
  onHit() { this.flinch = 1; this.flinchDir = Math.random() < 0.5 ? -1 : 1; }
  onThrow() { this.throwT = 0.4; }
  onDeath() {
    if (!this.root.visible) { this.deathT = -1; this.update(0, 0, true); }   // your own body was never posed while hidden
    this.deathT = 0;
    this.deathRoll = rand(-0.35, 0.35);
  }
  onSpawn() {
    this.deathT = -1;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.recoil = this.flinch = this.throwT = 0;
  }

  // `visible` is false for your own body while you are alive (you see the first-person view instead).
  update(dt, time, visible = true) {
    const a = this.actor, id = a.wp[a.cur]?.id;
    if (id && id !== this.gunId) {
      if (this.gun) this.gun.visible = false;
      this.gun = this.gunFor(id);
      this.gun.visible = true;
      this.gunId = id;
    }
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.set(a.x, a.y, a.z);
    if (this.deathT >= 0) { this.animateDeath(dt); return; }
    this.root.rotation.y = a.yaw + Math.PI / 2;   // the model faces +X; yaw 0 faces -Z

    const k = Math.min(1, dt * 10);
    this.walk += ((a.moving ? 1 : 0) - this.walk) * k;
    this.sprint += ((a.sprinting ? 1 : 0) - this.sprint) * k;
    this.ads += ((a.ads ? 1 : 0) - this.ads) * k;
    this.phase += dt * (a.moving ? (a.sprinting ? 14 : a.ads ? 6 : 10) : 0);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.flinch = Math.max(0, this.flinch - dt * 5);
    this.throwT = Math.max(0, this.throwT - dt);

    // walk cycle; crouching bends the knees and lowers the body
    const swing = Math.sin(this.phase) * (0.5 + this.sprint * 0.25) * this.walk * (1 - a.crouchT * 0.5);
    this.legs[0].rotation.z = swing + a.crouchT * 0.9;
    this.legs[1].rotation.z = -swing - a.crouchT * 0.5;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.035 * this.walk - a.crouchT * 0.2;
    this.torso.rotation.z = -this.ads * 0.1 - this.sprint * 0.12 - a.crouchT * 0.2 + a.pitch * 0.45 + Math.sin(time * 2.1 + a.id) * 0.01;
    this.torso.rotation.y = this.flinch * 0.3 * this.flinchDir;
    this.vestMat.emissive.setRGB(this.flinch * 0.7, 0, 0);

    // weapon pose: recoil kick, aim-down-sights raise, reload tilt, lowered while sprinting or knifing
    const g = this.gun, spec = g.userData.spec;
    const reload = a.reloadT > 0 ? Math.sin((1 - a.reloadT / a.reloadMax) * Math.PI) : 0;
    const knife = a.knifeT > 0 ? a.knifeT / 0.22 : 0;
    const lower = Math.max(this.sprint, knife > 0 ? 1 : 0);
    g.position.set(0.15 - this.recoil * 0.07 + this.ads * 0.05, 0.25 + this.ads * 0.05 - reload * 0.1 - lower * 0.08, 0.11 - this.ads * 0.06);
    g.rotation.set(reload * 0.9, lower * 0.9, this.recoil * 0.12 - reload * 0.35 - lower * 0.45 + a.pitch * 0.55);
    const flash = g.userData.flash;
    flash.visible = a.flash > 0;
    if (flash.visible) {
      flash.scale.setScalar(0.35 + Math.random() * 0.25);
      flash.material.rotation = Math.random() * Math.PI * 2;
    }

    // hands: right on the grip, left on the foregrip unless it is busy
    g.updateMatrix();
    const right = this.right.set(0, -0.035, 0).applyMatrix4(g.matrix);
    const left = this.left.set(spec.fore, -0.03, 0).applyMatrix4(g.matrix);
    if (reload > 0) left.lerp(this.tmp.set(0.12, 0.08, 0.06), reload);                 // fetching a magazine
    if (this.throwT > 0) {
      const u = 1 - this.throwT / 0.4;
      left.set(-0.15 + u * 0.7, 0.55 - u * 0.25, -0.25);                              // overhand throw
    }
    this.knife.visible = knife > 0;
    if (knife > 0) {
      const u = 1 - knife;
      right.set(0.12 + u * 0.38, 0.3, 0.18 - u * 0.2);                                // stab forward
      this.knife.position.set(right.x + 0.1, right.y, right.z);
      this.knife.rotation.y = 0.3 - u * 0.6;
    }
    this.reach(0, right);
    this.reach(1, left);
  }

  reach(i, target) {
    const arm = this.arms[i], d = this.tmp.subVectors(target, arm.position), len = d.length() || 0.001;
    arm.quaternion.setFromUnitVectors(Z_AXIS, d.divideScalar(len));
    arm.scale.set(1, 1, len);
    this.hands[i].position.copy(target);
  }

  animateDeath(dt) {
    this.deathT += dt;
    const e = Math.min(1, this.deathT / 0.5) ** 2;
    this.body.rotation.set(this.deathRoll * e, 0, e * 1.45);   // topple backwards
    this.body.position.y = e * 0.12;
    this.legs[0].rotation.z = e * 0.3;
    this.legs[1].rotation.z = -e * 0.1;
    if (this.gun) this.gun.userData.flash.visible = false;
    if (this.actor.respawn < 0.8) this.body.position.y -= (0.8 - this.actor.respawn) * 0.6;   // sink away before respawning
  }

  // World position of the gun muzzle, for third-person tracers.
  muzzle(out) {
    if (!this.gun) return out.set(this.actor.x, this.actor.y + 1.35, this.actor.z);
    return out.set(this.gun.userData.spec.muzzle + 0.05, 0.01, 0).applyMatrix4(this.gun.matrixWorld);
  }

  dispose() {
    this.vestMat.dispose();
  }
}
