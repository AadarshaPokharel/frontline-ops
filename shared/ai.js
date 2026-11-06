import { TILE } from './constants.js';
import { eyeHeight } from './movement.js';
import { rand, randi, clamp, angDiff, yawTo } from './util.js';

const SIGHT = 70;          // metres
const FOV = 2.1;           // radians a bot notices you in (about 120 degrees), unless you are very close or shooting it

function randomGoal(M, b) {
  const { w, h } = M.world;
  for (let i = 0; i < 40; i++) {
    const r = Math.random();
    const tx = r < 0.5 ? Math.floor(w * rand(0.3, 0.7))
      : r < 0.8 ? Math.floor(w * (b.team === 'blue' ? rand(0.6, 0.97) : rand(0.03, 0.4)))
      : 1 + randi(w - 2);
    const tz = 1 + randi(h - 2);
    if (!M.world.solidT(tx, tz)) return { x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE };
  }
  return { x: b.x, z: b.z };
}

function canSee(M, b, e) {
  const ey = eyeHeight(b), dx = e.x - b.x, dz = e.z - b.z, d = Math.hypot(dx, dz);
  if (d > SIGHT) return false;
  const facing = Math.abs(angDiff(yawTo(dx, dz), b.yaw)) < FOV / 2;
  if (!facing && d > 6 && M.time - b.lastHit > 1) return false;
  const chest = e.y + (eyeHeight(e) - e.y) * 0.7;
  return M.world.visible(b.x, ey, b.z, e.x, chest, e.z) || M.world.visible(b.x, ey, b.z, e.x, eyeHeight(e), e.z);
}

/** Decide this tick's command for a bot: the same kind of command a human's keyboard and mouse produce. */
export function botCommand(M, b, dt) {
  const D = M.diff, m = b.wp[b.cur], w = M.weapons[m.id], world = M.world;
  const cmd = { f: 0, s: 0, yaw: b.yaw, pitch: b.pitch, fire: false, ads: false, crouch: false, sprint: false, jump: false, actions: [] };

  let tgt = null, td = 1e9;
  for (const e of M.actors) {
    if (e.dead || e.team === b.team) continue;
    const d = Math.hypot(e.x - b.x, e.z - b.z);
    if (d < td && canSee(M, b, e)) { tgt = e; td = d; }
  }
  if (tgt) {
    if (b.tgt !== tgt) {
      b.tgt = tgt;
      b.react = D.react * rand(0.7, 1.3);
      b.errYaw = rand(-1, 1) * D.aim * 4;     // first shots are off, then the bot settles its aim
      b.errPitch = rand(-1, 1) * D.aim * 3;
    }
    b.lastKnown = { x: tgt.x, z: tgt.z };
    b.seen = 0;
  } else {
    b.tgt = null;
    b.seen += dt;
  }

  let mx = 0, mz = 0, wantYaw = b.yaw, wantPitch = 0, turn = 6;
  if (tgt) {
    const aimY = (D.headshots && Math.random() < 0.3 ? eyeHeight(tgt) : tgt.y + (eyeHeight(tgt) - tgt.y) * 0.72);
    const dx = tgt.x - b.x, dz = tgt.z - b.z, flat = Math.hypot(dx, dz);
    b.errYaw *= Math.exp(-dt * 1.5);
    b.errPitch *= Math.exp(-dt * 1.5);
    wantYaw = yawTo(dx, dz) + b.errYaw + rand(-1, 1) * D.aim * 0.3;
    wantPitch = Math.atan2(aimY - eyeHeight(b), flat) + b.errPitch;
    turn = D.turn;
    b.react -= dt;

    // hold a comfortable range for the weapon and strafe; crouch behind low cover while reloading
    if ((b.strafeT -= dt) <= 0) {
      b.strafe = Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? -1 : 1;
      b.strafeT = rand(0.5, 1.6);
    }
    const ideal = clamp(w.falloff[0] * 0.8, 6, 26);
    const fwd = td > ideal * 1.3 ? 1 : td < ideal * 0.5 ? -0.7 : 0;
    const fx = dx / flat, fz = dz / flat;
    mx = fx * fwd - fz * b.strafe * 0.85;
    mz = fz * fwd + fx * b.strafe * 0.85;
    cmd.ads = td > 12 && b.reloadT <= 0;
    cmd.crouch = b.reloadT > 0 || (b.crouchy && td > 15);

    const aligned = Math.abs(angDiff(wantYaw, b.yaw)) < 0.07 && Math.abs(wantPitch - b.pitch) < 0.07;
    if (td < 2) cmd.actions.push('knife');
    else if (b.react <= 0 && aligned) {
      // short bursts with automatic weapons, like a person controlling recoil
      b.burst -= dt;
      if (b.burst > 0 || !w.auto) cmd.fire = m.mag > 0 && Math.random() < (w.auto ? 1 : 0.5);
      if (b.burst < -rand(0.15, 0.4)) b.burst = rand(0.3, 0.8);
      if (m.mag === 0) cmd.actions.push('reload');
    }
    if (b.gren > 0 && td > 8 && td < 20 && Math.random() < dt * 0.05) cmd.actions.push('frag');
  } else {
    // roam: investigate the last sighting or gunfire, otherwise wander along a BFS path
    if (m.mag < w.mag * 0.5) cmd.actions.push('reload');
    let goal;
    if (b.lastKnown && b.seen < 6) goal = b.lastKnown;
    else {
      b.lastKnown = null;
      if (!b.wander) b.wander = randomGoal(M, b);
      goal = b.wander;
    }
    if ((b.pathT -= dt) <= 0 || !b.path || b.goalRef !== goal) {
      b.path = world.findPath(b.x, b.z, goal.x, goal.z) || [];
      b.pathT = 1.2;
      b.goalRef = goal;
    }
    if (b.path.length) {
      const n = b.path[0], dx = n.x - b.x, dz = n.z - b.z, d = Math.hypot(dx, dz);
      if (d < 0.35) b.path.shift();
      else { mx = dx / d; mz = dz / d; }
    } else if (goal === b.lastKnown) b.lastKnown = null;
    else b.wander = null;
    if (mx || mz) wantYaw = yawTo(mx, mz);
    cmd.sprint = !b.lastKnown && b.path.length > 4;
  }

  // turn the view at a limited rate, then express the world-space move relative to the new view
  b.yaw += clamp(angDiff(wantYaw, b.yaw), -turn * dt, turn * dt);
  b.pitch += clamp(wantPitch - b.pitch, -turn * dt, turn * dt);
  cmd.yaw = b.yaw;
  cmd.pitch = b.pitch;
  const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
  cmd.f = -mx * sy - mz * cy;
  cmd.s = mx * cy - mz * sy;

  // stuck on a corner: pick something else to do
  const moved = Math.hypot(b.x - (b.lastX ?? b.x), b.z - (b.lastZ ?? b.z));
  b.lastX = b.x;
  b.lastZ = b.z;
  if ((mx || mz) && moved < 0.01) {
    if ((b.stuck += dt) > 0.6) {
      b.stuck = 0;
      b.path = null;
      b.strafe = -b.strafe || 1;
      if (!tgt) b.wander = null;
    }
  } else b.stuck = 0;
  return cmd;
}
