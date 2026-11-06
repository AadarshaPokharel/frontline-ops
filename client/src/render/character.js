import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { angDiff, clamp, lerp, rand, yawTo } from '@shared/util.js';
import { buildGun } from './guns.js';

// Human soldiers from the CC0 Quaternius Universal Base Characters, animated with the Universal Animation
// Library (same skeleton). The free bodies are unclothed, so each vertex is classed by the bone that moves it
// (head/neck/hands = skin, feet = boots, the rest = uniform) and a shader paints a team camo uniform.

const HEIGHT = 1.78;   // metres
const UPPER = /^(spine_0[23]|neck|Head|clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/;
const SKIN = /^(neck|Head|hand|index|middle|ring|pinky|thumb)/;
const BOOTS = /^(foot|ball)/;
const TEAM = {
  blue: { camoA: '#4b5a3d', camoB: '#333f2b', vest: '#2a5d8f', helmet: '#2f402c' },
  red: { camoA: '#7c6b4f', camoB: '#5a4c37', vest: '#8f2c25', helmet: '#4f3e2b' },
};
const LOWER = { idle: 'Idle_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', crouch: 'Crouch_Idle_Loop', crouchWalk: 'Crouch_Fwd_Loop', jump: 'Jump_Loop' };
const ARMS = { aim: 'Pistol_Aim_Neutral', up: 'Pistol_Aim_Up', down: 'Pistol_Aim_Down', run: 'Sprint_Loop', reload: 'Pistol_Reload', shoot: 'Pistol_Shoot', hit: 'Hit_Chest', knife: 'Punch_Cross', throw: 'Punch_Jab' };
const SCRUBBED = new Set(['reload', 'shoot', 'hit', 'knife', 'throw']);   // driven by game timers, not by the clock
const STRIDE = { walk: 1.5, jog: 4.2, sprint: 6.8, crouchWalk: 1.4 };       // metres per second at playback rate 1

const boneOf = (skel, attr, i) => {
  let best = 0, k = 0;
  const w = [attr.w.getX(i), attr.w.getY(i), attr.w.getZ(i), attr.w.getW(i)];
  for (let c = 1; c < 4; c++) if (w[c] > w[best]) best = c;
  k = [attr.j.getX(i), attr.j.getY(i), attr.j.getZ(i), attr.j.getW(i)][best];
  return skel.bones[k]?.name || '';
};

function filterClip(clip, keep) {
  return new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter(t => keep(t.name.split('.')[0])));
}

// Local transform that puts `obj` at a world pose relative to `bone` (computed once, in the template's pose).
function localTo(bone, pos, quat, scale) {
  bone.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(scale, scale, scale)).premultiply(bone.matrixWorld.clone().invert());
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
}

