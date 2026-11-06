import * as THREE from 'three';
import { MATS, buildGun } from './guns.js';

// First-person gun and arms. Camera space: -Z forward, +Y up, +X right. Gun space: the grip is the origin
// and the barrel points down -Z. Everything is built from primitives and animated procedurally.

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ARM = new THREE.CylinderGeometry(0.032, 0.04, 1, 10).rotateX(Math.PI / 2).translate(0, 0, -0.5);   // 0..-1 along Z
const HAND = new THREE.BoxGeometry(0.06, 0.07, 0.1);
const Z_NEG = new THREE.Vector3(0, 0, -1);

const HIP = { pos: new THREE.Vector3(0.19, -0.2, -0.56), rot: new THREE.Euler(0, 0.04, 0) };
const SPRINT = { pos: new THREE.Vector3(0.12, -0.26, -0.42), rot: new THREE.Euler(-0.35, 0.75, 0.35) };
const ELBOWS = [new THREE.Vector3(0.3, -0.52, -0.2), new THREE.Vector3(-0.06, -0.55, -0.42)];   // just below the screen edge

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,235,1)');
  grd.addColorStop(0.3, 'rgba(255,205,110,.85)');
  grd.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r = i % 2 ? 11 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Viewmodel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#3a3530', 1.3);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.2);
    this.sun.position.set(0.6, 1, 0.4);
    this.scene.add(this.hemi, this.sun);
    this.rig = new THREE.Group();    // moved around by pose, sway, bob and recoil
    this.scene.add(this.rig);
    this.guns = {};
    this.gun = null;
    this.gunId = null;
    this.sleeve = mat('#2a5d8f', { roughness: 0.85 });
    this.arms = [0, 1].map(() => {
      const arm = new THREE.Mesh(ARM, this.sleeve), hand = new THREE.Mesh(HAND, MATS.glove);
      this.rig.add(arm, hand);
      return { arm, hand };
    });
    this.knife = new THREE.Mesh(box(0.018, 0.035, 0.24), mat('#cfd4d8', { metalness: 0.85, roughness: 0.25 }));
    this.knife.visible = false;
    this.rig.add(this.knife);
    this.nade = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), mat('#3a4728'));
    this.nade.visible = false;
    this.rig.add(this.nade);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight('#ffc070', 0, 2, 2);
    this.scene.add(this.flashLight);

    this.ads = 0;
    this.sprint = 0;
    this.kick = 0;
    this.kickSide = 0;
    this.bob = 0;
    this.move = 0;
    this.sway = new THREE.Vector2();
    this.throwT = 0;
    this.pos = new THREE.Vector3();
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
    this.tmpC = new THREE.Vector3();
    this.tmpD = new THREE.Vector3();
    this.tmpElbow = new THREE.Vector3();
  }

  setTeam(team) { this.sleeve.color.set(team === 'blue' ? '#2a5d8f' : '#8f2c25'); }

  setLight(sky, ground, sun) {
    this.hemi.color.set(sky);
    this.hemi.groundColor.set(ground);
    this.sun.color.set(sun);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  gunFor(id, optic) {
    const key = `${id}:${optic}`;
    if (!this.guns[key]) {
      const { group: g, spec, mag, sight } = buildGun(id, false, optic);
      g.userData = { spec, mag, sight, magHome: mag ? mag.position.clone() : null };
      g.visible = false;
      this.rig.add(g);
      this.guns[key] = g;
    }
    return this.guns[key];
  }

  onShot() {
    this.kick = Math.min(1.6, this.kick + 1);
    this.kickSide = (Math.random() - 0.5) * 2;
  }

  onThrow() { this.throwT = 0.45; }

  /** s: { wid, optic, magnified, ads, sprinting, speed, onGround, reload (0..1 or -1), swap (0..1), knife (0..1), flash, lookX, lookY, scoped, dead } */
  update(dt, s, time) {
    const key = `${s.wid}:${s.optic}`;
    if (key !== this.gunId) {
      if (this.gun) this.gun.visible = false;
      this.gun = this.gunFor(s.wid, s.optic);
      this.gun.visible = true;
      this.gunId = key;
    }
    const spec = this.gun.userData.spec;
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt * (s.magnified ? 7 : 12));   // scopes take longer to raise
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.move += (Math.min(1, s.speed / 5) * (s.onGround ? 1 : 0) - this.move) * Math.min(1, dt * 8);
    this.bob += dt * (6 + s.speed * 1.4);
    this.kick *= Math.exp(-dt * 14);
    this.throwT = Math.max(0, this.throwT - dt);
    // weapon sway lags behind mouse movement
    this.sway.x += (Math.max(-1, Math.min(1, -s.lookX * 0.02)) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (Math.max(-1, Math.min(1, s.lookY * 0.02)) - this.sway.y) * Math.min(1, dt * 10);

    // base pose: hip -> aim down sights -> sprint
    const ads = this.ads * (1 - this.sprint);
    this.pos.set(0, -this.gun.userData.sight, -0.3).lerp(HIP.pos, 1 - ads);
    this.pos.lerp(SPRINT.pos, this.sprint);
    const bobK = this.move * (1 - ads * 0.8);
    this.pos.x += Math.sin(this.bob) * 0.012 * bobK + this.sway.x * 0.02 * (1 - ads * 0.7);
    this.pos.y += -Math.abs(Math.cos(this.bob)) * 0.012 * bobK + this.sway.y * 0.015 * (1 - ads * 0.7) + Math.sin(time * 1.8) * 0.002;
    this.pos.z += this.kick * 0.045 * (1 - ads * 0.5);
    let rx = HIP.rot.x * (1 - ads) + SPRINT.rot.x * this.sprint + this.kick * 0.07 * (1 - ads * 0.6);
    let ry = HIP.rot.y * (1 - ads) + SPRINT.rot.y * this.sprint + this.sway.x * 0.05 + this.kickSide * this.kick * 0.01;
    let rz = SPRINT.rot.z * this.sprint;

    // reload: tilt the gun, drop the magazine and bring a fresh one up
    const mag = this.gun.userData.mag;
    if (s.reload >= 0) {
      const dip = Math.sin(s.reload * Math.PI);
      rz += dip * 0.55;
      rx += dip * 0.25;
      this.pos.y -= dip * 0.06;
      if (mag) {
        const out = s.reload < 0.25 ? 0 : s.reload < 0.5 ? (s.reload - 0.25) / 0.25 : s.reload < 0.75 ? 1 - (s.reload - 0.5) / 0.25 : 0;
        mag.position.copy(this.gun.userData.magHome);
        mag.position.y -= out * 0.25;
      }
    } else if (mag) mag.position.copy(this.gun.userData.magHome);
    // switching weapons: lowered out of view, then raised
    this.pos.y -= s.swap * 0.3;
    rx -= s.swap * 0.7;
    // knife or grenade: the gun drops away while the other hand works
    const busy = Math.max(s.knife > 0 ? 1 : 0, this.throwT > 0 ? 1 : 0);
    this.pos.y -= busy * 0.12;
    rx -= busy * 0.5;

    this.gun.position.copy(this.pos);
    this.gun.rotation.set(rx, ry, rz);
    this.gun.updateMatrix();

    // hands: right on the grip, left on the foregrip (or the magazine, knife, grenade)
    const right = this.tmpA.set(0, -0.055, 0.025).applyMatrix4(this.gun.matrix);
    const left = this.tmpB.set(0, -0.025, spec.fore).applyMatrix4(this.gun.matrix);
    if (s.reload >= 0 && mag) left.lerp(this.tmpC.copy(mag.position).applyMatrix4(this.gun.matrix), Math.sin(s.reload * Math.PI));
    this.knife.visible = s.knife > 0;
    if (s.knife > 0) {
      const u = 1 - s.knife, thrust = Math.sin(u * Math.PI);
      right.set(0.14 - thrust * 0.08, -0.15 + thrust * 0.05, -0.3 - thrust * 0.32);
      this.knife.position.set(right.x, right.y + 0.02, right.z - 0.14);
      this.knife.rotation.set(0.1, 0.2 - thrust * 0.2, 0);
    }
    this.nade.visible = this.throwT > 0;
    if (this.throwT > 0) {
      const u = 1 - this.throwT / 0.45;
      left.set(-0.18 + u * 0.12, -0.14 + Math.sin(u * Math.PI) * 0.2, -0.3 - u * 0.25);
      this.nade.position.set(left.x, left.y + 0.04, left.z - 0.04);
    }
    this.reach(this.arms[0], right, ELBOWS[0]);
    this.reach(this.arms[1], left, ELBOWS[1]);

    // muzzle flash
    const flash = this.flash;
    if (flash.parent !== this.gun) this.gun.add(flash);
    flash.position.set(0, 0.03, spec.muzzle - 0.06);
    flash.visible = s.flash > 0 && !s.scoped;
    if (flash.visible) {
      flash.scale.setScalar(0.14 + Math.random() * 0.1);
      flash.material.rotation = Math.random() * Math.PI * 2;
    }
    this.flashLight.intensity = s.flash > 0 ? 1.5 : 0;
    this.flashLight.position.set(this.pos.x, this.pos.y + 0.05, this.pos.z + spec.muzzle);
    this.rig.visible = !s.scoped && !s.dead;
  }

  // Where the muzzle appears on screen, as a world point 0.8 m in front of the main camera (for tracers).
  // The viewmodel has its own field of view, so go through screen space rather than camera space.
  muzzleWorld(camera, out) {
    if (!this.gun) return out.copy(camera.position);
    camera.updateMatrixWorld();
    out.set(0, 0.03, this.gun.userData.spec.muzzle).applyMatrix4(this.gun.matrix).applyMatrix4(this.camera.projectionMatrix);
    out.z = 0.5;
    out.unproject(camera).sub(camera.position).normalize().multiplyScalar(0.8);
    return out.add(camera.position);
  }

  // forearm from an elbow (off the bottom of the screen) to the hand
  reach({ arm, hand }, target, base) {
    const elbow = this.tmpElbow.set(base.x + (this.pos.x - HIP.pos.x) * 0.5, base.y + (this.pos.y - HIP.pos.y) * 0.6, base.z + (this.pos.z - HIP.pos.z) * 0.3);
    const d = this.tmpD.subVectors(elbow, target), len = d.length() || 0.001;
    arm.position.copy(target);   // the arm mesh runs from the hand back along its -Z to the elbow
    arm.quaternion.setFromUnitVectors(Z_NEG, d.divideScalar(len));
    arm.scale.set(1, 1, len);
    hand.position.copy(target);
    hand.quaternion.copy(this.gun.quaternion);
  }
}
