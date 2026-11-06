import * as THREE from 'three';
import { TAU, rand } from '@shared/util.js';

const BLOOD = [0.16, 0.01, 0.01];
const SCORCH = [0.06, 0.05, 0.04];
const HOLE = [0.05, 0.045, 0.04];
const TRACER_SPEED = 420;   // metres per second (shots are hitscan; tracers are only the visual)

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.12, d));
  }`;

// A fixed-size pool of point sprites simulated on the CPU (struct-of-arrays, no per-particle objects).
class Particles {
  constructor(max, additive) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.active = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, grow = 0, drag = 2, grav = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b, a], i * 4);
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.alpha[i] = a;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt) {
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      if ((this.life[i] -= dt) <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      active++;
      const p = i * 3, f = Math.exp(-this.drag[i] * dt);
      this.vel[p] *= f;
      this.vel[p + 1] = this.vel[p + 1] * f - this.grav[i] * dt;
      this.vel[p + 2] *= f;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      if (this.pos[p + 1] < 0.02) {   // bounce/settle on the floor
        this.pos[p + 1] = 0.02;
        this.vel[p + 1] *= -0.3;
        this.vel[p] *= 0.6;
        this.vel[p + 2] *= 0.6;
      }
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] = this.alpha[i] * (this.life[i] / this.maxLife[i]);
    }
    if (active || this.active) this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
    this.active = active;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
    this.aSize.needsUpdate = true;
  }
}

function splatTexture(holes) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (holes) {
    // bullet hole: dark centre with a soft scorched rim
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,.9)');
    grd.addColorStop(0.45, 'rgba(255,255,255,.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  } else {
    for (let i = 0; i < 7; i++) {
      const x = 32 + rand(-12, 12), y = 32 + rand(-12, 12), r = rand(10, 22), grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
  }
  return new THREE.CanvasTexture(c);
}

function buildJet() {
  const jet = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#5d646b', roughness: 0.5, metalness: 0.4, flatShading: true });
  for (const [w, h, d, x, y, z] of [[9, 1, 1.2, 0, 0, 0], [2.6, 0.2, 9, -0.4, 0, 0], [1.6, 0.2, 3.4, -4, 0.2, 0], [1.3, 1.7, 0.2, -4, 1, 0]]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    jet.add(mesh);
  }
  jet.visible = false;
  return jet;
}

// Surface-aligned decals in one InstancedMesh (ring buffer).
class Decals {
  constructor(scene, count, texture) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), count);
    this.mesh.frustumCulled = false;
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color(1, 1, 1);
    this.normal = new THREE.Vector3();
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, this.color);   // allocate instanceColor up front (no recompile later)
    this.clear();
    scene.add(this.mesh);
  }

  add(x, y, z, nx, ny, nz, size, [r, g, b]) {
    const d = this.dummy;
    d.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    d.lookAt(d.position.x + nx, d.position.y + ny, d.position.z + nz);   // plane faces +Z, so look along the normal
    d.rotateZ(rand(0, TAU));
    d.scale.set(size, size, 1);
    d.updateMatrix();
    const i = this.cursor;
    this.cursor = (i + 1) % this.mesh.count;
    this.mesh.setMatrixAt(i, d.matrix);
    this.mesh.setColorAt(i, this.color.setRGB(r, g, b));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.dummy.position.set(0, 0, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.glow = new Particles(1600, true);
    this.smoke = new Particles(1800, false);
    scene.add(this.glow.points, this.smoke.points);
    this.dummy = new THREE.Object3D();

    this.tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffd890', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 256);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    scene.add(this.tracerMesh);
    this.tracers = [];

    this.holes = new Decals(scene, 256, splatTexture(true));
    this.splats = new Decals(scene, 96, splatTexture(false));

    // fixed light pool: the light count never changes, so shaders never recompile mid-game
    this.lights = Array.from({ length: 4 }, () => {
      const light = new THREE.PointLight('#ffb35c', 0, 6, 2);
      scene.add(light);
      return { light, t: 0, max: 1, peak: 0 };
    });

    const waveGeo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
    this.waves = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: '#ffb066', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, t: 0, r: 1 };
    });

    this.nadeGeo = new THREE.SphereGeometry(0.05, 10, 8);
    this.nadeMat = new THREE.MeshStandardMaterial({ color: '#3a4728', roughness: 0.6 });
    this.dangerGeo = new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2);
    this.strikeGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
    this.nades = [];
    this.strikes = [];

    this.jet = buildJet();
    scene.add(this.jet);
    this.jetT = -1;
    this.tmp = new THREE.Vector3();
    this.reset();
  }

  setViewport(heightPx, fovDeg) {
    const scale = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.glow.material.uniforms.uScale.value = this.smoke.material.uniforms.uScale.value = scale;
  }

  reset() {
    this.glow.clear();
    this.smoke.clear();
    this.holes.clear();
    this.splats.clear();
    this.tracers.length = 0;
    this.tracerMesh.count = 0;
    for (const L of this.lights) { L.t = 0; L.light.intensity = 0; }
    for (const w of this.waves) w.mesh.visible = false;
    this.jet.visible = false;
    this.jetT = -1;
  }

  flash(x, y, z, color, intensity, distance, duration) {
    let L = this.lights[0];
    for (const l of this.lights) if (l.t < L.t) L = l;
    L.light.position.set(x, y, z);
    L.light.color.set(color);
    L.light.distance = distance;
    L.peak = intensity;
    L.t = L.max = duration;
  }

  // A shot: tracer from the muzzle, then whatever each pellet hit.
  shot(muzzle, ends, bright = true) {
    for (const e of ends) {
      const len = Math.hypot(e.x - muzzle.x, e.y - muzzle.y, e.z - muzzle.z);
      if (len > 1.5 && this.tracers.length < 256) this.tracers.push({ sx: muzzle.x, sy: muzzle.y, sz: muzzle.z, ex: e.x, ey: e.y, ez: e.z, len, t: 0 });
      if (e.kind === 'world') this.impact(e);
      else if (e.kind === 'body' || e.kind === 'head') this.blood(e, muzzle);
    }
    if (bright) this.flash(muzzle.x, muzzle.y, muzzle.z, '#ffc070', 3, 5, 0.06);
  }

  impact(e) {
    const { x, y, z, nx, ny, nz } = e;
    for (let i = 0; i < 5; i++) {
      const sp = rand(1.5, 5);
      this.glow.spawn(x, y, z, (nx + rand(-0.7, 0.7)) * sp, (ny + rand(-0.2, 0.9)) * sp, (nz + rand(-0.7, 0.7)) * sp, rand(0.08, 0.2), 0.025, 1, 0.85, 0.5, 1, 0, 2, 9.8);
    }
    for (let i = 0; i < 2; i++) this.smoke.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * rand(0.2, 0.8), rand(0.1, 0.4), nz * rand(0.2, 0.8), rand(0.4, 0.8), 0.12, 0.55, 0.53, 0.48, 0.5, 0.6, 2, -0.2);
    this.holes.add(x, y, z, nx, ny, nz, rand(0.07, 0.1), HOLE);
  }

  blood(e, from) {
    const dx = e.x - from.x, dy = e.y - from.y, dz = e.z - from.z, d = Math.hypot(dx, dy, dz) || 1, n = e.kind === 'head' ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const sp = rand(0.6, 2.4);
      this.smoke.spawn(e.x, e.y, e.z, (dx / d + rand(-0.5, 0.5)) * sp, (dy / d + rand(-0.2, 0.6)) * sp, (dz / d + rand(-0.5, 0.5)) * sp, rand(0.3, 0.6), rand(0.03, 0.07), 0.55, 0.03, 0.03, 1, 0, 1, 9.8);
    }
    if (Math.random() < 0.35) this.splats.add(e.x + (dx / d) * 0.6, 0, e.z + (dz / d) * 0.6, 0, 1, 0, rand(0.3, 0.6), BLOOD);
  }

  bodyFall(x, z) { this.splats.add(x, 0, z, 0, 1, 0, 1.2, BLOOD); }

  explosion(x, y, z, R) {
    for (let i = 0; i < 46; i++) {
      const an = rand(0, TAU), sp = rand(1, 7) * (R / 5);
      this.glow.spawn(x, y + 0.2, z, Math.cos(an) * sp, rand(1, 6), Math.sin(an) * sp, rand(0.25, 0.6), rand(0.5, 1.2), 1, rand(0.45, 0.8), 0.2, 1, 1.4, 3, 2);
    }
    for (let i = 0; i < 20; i++)
      this.smoke.spawn(x + rand(-0.8, 0.8), y + rand(0.2, 1), z + rand(-0.8, 0.8), rand(-1, 1), rand(0.5, 1.8), rand(-1, 1), rand(1.5, 2.8), rand(1.2, 2), 0.17, 0.16, 0.14, 0.75, 1.6, 1.5, -0.3);
    for (let i = 0; i < 16; i++) {
      const an = rand(0, TAU), sp = rand(2, 7);
      this.smoke.spawn(x, y + 0.3, z, Math.cos(an) * sp, rand(2, 6), Math.sin(an) * sp, rand(0.6, 1.2), 0.06, 0.12, 0.1, 0.08, 1, 0, 0.5, 9.8);
    }
    this.flash(x, y + 1.2, z, '#ffa64d', 80, R * 3, 0.35);
    const wave = this.waves.find(w => !w.mesh.visible) || this.waves[0];
    Object.assign(wave, { t: 0, r: R });
    wave.mesh.position.set(x, 0.05, z);
    wave.mesh.visible = true;
    this.splats.add(x, 0, z, 0, 1, 0, R * 0.8, SCORCH);
  }

  land(x, z) {
    for (let i = 0; i < 28; i++) {
      const an = rand(0, TAU), sp = rand(1.5, 4);
      this.smoke.spawn(x, 0.2, z, Math.cos(an) * sp, rand(0.2, 0.9), Math.sin(an) * sp, rand(0.7, 1.4), rand(0.4, 0.8), 0.62, 0.56, 0.46, 0.6, 1.2, 3, 0);
    }
  }

  signalSmoke(x, z, dt) {
    if (Math.random() < dt * 16)
      this.smoke.spawn(x + 0.4, 0.4, z - 0.4, rand(-0.2, 0.2), rand(1, 1.8), rand(-0.4, -0.1), rand(2, 3.5), rand(0.4, 0.7), 1, 0.48, 0.12, 0.65, 1.1, 0.6, 0);
  }

  flyover(lane, mapW) {
    this.jetT = 0;
    this.jetZ = lane;
    this.jetW = mapW;
    this.jet.visible = true;
  }

  update(dt, M, viewer) {
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const L of this.lights) {
      if (L.t > 0) L.t -= dt;
      L.light.intensity = L.t > 0 ? L.peak * (L.t / L.max) : 0;
    }
    for (const w of this.waves) {
      if (!w.mesh.visible) continue;
      w.t += dt;
      const f = w.t / 0.4;
      if (f >= 1) { w.mesh.visible = false; continue; }
      w.mesh.scale.setScalar(0.2 + w.r * f);
      w.mesh.material.opacity = 1 - f;
    }
    if (this.jetT >= 0) {
      this.jetT += dt;
      const f = this.jetT / 2.6;
      if (f > 1) { this.jet.visible = false; this.jetT = -1; }
      else {
        this.jet.position.set(-30 + (this.jetW + 60) * f, 32, this.jetZ);
        this.smoke.spawn(this.jet.position.x - 5, 32, this.jetZ, 0, 0, 0, 1.5, 1.4, 0.85, 0.85, 0.85, 0.4, 1, 1, 0);
      }
    }

    // tracers: a bright streak racing from muzzle to impact
    const d = this.dummy;
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      const head = Math.min(t.len, t.t * TRACER_SPEED), tail = Math.max(0, head - Math.min(5, t.len * 0.5));
      if (tail >= t.len - 0.01) { this.tracers.splice(i, 1); continue; }
      const k0 = tail / t.len, k1 = head / t.len, dx = t.ex - t.sx, dy = t.ey - t.sy, dz = t.ez - t.sz;
      d.position.set(t.sx + dx * (k0 + k1) * 0.5, t.sy + dy * (k0 + k1) * 0.5, t.sz + dz * (k0 + k1) * 0.5);
      d.lookAt(t.ex, t.ey, t.ez);
      d.scale.set(0.012, 0.012, Math.max(0.05, head - tail));
      d.updateMatrix();
      this.tracerMesh.setMatrixAt(n++, d.matrix);
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (!M) return;

    // grenades in flight, with a danger ring when an enemy frag lands near you
    while (this.nades.length < M.nades.length) {
      const mesh = new THREE.Mesh(this.nadeGeo, this.nadeMat);
      const ring = new THREE.Mesh(this.dangerGeo, new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, depthWrite: false, toneMapped: false }));
      mesh.castShadow = true;
      this.scene.add(mesh, ring);
      this.nades.push({ mesh, ring });
    }
    this.nades.forEach((v, i) => {
      const g = M.nades[i];
      v.mesh.visible = !!g;
      v.ring.visible = !!g && viewer && g.team !== viewer.team && Math.hypot(g.x - viewer.x, g.z - viewer.z) < 12;
      if (!g) return;
      v.mesh.position.set(g.x, g.y, g.z);
      v.mesh.rotation.x += dt * 8;
      v.ring.position.set(g.x, 0.04, g.z);
      v.ring.scale.setScalar(6);
      v.ring.material.opacity = 0.45 + 0.35 * Math.sin(M.time * 20);
    });

    // airstrike target markers
    while (this.strikes.length < M.strikes.length) {
      const ring = new THREE.Mesh(this.strikeGeo, new THREE.MeshBasicMaterial({ color: '#ff3227', transparent: true, depthWrite: false, toneMapped: false }));
      this.scene.add(ring);
      this.strikes.push(ring);
    }
    this.strikes.forEach((ring, i) => {
      const s = M.strikes[i];
      ring.visible = !!s;
      if (!s) return;
      ring.position.set(s.x, 0.05, s.z);
      ring.scale.setScalar(7 * Math.min(1, s.t / 2) * (1 + 0.1 * Math.sin(M.time * 14)));
      ring.material.opacity = 0.85;
      if (Math.random() < dt * 20) this.smoke.spawn(s.x, 0.3, s.z, rand(-0.3, 0.3), rand(2, 3), rand(-0.3, 0.3), 1.5, 0.35, 1, 0.15, 0.1, 0.6, 0.8, 0.5, 0);
    });
  }
}