function uniformMaterial(base, team, camoScale) {
  const m = base.clone(), T = TEAM[team];
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uCamoA: { value: new THREE.Color(T.camoA) }, uCamoB: { value: new THREE.Color(T.camoB) },
      uBoot: { value: new THREE.Color('#1b1a18') }, uCamoScale: { value: camoScale },
    });
    shader.vertexShader = 'attribute float aCloth;\nvarying float vCloth;\nvarying vec3 vBind;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = aCloth;\nvBind = position;');
    shader.fragmentShader = 'uniform vec3 uCamoA;\nuniform vec3 uCamoB;\nuniform vec3 uBoot;\nuniform float uCamoScale;\nvarying float vCloth;\nvarying vec3 vBind;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        if (vCloth > 0.5) {
          float n = fract(sin(dot(floor(vBind * uCamoScale), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          diffuseColor.rgb = vCloth > 1.5 ? uBoot : mix(uCamoA, uCamoB, step(0.55, n));   // blocky digital camo
        }`);
  };
  m.customProgramCacheKey = () => `uniform-${team}`;
  return m;
}

/** Everything shared by all characters: prepared bodies, split animation clips, team materials. */
export class CharacterKit {
  constructor(bodyGltfs, animGltf) {
    const clips = new Map(animGltf.animations.map(c => [c.name, c]));
    for (const name of [...Object.values(LOWER), ...Object.values(ARMS), 'Death01']) if (!clips.has(name)) throw new Error(`missing clip ${name}`);
    this.lower = new Map([...clips].map(([n, c]) => [n, filterClip(c, b => !UPPER.test(b))]));
    this.upper = new Map([...clips].map(([n, c]) => [n, filterClip(c, b => UPPER.test(b))]));
    this.full = clips;
    this.helmetGeo = new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.9, 1.1);
    this.vestGeo = new THREE.BoxGeometry(0.4, 0.42, 0.3);
    const flat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true });
    this.helmetMat = { blue: flat(TEAM.blue.helmet), red: flat(TEAM.red.helmet) };
    this.vestMat = { blue: flat(TEAM.blue.vest), red: flat(TEAM.red.vest) };
    this.bodies = bodyGltfs.map(g => this.prepare(g, clips.get(ARMS.aim)));
  }

  prepare(gltf, aimClip) {
    const scene = gltf.scene;
    let body = null;
    scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.material.vertexColors = false;   // the pack's vertex colours are authoring masks, not paint
      if (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count) body = o;
    });
    if (!body?.skeleton.bones.some(b => b.name === 'hand_r')) throw new Error('unexpected skeleton');
    // classify every vertex as skin (0), uniform (1) or boots (2) by its strongest bone
    const geo = body.geometry, attr = { j: geo.attributes.skinIndex, w: geo.attributes.skinWeight }, cloth = new Float32Array(attr.j.count);
    for (let i = 0; i < cloth.length; i++) {
      const bone = boneOf(body.skeleton, attr, i);
      cloth[i] = SKIN.test(bone) ? 0 : BOOTS.test(bone) ? 2 : 1;
    }
    geo.setAttribute('aCloth', new THREE.BufferAttribute(cloth, 1));

    // scale to a real height, find which way the model faces (heel -> toe), and work out where gear attaches
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body), height = box.max.y - box.min.y, scale = HEIGHT / height;
    const rig = cloneSkinned(scene);
    rig.scale.setScalar(scale);
    rig.updateMatrixWorld(true);
    const bones = {};
    rig.traverse(o => { if (o.isBone) bones[o.name] = o; });
    const wp = name => bones[name].getWorldPosition(new THREE.Vector3());
    const fwd = wp('ball_l').add(wp('ball_r')).sub(wp('foot_l')).sub(wp('foot_r')).setY(0).normalize();
    const facing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, new THREE.Vector3(0, 1, 0)));
    const up = new THREE.Vector3(0, 1, 0);
    const helmet = localTo(bones.Head, wp('Head').addScaledVector(up, 0.13).addScaledVector(fwd, 0.01), facing, 1);
    const vest = localTo(bones.spine_03, wp('spine_03').addScaledVector(up, 0.02).addScaledVector(fwd, 0.03), facing, 1);
    // the gun goes in the right hand as posed by the aiming animation, pointing where the body faces
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(aimClip).play();
    mixer.update(0);
    rig.updateMatrixWorld(true);
    const hand = localTo(bones.hand_r, wp('hand_r').addScaledVector(fwd, 0.02).addScaledVector(up, -0.02), facing, 1);
    return {
      scene, bodyName: body.name, scale, helmet, vest, hand,
      yawOffset: Math.PI - Math.atan2(fwd.x, fwd.z),   // turns the model's facing into the game's yaw convention
      uniform: { blue: uniformMaterial(body.material, 'blue', 9 / scale), red: uniformMaterial(body.material, 'red', 9 / scale) },
    };
  }

  pick(actor) { return this.bodies[(actor.id * 7 + (actor.team === 'red' ? 3 : 0)) % this.bodies.length]; }
}

export class Character {
  constructor(actor, kit) {
    this.actor = actor;
    const tpl = (this.tpl = kit.pick(actor));
    this.root = new THREE.Group();
    this.model = cloneSkinned(tpl.scene);
    this.model.scale.setScalar(tpl.scale);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;   // animated limbs leave the bind-pose bounds
        if (o.name === tpl.bodyName) o.material = tpl.uniform[actor.team];
      }
    });
    const attach = (bone, obj, t) => {
      obj.position.copy(t.p);
      obj.quaternion.copy(t.q);
      obj.scale.copy(t.s);
      obj.castShadow = true;
      this.bones[bone].add(obj);
      return obj;
    };
    attach('Head', new THREE.Mesh(kit.helmetGeo, kit.helmetMat[actor.team]), tpl.helmet);
    attach('spine_03', new THREE.Mesh(kit.vestGeo, kit.vestMat[actor.team]), tpl.vest);
    this.holder = attach('hand_r', new THREE.Group(), tpl.hand);
    this.guns = {};
    this.gun = null;
    this.gunId = null;

    this.mixer = new THREE.AnimationMixer(this.model);
    const make = (clip, once) => {
      const a = this.mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.setEffectiveWeight(0);
      a.play();
      return a;
    };
    this.legs = Object.fromEntries(Object.entries(LOWER).map(([k, n]) => [k, make(kit.lower.get(n))]));
    this.arms = Object.fromEntries(Object.entries(ARMS).map(([k, n]) => [k, make(kit.upper.get(n))]));
    for (const k of SCRUBBED) this.arms[k].paused = true;
    this.deathAction = make(kit.full.get('Death01'), true);
    this.w = {};
    this.speed = 0;
    this.px = actor.x;
    this.pz = actor.z;
    this.shootT = this.hitT = this.throwT = 0;
    this.dying = false;
    this.flash = new THREE.Sprite(FLASH);
    this.flash.visible = false;
  }

  gunFor(key, id, optic) {
    if (!this.guns[key]) {
      const { group, spec } = buildGun(id, true, optic);
      group.userData.spec = spec;
      group.visible = false;
      this.holder.add(group);
      this.guns[key] = group;
    }
    return this.guns[key];
  }

  onShot() { this.shootT = 0.15; }
  onHit() { this.hitT = 0.33; }
  onThrow() { this.throwT = 0.45; }
  onDeath() {
    this.dying = true;
    this.deathAction.reset().play();
  }
  onSpawn() {
    this.dying = false;
    this.deathAction.stop();
    for (const k of Object.keys(this.w)) this.w[k] = 0;
    this.model.position.y = 0;
    this.px = this.actor.x;
    this.pz = this.actor.z;
  }

  // Blend weights toward their targets and apply them to the actions.
  blend(group, targets, k) {
    let sum = 0;
    for (const key of Object.keys(group)) sum += targets[key] || 0;
    for (const [key, action] of Object.entries(group)) {
      const t = sum > 0 ? (targets[key] || 0) / sum : 0;
      this.w[group === this.legs ? `l_${key}` : `a_${key}`] = lerp(this.w[group === this.legs ? `l_${key}` : `a_${key}`] || 0, t, k);
      action.setEffectiveWeight(this.w[group === this.legs ? `l_${key}` : `a_${key}`] * (this.dying ? 0 : 1));
    }
  }

  update(dt, time, visible = true) {
    const a = this.actor, id = a.wp?.[a.cur]?.id, optic = a.optics?.[a.cur] || 'iron', key = `${id}:${optic}`;
    if (id && key !== this.gunId) {
      if (this.gun) this.gun.visible = false;
      this.gun = this.gunFor(key, id, optic);
      this.gun.visible = true;
      this.gunId = key;
      this.gun.add(this.flash);
      this.flash.position.set(0, 0.03, this.gun.userData.spec.muzzle - 0.06);
    }
    this.root.visible = visible;
    if (!visible || dt <= 0) return;
    this.root.position.set(a.x, a.y, a.z);
    // speed from actual movement, so it works the same for interpolated remote players
    const vx = (a.x - this.px) / dt, vz = (a.z - this.pz) / dt;
    this.px = a.x;
    this.pz = a.z;
    const speed = Math.min(9, Math.hypot(vx, vz));
    this.speed = lerp(this.speed, speed, Math.min(1, dt * 10));
    const k = Math.min(1, dt * 12);
    this.shootT = Math.max(0, this.shootT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.throwT = Math.max(0, this.throwT - dt);

    if (a.dead || this.dying) {
      this.deathAction.setEffectiveWeight(1);
      this.blend(this.legs, {}, 1);
      this.blend(this.arms, {}, 1);
      if (a.respawn < 0.8) this.model.position.y = -(0.8 - a.respawn) * 0.6;   // sink away before respawning
      this.flash.visible = false;
      this.mixer.update(dt);
      return;
    }

    // legs: pick a locomotion cycle from speed and stance; backpedalling plays it in reverse
    let state = 'idle';
    if (!a.onGround && a.y > 0.05) state = 'jump';
    else if (a.crouchT > 0.5) state = this.speed > 0.4 ? 'crouchWalk' : 'crouch';
    else if (this.speed > 0.35) state = a.sprinting ? 'sprint' : this.speed < 3.2 ? 'walk' : 'jog';
    const rel = this.speed > 0.35 ? angDiff(yawTo(vx, vz), a.yaw) : 0, back = Math.abs(rel) > 1.9;
    if (STRIDE[state]) this.legs[state].timeScale = clamp(this.speed / STRIDE[state], 0.6, 1.8) * (back ? -1 : 1);
    this.blend(this.legs, { [state]: 1 }, k);
    // turn the hips a little toward a strafe
    const lean = !back && this.speed > 0.35 ? clamp(rel, -0.6, 0.6) : 0;
    this.lean = lerp(this.lean || 0, lean, k);
    this.root.rotation.y = a.yaw + this.tpl.yawOffset + this.lean;

    // arms: aim up/down with the view, unless reloading, knifing, throwing or sprinting
    const p = clamp(a.pitch / 0.8, -1, 1), arms = { aim: 1 - Math.abs(p), up: Math.max(0, p), down: Math.max(0, -p) };
    const overlay = a.reloadT > 0 ? 'reload' : a.knifeT > 0 ? 'knife' : this.throwT > 0 ? 'throw' : state === 'sprint' ? 'run' : null;
    const scrub = (key, f) => { const act = this.arms[key]; act.time = clamp(f, 0, 0.999) * act.getClip().duration; };
    if (overlay) {
      for (const key of ['aim', 'up', 'down']) arms[key] = 0;
      arms[overlay] = 1;
      if (overlay === 'reload') scrub('reload', 1 - a.reloadT / a.reloadMax);
      if (overlay === 'knife') scrub('knife', 1 - a.knifeT / 0.22);
      if (overlay === 'throw') scrub('throw', 1 - this.throwT / 0.45);
      if (overlay === 'run') this.arms.run.time = this.legs.sprint.time;
    } else {
      if (this.shootT > 0) { scrub('shoot', 1 - this.shootT / 0.15); arms.shoot = 0.7; }
      if (this.hitT > 0) { scrub('hit', 1 - this.hitT / 0.33); arms.hit = 0.6; }
    }
    this.blend(this.arms, arms, Math.min(1, dt * 18));
    this.flash.visible = a.flash > 0;
    if (this.flash.visible) {
      this.flash.scale.setScalar(0.35 + Math.random() * 0.2);
      this.flash.material.rotation = rand(0, Math.PI * 2);
    }
    this.mixer.update(dt);
  }

  // World position of the muzzle, for tracers.
  muzzle(out) {
    if (!this.gun) return out.set(this.actor.x, this.actor.y + 1.35, this.actor.z);
    this.root.updateMatrixWorld(true);
    return out.set(0, 0.03, this.gun.userData.spec.muzzle).applyMatrix4(this.gun.matrixWorld);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}

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
    const an = (i / 10) * Math.PI * 2, r = i % 2 ? 12 : 32;
    g.lineTo(32 + Math.cos(an) * r, 32 + Math.sin(an) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FLASH = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
