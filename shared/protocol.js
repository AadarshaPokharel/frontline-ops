// Wire format between the browser and the game server (JSON over WebSocket), kept compact:
// arrays instead of objects, numbers rounded, booleans packed into bit flags. Both sides import this file.
import { clamp } from './util.js';

export const SNAPSHOT_HZ = 20;
export const INTERMISSION = 12;    // seconds between online matches
export const INTERP_DELAY = 0.1;   // seconds remote players are drawn in the past (smooths network jitter)
const ACTIONS = ['reload', 'slot1', 'slot2', 'swap', 'frag', 'knife'];
const BUTTONS = ['fire', 'ads', 'sprint', 'crouch', 'jump'];
const FLAGS = ['dead', 'moving', 'sprinting', 'ads', 'onGround', 'spotted'];
// Events only the player they concern needs (the rest are broadcast).
export const PERSONAL = new Set(['empty', 'noammo', 'reload', 'reloaded', 'swap', 'pickup', 'multikill']);

const r = (v, k) => Math.round(v * k) / k;
const bits = (obj, names) => names.reduce((m, n, i) => (obj[n] ? m | (1 << i) : m), 0);
const unbits = (m, names, out = {}) => { names.forEach((n, i) => { out[n] = !!(m & (1 << i)); }); return out; };

// ---- client -> server ----
export function packCommand(cmd, seq, viewTime) {
  let actions = 0;
  for (const a of cmd.actions || []) { const i = ACTIONS.indexOf(a); if (i >= 0) actions |= 1 << i; }
  return [seq, r(cmd.f, 100), r(cmd.s, 100), r(cmd.yaw, 1e4), r(cmd.pitch, 1e4), bits(cmd, BUTTONS), actions, r(viewTime, 1e3)];
}

// Validates everything: a malformed or hostile command is dropped (null).
export function unpackCommand(a) {
  if (!Array.isArray(a) || a.length !== 8 || !a.every(Number.isFinite)) return null;
  const [seq, f, s, yaw, pitch, buttons, actions, viewTime] = a;
  if (!Number.isInteger(seq) || seq < 0) return null;
  const cmd = unbits(buttons | 0, BUTTONS, { seq, f: clamp(f, -1, 1), s: clamp(s, -1, 1), yaw, pitch: clamp(pitch, -1.45, 1.45), viewTime, actions: [] });
  ACTIONS.forEach((name, i) => { if (actions & (1 << i)) cmd.actions.push(name); });
  return cmd;
}

// ---- server -> client ----
export const rosterEntry = a => ({ id: a.id, name: a.name, team: a.team, bot: a.isBot, loadout: a.loadout, optics: a.optics });

// Public state of every actor, as seen by everyone.
export function packActor(a) {
  const reload = a.reloadT > 0 ? r(1 - a.reloadT / a.reloadMax, 100) : -1;
  return [a.id, r(a.x, 100), r(a.y, 100), r(a.z, 100), r(a.yaw, 1e3), r(a.pitch, 1e3), bits({ ...a, spotted: a.spotted > 0 }, FLAGS),
    Math.ceil(Math.max(0, a.hp)), a.cur, r(a.crouchT, 100), reload, r(Math.max(0, a.knifeT), 100), a.kills, a.deaths, a.xp, a.streak, r(Math.max(0, a.respawn), 10)];
}

export function unpackActor(p, a) {
  [a.id, a.x, a.y, a.z, a.yaw, a.pitch] = p;
  unbits(p[6], FLAGS, a);
  a.spotted = a.spotted ? 1 : 0;
  [, , , , , , , a.hp, a.cur, a.crouchT] = p;
  a.reloadMax = 1;
  a.reloadT = p[10] >= 0 ? 1 - p[10] : 0;
  [, , , , , , , , , , , a.knifeT, a.kills, a.deaths, a.xp, a.streak, a.respawn] = p;
  return a;
}

// Everything about your own soldier the client needs to correct its prediction.
export function packSelf(a) {
  return [r(a.x, 1e4), r(a.y, 1e4), r(a.z, 1e4), r(a.vx, 1e3), r(a.vy, 1e3), r(a.vz, 1e3), a.onGround ? 1 : 0, r(a.crouchT, 1e3),
    r(a.hp, 10), a.dead ? 1 : 0, r(a.respawn, 100), a.cur, a.wp.map(m => [m.mag, m.res]), a.gren, r(a.reloadT, 1e3), r(a.reloadMax, 1e3),
    r(a.cd, 1e3), r(a.swapT, 1e3), r(a.knifeT, 1e3), r(a.melee, 1e3), a.trigger ? 1 : 0, r(a.yaw, 1e4), a.streak, a.lastHit];
}

export function unpackSelf(p, a) {
  [a.x, a.y, a.z, a.vx, a.vy, a.vz] = p;
  a.onGround = !!p[6];
  a.crouchT = p[7];
  a.hp = p[8];
  a.dead = !!p[9];
  a.respawn = p[10];
  a.cur = p[11];
  p[12].forEach(([mag, res], i) => { if (a.wp[i]) { a.wp[i].mag = mag; a.wp[i].res = res; } });
  [, , , , , , , , , , , , , a.gren, a.reloadT, a.reloadMax, a.cd, a.swapT, a.knifeT, a.melee] = p;
  a.trigger = !!p[20];
  a.yaw = p[21];
  a.streak = p[22];
  a.lastHit = p[23];
  return a;
}

export const packNade = g => [g.id, r(g.x, 100), r(g.y, 100), r(g.z, 100), g.team];
export const unpackNade = p => ({ id: p[0], x: p[1], y: p[2], z: p[3], team: p[4] });
export const packStrike = s => [s.id, r(s.x, 10), r(s.z, 10), r(s.t, 100)];
export const unpackStrike = p => ({ id: p[0], x: p[1], z: p[2], t: p[3] });
export const packPickup = k => [k.id, k.kind === 'care' ? 1 : 0, r(k.x, 100), r(k.z, 100), k.drop ? 1 : 0, r(k.cd, 10), r(k.land, 100), r(k.life ?? 0, 10)];
export const unpackPickup = p => ({ id: p[0], kind: p[1] ? 'care' : 'ammo', x: p[2], z: p[3], drop: !!p[4], cd: p[5], land: p[6], life: p[7] });

// Events carry actor ids instead of objects; shot coordinates are rounded to centimetres.
export function packEvent(e) {
  const out = { ...e };
  for (const k of ['a', 'v', 'att']) if (out[k] && typeof out[k] === 'object') out[k] = out[k].id;
  if (e.type === 'shot') {
    out.ox = r(e.ox, 100); out.oy = r(e.oy, 100); out.oz = r(e.oz, 100);
    out.ends = e.ends.map(p => ({ ...p, x: r(p.x, 100), y: r(p.y, 100), z: r(p.z, 100) }));
  }
  if (typeof out.dmg === 'number') out.dmg = r(out.dmg, 10);
  return out;
}
