import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TILE, BODY } from '@shared/constants.js';
import { World, raySphere, rayCylinder } from '@shared/world.js';
import { eyeHeight } from '@shared/movement.js';
import { forward, lerp, rand } from '@shared/util.js';
import { Assets } from './assets.js';
import { MapView } from './mapView.js';
import { Soldier } from './soldier.js';
import { Character } from './character.js';
import { Fx } from './fx.js';
import { Viewmodel } from './viewmodel.js';

const SHADOW_SPAN = 40;   // half-size (m) of the shadow-casting area kept around the camera

function skyDome() {
  return new THREE.Mesh(new THREE.SphereGeometry(450, 32, 15), new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
      void main() { gl_FragColor = vec4(mix(horizon, top, pow(clamp(vDir.y, 0.0, 1.0), 0.55)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }));
}

export class GameView {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;   // the viewmodel is drawn in a second pass over the world

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow, { bias: -0.0003, normalBias: 0.04 });
    Object.assign(this.sun.shadow.camera, { left: -SHADOW_SPAN, right: SHADOW_SPAN, top: SHADOW_SPAN, bottom: -SHADOW_SPAN, near: 1, far: 160 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sky = skyDome();
    this.scene.add(this.hemi, this.sun, this.sun.target, this.sky);
    this.scene.fog = new THREE.Fog('#888888', 40, 190);

    this.assets = new Assets(r);
    this.mapView = new MapView(this.scene, this.assets);
    this.fx = new Fx(this.scene);
    this.vm = new Viewmodel();
    this.vm.scene.environment = this.scene.environment;   // metal needs something to reflect
    this.vm.scene.environmentIntensity = 0.7;
    this.soldiers = new Map();
    this.pickups = new Map();
    this.pickupRing = new THREE.RingGeometry(0.55, 0.65, 40).rotateX(-Math.PI / 2);
    this.chute = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#ff8a1f', side: THREE.DoubleSide, flatShading: true }));

    this.M = null;
    this.me = null;
    this.killer = null;
    this.world = null;
    this.mapSlug = null;
    this.baseFov = 78;
    this.fov = 78;
    this.shake = 0;
    this.orbit = 0;
    this.deathView = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this.lookM = new THREE.Matrix4();
    this.lookQ = new THREE.Quaternion();
    this.frameNo = 0;
    this.setQuality(true);
  }

  setQuality(high) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 1.5 : 1));
    this.sun.shadow.mapSize.setScalar(high ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.W = w;
    this.H = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.resize(w / h);
    this.fx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  async loadMap(mapDef) {
    if (this.mapSlug === mapDef.slug) {
      this.mapView.token++;   // cancel a build of some other map that is still loading
      return;
    }
    const world = new World(mapDef), th = mapDef.theme;
    if (!(await this.mapView.build(world, th))) return;   // superseded by a newer request
    this.world = world;
    this.mapSlug = mapDef.slug;
    this.scene.fog.color.set(th.fog);
    this.scene.background = new THREE.Color(th.fog);
    this.sky.material.uniforms.top.value.set(th.skyTop);
    this.sky.material.uniforms.horizon.value.set(th.skyHorizon);
    this.hemi.color.set(th.hemiSky);
    this.hemi.groundColor.set(th.hemiGround);
    this.hemi.intensity = th.hemiIntensity;
    this.sun.color.set(th.sun);
    this.sun.intensity = th.sunIntensity;
    this.vm.setLight(th.hemiSky, th.hemiGround, th.sun);
  }

  attach(M, me) {
    this.detach();
    this.M = M;
    this.me = me;
    this.vm.setTeam(me.team);
  }

  detach() {
    for (const s of this.soldiers.values()) { this.scene.remove(s.root); s.dispose(); }
    this.soldiers.clear();
    for (const v of this.pickups.values()) this.removePickup(v);
    this.pickups.clear();
    this.fx.reset();
    this.M = null;
    this.me = null;
    this.killer = null;
  }

  soldier(a) {
    let s = this.soldiers.get(a.id);
    if (!s) {
      s = this.assets.characters ? new Character(a, this.assets.characters) : new Soldier(a);
      this.scene.add(s.root);
      this.soldiers.set(a.id, s);
    }
    return s;
  }

  // World position of the muzzle for a shot's tracer: the viewmodel for you, the third-person gun for others.
  muzzle(a, out) {
    if (a === this.me && !a.dead) return this.vm.muzzleWorld(this.camera, out);
    return this.soldier(a).muzzle(out);
  }

  onEvent(e) {
    const M = this.M, me = this.me;
    switch (e.type) {
      case 'shot': {
        const mine = e.a === me;
        if (!mine) this.soldier(e.a).onShot();
        else this.vm.onShot();
        this.fx.shot(this.muzzle(e.a, this.tmp), e.ends);
        break;
      }
      case 'hit':
        if (e.v !== me) this.soldier(e.v).onHit();
        else this.shake = Math.min(1, this.shake + 0.25);
        break;
      case 'kill':
        this.soldier(e.v).onDeath();
        this.fx.bodyFall(e.v.x, e.v.z);
        if (e.v === me) {
          this.killer = e.att;
          this.deathView.set(me.x, eyeHeight(me), me.z);
        }
        break;
      case 'spawn': this.soldier(e.a).onSpawn(); if (e.a === me) this.killer = null; break;
      case 'leave': {
        const s = this.soldiers.get(e.id);
        if (s) { this.scene.remove(s.root); s.dispose(); this.soldiers.delete(e.id); }
        break;
      }
      case 'throw': if (e.a === me) this.vm.onThrow(); else this.soldier(e.a).onThrow(); break;
      case 'explode': {
        this.fx.explosion(e.x, e.y, e.z, e.R);
        const d = Math.hypot(me.x - e.x, me.z - e.z);
        this.shake = Math.min(1.5, this.shake + 1.2 * Math.max(0, 1 - d / 25));
        break;
      }
      case 'land': this.fx.land(e.x, e.z); break;
      case 'streak': if (e.id === 'air') this.fx.flyover(e.lane, this.world.w * TILE); break;
    }
  }

  // Screen position of a world point, for the HUD (behind = not in front of the camera).
  project(x, y, z) {
    const v = this.projected.set(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.W, y: ((1 - v.y) / 2) * this.H, behind: v.z > 1 };
  }

  // The enemy under the crosshair (for showing their name), or null.
  aimedAt() {
    const M = this.M, me = this.me;
    if (!M || me.dead) return null;
    const ox = this.camera.position.x, oy = this.camera.position.y, oz = this.camera.position.z;
    const d = this.camera.getWorldDirection(this.tmp2), wall = this.world.raycast(ox, oy, oz, d.x, d.y, d.z, 120);
    let best = wall ? wall.t : 120, who = null;
    for (const a of M.actors) {
      if (a === me || a.dead) continue;
      const eye = eyeHeight(a);
      const t = Math.min(raySphere(ox, oy, oz, d.x, d.y, d.z, a.x, eye, a.z, BODY.headR * 1.5), rayCylinder(ox, oy, oz, d.x, d.y, d.z, a.x, a.z, BODY.bodyR * 1.3, a.y, eye));
      if (t < best) { best = t; who = a; }
    }
    return who;
  }

  /** view: { yaw, pitch, lookX, lookY } from the input (smoother than the tick-rate actor state). */
  update(dt, view, time) {
    const M = this.M, me = this.me, cam = this.camera;
    if (M && me) {
      // drop soldiers whose player left (online, a "leave" event can predate when you joined)
      if (this.soldiers.size > M.actors.length)
        for (const [id, s] of this.soldiers) if (!M.actors.some(a => a.id === id)) { this.scene.remove(s.root); s.dispose(); this.soldiers.delete(id); }
      for (const a of M.actors) this.soldier(a).update(dt, time, a !== me || a.dead);
      this.syncPickups(M, dt, time);
      const w = M.weapons[me.wp[me.cur]?.id || 'ar'];
      if (!me.dead) {
        cam.position.set(me.x, eyeHeight(me) + (me.moving && me.onGround ? Math.sin(time * 11) * 0.015 : 0), me.z);
        cam.rotation.set(view.pitch, view.yaw, 0);
      } else {
        // death cam: rise above where you fell and watch your killer
        const focus = this.killer && !this.killer.dead ? this.killer : me;
        this.tmp.set(this.deathView.x, this.deathView.y + 2.2, this.deathView.z);
        cam.position.lerp(this.tmp, Math.min(1, dt * 3));
        this.tmp.set(focus.x, eyeHeight(focus) - 0.3, focus.z);
        this.lookM.lookAt(cam.position, this.tmp, THREE.Object3D.DEFAULT_UP);
        cam.quaternion.slerp(this.lookQ.setFromRotationMatrix(this.lookM), Math.min(1, dt * 4));
      }
      const opticId = me.optics?.[me.cur] || 'iron', optic = M.data.optics?.[opticId] || { zoom: null, scope: false, reticle: 'iron' };
      const scoped = !me.dead && me.ads && optic.scope && this.vm.ads > 0.85;
      const targetFov = this.baseFov * (me.ads && !me.dead ? optic.zoom ?? w.adsZoom : 1) * (me.sprinting ? 1.06 : 1);
      this.fov = lerp(this.fov, targetFov, Math.min(1, dt * (optic.scope ? 9 : 14)));
      this.vm.update(dt, {
        wid: me.wp[me.cur]?.id || 'ar', optic: opticId, magnified: optic.scope, ads: me.ads, sprinting: me.sprinting, speed: Math.hypot(me.vx, me.vz), onGround: me.onGround,
        reload: me.reloadT > 0 ? 1 - me.reloadT / me.reloadMax : -1, swap: Math.max(0, me.swapT / 0.35), knife: me.knifeT > 0 ? me.knifeT / 0.22 : 0,
        flash: me.flash, lookX: view.lookX, lookY: view.lookY, scoped, dead: me.dead,
      }, time);
      this.scoped = scoped;
      this.reticle = optic.reticle;
      this.fx.update(dt, M, me);
    } else if (this.world) {
      // menu backdrop: a slow fly-around above the map
      const W = this.world.w * TILE, D = this.world.h * TILE;
      this.orbit += dt * 0.05;
      cam.position.set(W / 2 + Math.cos(this.orbit) * W * 0.45, 22, D / 2 + Math.sin(this.orbit) * D * 0.45);
      cam.lookAt(W / 2, 0, D / 2);
      this.fov = this.baseFov;
      this.fx.update(dt, null, null);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    // screen shake from explosions and taking hits
    this.shake *= Math.exp(-6 * dt);
    if (this.shake > 0.01) { cam.rotation.x += rand(-1, 1) * this.shake * 0.02; cam.rotation.y += rand(-1, 1) * this.shake * 0.02; }
    this.sky.position.copy(cam.position);
    // keep the sun's shadow box centred on the camera, snapped to texels so shadows do not shimmer
    const texel = (SHADOW_SPAN * 2) / this.sun.shadow.mapSize.x;
    const cx = Math.round(cam.position.x / texel) * texel, cz = Math.round(cam.position.z / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 30, 60, cz + 22);
  }

  render() {
    const r = this.renderer;
    // Most shadow casters never move, so redrawing the shadow map at half rate is invisible but halves its cost.
    r.shadowMap.needsUpdate = this.frameNo++ % 2 === 0;
    r.shadowMap.autoUpdate = false;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.M && this.me && !this.me.dead) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }

  makePickup(k) {
    const care = k.kind === 'care', key = care ? 'crate' : 'ammo', model = this.assets.models[key];
    const root = new THREE.Group(), obj = this.assets.instance(key);
    obj.scale.setScalar((care ? 1.4 : k.drop ? 0.45 : 0.6) / Math.max(model.size.x, model.size.z));
    root.add(obj);
    const view = { root, obj, ring: null, chute: null };
    if (care) {
      view.chute = this.chute.clone();
      view.chute.position.y = 2.6;
      root.add(view.chute);
    } else if (!k.drop) {
      view.ring = new THREE.Mesh(this.pickupRing, new THREE.MeshBasicMaterial({ color: '#c9e08a', transparent: true, depthWrite: false, toneMapped: false }));
      view.ring.position.y = 0.03;
      root.add(view.ring);
    }
    this.scene.add(root);
    return view;
  }

  removePickup(v) {
    this.scene.remove(v.root);
    v.ring?.material.dispose();
  }

  syncPickups(M, dt, time) {
    const live = new Set();
    for (const k of M.pickups) {
      live.add(k.id);
      let v = this.pickups.get(k.id);
      if (!v) this.pickups.set(k.id, (v = this.makePickup(k)));
      if (k.kind === 'care') {
        const f = Math.max(0, k.land) / 2.2;
        v.root.position.set(k.x, f * 22, k.z);
        v.chute.visible = f > 0;
        if (f === 0) this.fx.signalSmoke(k.x, k.z, dt);
      } else {
        v.root.position.set(k.x, 0, k.z);
        v.obj.position.y = 0.15 + Math.sin(time * 3 + k.id) * 0.05;
        v.obj.rotation.y = time * 0.8 + k.id;
        v.obj.visible = k.cd <= 0 && (!k.drop || k.life > 3 || Math.sin(time * 20) > 0);
        if (v.ring) v.ring.material.opacity = k.cd > 0 ? 0.08 : 0.35 + 0.2 * Math.sin(time * 4);
      }
    }
    for (const [id, v] of this.pickups) if (!live.has(id)) { this.removePickup(v); this.pickups.delete(id); }
  }
}
