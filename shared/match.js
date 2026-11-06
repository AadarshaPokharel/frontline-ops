import { TILE, TICK, BODY, FRAG, AIRSTRIKE, KNIFE, REGEN, RESPAWN, SPAWN_ZONE } from './constants.js';
import { World, raySphere, rayCylinder } from './world.js';
import { stepMovement, eyeHeight } from './movement.js';
import { botCommand } from './ai.js';
import { TAU, rand, randi, clamp, lerp, angDiff, shuffle, forward, yawTo } from './util.js';

const NAMES = {
  blue: ['Viper', 'Hawk', 'Rook', 'Bishop', 'Nomad', 'Saber', 'Echo', 'Atlas', 'Ghost', 'Reaper'],
  red: ['Wolf', 'Cobra', 'Raven', 'Jackal', 'Vulture', 'Fang', 'Scorpion', 'Kraken', 'Mamba', 'Hyena'],
};
const MULTI_NAMES = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'FURY KILL', 'FRENZY KILL'];
const SPECIAL_KILLS = { knife: 'Knife', frag: 'Frag', air: 'Airstrike' };
const HISTORY_SECONDS = 0.6;    // how far back lag compensation may rewind targets
const MAX_SHOT = 250;
const other = team => (team === 'blue' ? 'red' : 'blue');

export function falloff(w, d) {
  const [near, far, min] = w.falloff;
  return d <= near ? 1 : d >= far ? min : lerp(1, min, (d - near) / (far - near));
}

/**
 * One team deathmatch, independent of rendering and networking. Humans are driven by applyCommand()
 * (from the keyboard locally, or from network input on the game server); bots issue the same commands
 * from their own brain inside tick(). Everything other code reacts to is pushed onto `events`.
 */
export class Match {
  constructor(data, opts) {
    this.data = data;
    this.weapons = data.weapons;
    this.mapDef = data.maps.find(m => m.slug === opts.map) || data.maps[0];
    this.world = new World(this.mapDef);
    this.difficulty = opts.difficulty ?? 1;
    this.diff = data.difficulties[this.difficulty] ?? data.difficulties[1];
    this.limit = opts.limit;
    this.lagComp = !!opts.lagComp;
    this.timeLimit = data.match.timeLimit;
    this.streakAt = {};
    for (const s of data.streaks) this.streakAt[s.kills] = s.id;
    this.actors = [];
    this.nades = [];
    this.pickups = [];
    this.strikes = [];
    this.events = [];
    this.score = { blue: 0, red: 0 };
    this.uav = { blue: 0, red: 0 };
    this.time = 0;
    this.left = this.timeLimit;
    this.over = false;
    this.result = null;
    this.nextId = 1;
    this.nextObjId = 1;
    this.names = { blue: shuffle([...NAMES.blue]), red: shuffle([...NAMES.red]) };
    this.fwd = {};
    // Client-side prediction replays unacknowledged commands with `silent` on: state changes, but no events,
    // shot traces or grenades (the server already produced those).
    this.silent = false;
    if (!opts.noPickups) this.placeAmmoCrates();
  }

  emit(type, data = {}) {
    if (this.silent) return;
    data.type = type;
    this.events.push(data);
  }

  // ---------- roster ----------
  // An allowed optic for a weapon (the weapon's default when `wanted` is not one of its options).
  opticFor(wid, wanted) {
    const list = this.weapons[wid].optics || ['iron'];
    return list.includes(wanted) ? wanted : list[0];
  }

  mkActor(name, team, isBot, loadout, optics = loadout.map(w => this.opticFor(w))) {
    return {
      id: this.nextId++, name, team, isBot, playerId: null, loadout, optics,
      x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, onGround: true, crouchT: 0, yaw: 0, pitch: 0,
      hp: 100, dead: true, respawn: 0, kills: 0, deaths: 0, xp: 0, streak: 0, bestStreak: 0,
      wp: [], cur: 0, reloadT: 0, reloadMax: 1, cd: 0, swapT: 0, flash: 0, gren: 2, melee: 0, knifeT: 0,
      lastHit: -99, lastKill: -9, multi: 0, moving: false, sprinting: false, ads: false, trigger: false, spotted: 0, noAmmoT: -9,
      history: this.lagComp ? [] : null,
      tgt: null, react: 0, seen: 99, lastKnown: null, wander: null, path: null, pathT: 0, goalRef: null, stuck: 0,
      strafe: 1, strafeT: 0, burst: 0.5, errYaw: 0, errPitch: 0, crouchy: Math.random() < 0.35,
    };
  }

  botName(team) {
    const used = new Set(this.actors.map(a => a.name)), pool = this.names[team];
    return pool.find(n => !used.has(n)) || `${pool[0]}-${this.nextId}`;
  }

  addHuman(name, team, primary, playerId = null, optic = null) {
    const side = this.data.sidearm;
    const a = this.mkActor(name, team, false, [primary, side], [this.opticFor(primary, optic), this.opticFor(side)]);
    a.playerId = playerId;
    this.actors.push(a);
    this.spawn(a);
    return a;
  }

  addBot(team) {
    const P = this.data.primaries, primary = P[randi(P.length)], side = this.data.sidearm, choices = this.weapons[primary].optics || ['iron'];
    const a = this.mkActor(this.botName(team), team, true, [primary, side], [choices[randi(choices.length)], this.opticFor(side)]);
    this.actors.push(a);
    this.spawn(a);
    return a;
  }

  removeActor(a) {
    const i = this.actors.indexOf(a);
    if (i < 0) return;
    this.actors.splice(i, 1);
    for (const o of this.actors) if (o.tgt === a) o.tgt = null;
    this.emit('leave', { id: a.id, name: a.name });
  }

  // Top every team up to `size` with bots, and remove extra bots when humans fill a team.
  balanceBots(size) {
    for (const team of ['blue', 'red']) {
      let members = this.actors.filter(a => a.team === team);
      while (members.length < size) { this.addBot(team); members = this.actors.filter(a => a.team === team); }
      while (members.length > size) {
        const bot = members.filter(a => a.isBot).sort((a, b) => Number(b.dead) - Number(a.dead) || a.kills - b.kills)[0];
        if (!bot) break;
        this.removeActor(bot);
        members = this.actors.filter(a => a.team === team);
      }
    }
  }

  // The team a new human should join: fewer humans, then fewer players.
  teamForNewHuman() {
    const humans = t => this.actors.filter(a => a.team === t && !a.isBot).length;
    return humans('blue') <= humans('red') ? 'blue' : 'red';
  }

  // Spawn on your own side, as far from living enemies as possible, facing the enemy side.
  spawn(a) {
    const { w, h } = this.world;
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 60; i++) {
      const tx = a.team === 'blue' ? 1 + randi(SPAWN_ZONE) : w - 2 - randi(SPAWN_ZONE), tz = 1 + randi(h - 2);
      if (this.world.solidT(tx, tz)) continue;
      const x = (tx + 0.5) * TILE, z = (tz + 0.5) * TILE;
      let score = Math.random() * 4, nearest = 60;
      for (const e of this.actors) {
        if (e.dead || e === a) continue;
        const d = Math.hypot(e.x - x, e.z - z);
        if (e.team !== a.team) nearest = Math.min(nearest, d);
        else if (d < 1) score -= 30;
      }
      score += nearest;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    if (!best) best = { x: ((a.team === 'blue' ? 2 : w - 3) + 0.5) * TILE, z: ((h >> 1) + 0.5) * TILE };
    Object.assign(a, {
      x: best.x, z: best.z, y: 0, vx: 0, vz: 0, vy: 0, onGround: true, crouchT: 0, hp: 100, dead: false, gren: 2, cur: 0,
      reloadT: 0, cd: 0.2, swapT: 0, knifeT: 0, flash: 0, yaw: a.team === 'blue' ? -Math.PI / 2 : Math.PI / 2, pitch: 0,
      tgt: null, lastKnown: null, wander: null, path: null, seen: 99, lastHit: -99, stuck: 0, trigger: false,
    });
    a.wp = a.loadout.map(id => ({ id, mag: this.weapons[id].mag, res: this.weapons[id].reserve }));
    if (a.history) a.history.length = 0;
    this.emit('spawn', { a });
  }

  placeAmmoCrates() {
    const { w, h } = this.world;
    for (let placed = 0, tries = 0; placed < 6 && tries < 500; tries++) {
      const tx = 7 + randi(w - 14), tz = 1 + randi(h - 2);
      if (this.world.solidT(tx, tz)) continue;
      const x = (tx + 0.5) * TILE, z = (tz + 0.5) * TILE;
      if (this.pickups.some(k => Math.hypot(k.x - x, k.z - z) < 16)) continue;
      this.pickups.push({ id: this.nextObjId++, x, z, kind: 'ammo', drop: false, cd: 0, land: 0 });
      placed++;
    }
  }

  // ---------- player control ----------
  /** One fixed step of a player's input. `viewTime` is the match time the shooter was seeing (lag compensation). */
  applyCommand(a, cmd, dt = TICK, viewTime = this.time) {
    if (a.dead || this.over) return;
    a.yaw = cmd.yaw;
    a.pitch = clamp(cmd.pitch, -1.45, 1.45);
    for (const action of cmd.actions || []) {
      if (action === 'reload') this.reload(a);
      else if (action === 'slot1') this.swapTo(a, 0);
      else if (action === 'slot2') this.swapTo(a, 1);
      else if (action === 'swap') this.swapTo(a, 1 - a.cur);
      else if (action === 'frag') this.throwNade(a);
      else if (action === 'knife') this.melee(a);
    }
    const m = a.wp[a.cur], w = this.weapons[m.id];
    a.ads = !!cmd.ads && !a.sprinting && a.swapT <= 0 && a.knifeT <= 0;
    stepMovement(this.world, a, { ...cmd, ads: a.ads }, dt, w.move || 1);
    a.cd -= dt; a.flash -= dt; a.melee -= dt; a.knifeT -= dt; a.swapT -= dt;
    if (a.reloadT > 0 && (a.reloadT -= dt) <= 0) this.finishReload(a);
    if (a.sprinting) a.cd = Math.max(a.cd, 0.15);   // sprint-out delay before you can shoot
    if (!cmd.fire) a.trigger = false;
    if (cmd.fire && !a.sprinting) {
      if (w.auto) this.fire(a, viewTime);
      else if (!a.trigger && this.fire(a, viewTime)) a.trigger = true;   // semi-auto: one shot per click
    }
    if (m.mag === 0 && m.res > 0 && a.reloadT <= 0 && !cmd.fire) this.reload(a);
  }

  fire(a, viewTime) {
    const m = a.wp[a.cur], w = this.weapons[m.id];
    if (a.cd > 0 || a.reloadT > 0 || a.knifeT > 0 || a.swapT > 0) return false;
    if (m.mag <= 0) {
      this.emit('empty', { a });
      a.cd = 0.25;
      this.reload(a);
      return false;
    }
    m.mag--;
    a.cd = (a.cd > -0.03 ? a.cd : 0) + 60 / w.rpm;
    a.flash = 0.06;
    if (this.silent) return true;
    const speed = Math.hypot(a.vx, a.vz);
    const spread = (a.ads ? w.adsSpread : w.hipSpread) * (1 + Math.min(1, speed / 5) * 0.8 + (a.onGround ? 0 : 1.5)) * (1 - 0.3 * a.crouchT);
    const ox = a.x, oy = eyeHeight(a), oz = a.z, f = forward(a.yaw, a.pitch, this.fwd);
    const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);                                        // view right
    const sp = Math.sin(a.pitch), ux = Math.sin(a.yaw) * sp, uy = Math.cos(a.pitch), uz = Math.cos(a.yaw) * sp;   // view up
    const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const r = Math.tan(spread) * Math.sqrt(Math.random()), th = Math.random() * TAU, px = Math.cos(th) * r, py = Math.sin(th) * r;
      let dx = f.x + rx * px + ux * py, dy = f.y + uy * py, dz = f.z + rz * px + uz * py;
      const len = Math.hypot(dx, dy, dz);
      dx /= len; dy /= len; dz /= len;
      ends.push(this.trace(a, w, m.id, ox, oy, oz, dx, dy, dz, viewTime));
    }
    a.spotted = 1.5;   // firing shows you on the enemy minimap
    this.emit('shot', { a, wid: m.id, ox, oy, oz, ends });
    for (const o of this.actors)   // gunfire is loud: idle enemy bots come to investigate
      if (o.isBot && !o.dead && o.team !== a.team && !o.tgt && Math.hypot(o.x - a.x, o.z - a.z) < 45) { o.lastKnown = { x: a.x, z: a.z }; o.seen = 0; }
    if (a.isBot) a.pitch += w.recoil * 0.6;   // bots feel recoil too and pull back down
    return true;
  }

  // Hitscan: the nearest of the map surface and every enemy's head sphere and body cylinder.
  trace(a, w, wid, ox, oy, oz, dx, dy, dz, viewTime) {
    const wh = this.world.raycast(ox, oy, oz, dx, dy, dz, MAX_SHOT);
    let best = wh ? wh.t : MAX_SHOT, victim = null, head = false;
    const nx = wh ? wh.nx : 0, ny = wh ? wh.ny : 0, nz = wh ? wh.nz : 0;
    for (const e of this.actors) {
      if (e === a || e.dead || e.team === a.team) continue;
      const p = this.posAt(e, viewTime), eye = p.y + lerp(BODY.eyeStand, BODY.eyeCrouch, p.c);
      const th = raySphere(ox, oy, oz, dx, dy, dz, p.x, eye, p.z, BODY.headR);
      if (th < best) { best = th; victim = e; head = true; }
      const tb = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, BODY.bodyR, p.y, eye - BODY.headR);
      if (tb < best) { best = tb; victim = e; head = false; }
    }
    const end = { x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, kind: 'miss' };
    if (victim) {
      end.kind = head ? 'head' : 'body';
      end.victim = victim.id;
      this.damage(victim, w.dmg * falloff(w, best) * (head ? w.head : 1), a, wid, head);
    } else if (wh) Object.assign(end, { kind: 'world', nx, ny, nz });
    return end;
  }

  // Where an actor was at match time t (interpolated from its recent history), for lag compensation.
  posAt(e, t) {
    const H = e.history;
    if (!H || H.length < 2 || t >= this.time - 1e-4) return { x: e.x, y: e.y, z: e.z, c: e.crouchT };
    t = Math.max(t, H[0].t);
    for (let i = H.length - 1; i > 0; i--) {
      const a = H[i - 1], b = H[i];
      if (a.t <= t) {
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), c: lerp(a.c, b.c, k) };
      }
    }
    return H[0];
  }

  reload(a) {
    const m = a.wp[a.cur], w = this.weapons[m.id];
    if (a.reloadT > 0 || m.mag >= w.mag || a.swapT > 0) return;
    if (m.res <= 0) {
      if (a.isBot) m.res = w.reserve;   // bots never run dry
      else {
        if (this.time - a.noAmmoT > 1.5) { a.noAmmoT = this.time; this.emit('noammo', { a }); }
        return;
      }
    }
    a.reloadT = a.reloadMax = w.reload;
    this.emit('reload', { a });
  }

  finishReload(a) {
    const m = a.wp[a.cur], w = this.weapons[m.id], take = Math.min(w.mag - m.mag, m.res);
    m.mag += take;
    m.res -= take;
    this.emit('reloaded', { a });
  }

  swapTo(a, i) {
    if (!a.wp[i] || i === a.cur) return;
    a.cur = i;
    a.reloadT = 0;
    a.swapT = 0.35;
    this.emit('swap', { a });
  }

  melee(a) {
    if (a.melee > 0 || a.dead) return;
    a.melee = KNIFE.cooldown;
    a.knifeT = KNIFE.swing;
    a.reloadT = 0;
    this.emit('knife', { a });
    if (this.silent) return;
    for (const e of this.actors) {
      if (e.dead || e.team === a.team) continue;
      const dx = e.x - a.x, dz = e.z - a.z;
      if (Math.hypot(dx, dz) < KNIFE.range + BODY.bodyR && Math.abs(angDiff(yawTo(dx, dz), a.yaw)) < 0.9 && Math.abs(e.y - a.y) < 1.2) {
        this.damage(e, KNIFE.damage, a, 'knife', false);
        break;
      }
    }
  }

  throwNade(a) {
    if (a.gren <= 0 || a.dead) return;
    a.gren--;
    if (this.silent) return;
    const f = forward(a.yaw, a.pitch, {}), y = eyeHeight(a);
    this.nades.push({
      id: this.nextObjId++, own: a, team: a.team, t: FRAG.fuse,
      x: a.x + f.x * 0.4, y: y + f.y * 0.4, z: a.z + f.z * 0.4,
      vx: f.x * FRAG.speed + a.vx * 0.5, vy: f.y * FRAG.speed + FRAG.lift, vz: f.z * FRAG.speed + a.vz * 0.5,
    });
    this.emit('throw', { a });
  }

  damage(v, d, att, wid, head = false) {
    if (v.dead || this.over) return;
    v.hp -= d;
    v.lastHit = this.time;
    if (v.isBot && att && att !== v && !v.tgt) { v.lastKnown = { x: att.x, z: att.z }; v.seen = 0; }
    this.emit('hit', { v, att, dmg: d, wid, head });
    if (v.hp <= 0) this.kill(v, att, wid, head);
  }

  kill(v, att, wid, head) {
    Object.assign(v, { dead: true, hp: 0, streak: 0, respawn: v.isBot ? RESPAWN.bot : RESPAWN.human, reloadT: 0, tgt: null, vx: 0, vz: 0, ads: false });
    v.deaths++;
    this.pickups.push({ id: this.nextObjId++, x: v.x, z: v.z, kind: 'ammo', drop: true, life: 15, cd: 0, land: 0 });
    const killer = att && att !== v ? att : null;
    if (killer) {
      killer.kills++;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      killer.xp += 100 + (head ? 50 : 0);
      this.score[killer.team]++;
    }
    this.emit('kill', { v, att: killer, wid, head, weapon: SPECIAL_KILLS[wid] || this.weapons[wid].name });
    if (killer && !killer.isBot) this.humanKill(killer);
  }

  // Multi-kill bonuses and killstreak rewards (humans only).
  humanKill(p) {
    p.multi = this.time - p.lastKill < 4 ? p.multi + 1 : 1;
    p.lastKill = this.time;
    const bonus = p.multi >= 2 ? Math.min(p.multi, 5) * 50 : 0;
    p.xp += bonus;
    this.emit('multikill', { a: p, multi: p.multi, bonus, label: MULTI_NAMES[Math.min(p.multi, 5)] });
    const reward = this.streakAt[p.streak];
    if (reward === 'uav') {
      this.uav[p.team] = 30;
      this.emit('streak', { a: p, id: 'uav' });
    } else if (reward === 'care') {
      let pos = { x: p.x, z: p.z };
      for (let i = 0; i < 8; i++) {
        const an = p.yaw + (i * TAU) / 8, x = p.x - Math.sin(an) * 3, z = p.z - Math.cos(an) * 3;
        if (!this.world.collides(x, z, 0.8) && this.world.visible(p.x, 1, p.z, x, 1, z)) { pos = { x, z }; break; }
      }
      this.pickups.push({ id: this.nextObjId++, x: pos.x, z: pos.z, kind: 'care', drop: false, land: 2.2, cd: 0 });
      this.emit('streak', { a: p, id: 'care' });
    } else if (reward === 'air') this.callAirstrike(p);
  }

  callAirstrike(p) {
    const { w, h } = this.world, targets = this.actors.filter(e => !e.dead && e.team !== p.team);
    targets.forEach((e, i) => {
      let x = e.x + rand(-1, 1), z = e.z + rand(-1, 1);
      if (this.world.solidAt(x, z)) { x = e.x; z = e.z; }
      this.strikes.push({ id: this.nextObjId++, x, z, t: 2.2 + i * 0.3, own: p });
    });
    const enemyHalf = p.team === 'blue' ? [0.5, 0.95] : [0.05, 0.5];
    for (let i = targets.length, tries = 0; i < 6 && tries < 200; tries++) {
      const tx = Math.floor(w * rand(...enemyHalf)), tz = 1 + randi(h - 2);
      if (this.world.solidT(tx, tz)) continue;
      this.strikes.push({ id: this.nextObjId++, x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE, t: 2.4 + i * 0.3, own: p });
      i++;
    }
    const lane = this.strikes.reduce((s, k) => s + k.z, 0) / Math.max(1, this.strikes.length);
    this.emit('streak', { a: p, id: 'air', lane });
  }

  explode(x, y, z, own, R, dmg, wid) {
    for (const a of this.actors) {
      if (a.dead || (a.team === own.team && a !== own)) continue;
      const cy = a.y + 1, d = Math.hypot(a.x - x, cy - y, a.z - z);
      if (d < R && this.world.visible(x, y + 0.2, z, a.x, cy, a.z))
        this.damage(a, dmg * (1 - d / R) * (a === own ? 0.5 : 1), own, wid, false);
    }
    this.emit('explode', { x, y, z, R });
  }

  giveAmmo(a, full) {
    let got = false;
    for (const m of a.wp) {
      const w = this.weapons[m.id], res = full ? w.reserve : Math.min(w.reserve, m.res + w.mag * 2);
      if (full && m.mag < w.mag) { m.mag = w.mag; got = true; }
      if (res > m.res) { m.res = res; got = true; }
    }
    const gren = full ? 3 : Math.min(3, a.gren + 1);
    if (gren > a.gren) { a.gren = gren; got = true; }
    return got;
  }

  // ---------- world step ----------
  tick(dt = TICK) {
    if (this.over) return;
    this.time += dt;
    this.left -= dt;
    for (const a of this.actors) {
      if (a.dead) {
        if ((a.respawn -= dt) <= 0) this.spawn(a);
        continue;
      }
      if (a.isBot) this.applyCommand(a, botCommand(this, a, dt), dt);
      a.spotted -= dt;
      if (this.time - a.lastHit > REGEN.delay && a.hp < 100) a.hp = Math.min(100, a.hp + REGEN.rate * dt);   // COD-style regen
    }
    this.separate();
    if (this.lagComp) {
      for (const a of this.actors) {
        if (a.dead) continue;
        a.history.push({ t: this.time, x: a.x, y: a.y, z: a.z, c: a.crouchT });
        while (a.history.length && a.history[0].t < this.time - HISTORY_SECONDS) a.history.shift();
      }
    }
    this.updateNades(dt);
    this.updateStrikes(dt);
    this.updatePickups(dt);
    this.uav.blue = Math.max(0, this.uav.blue - dt);
    this.uav.red = Math.max(0, this.uav.red - dt);
    if (this.score.blue >= this.limit || this.score.red >= this.limit || this.left <= 0) this.end();
  }

  separate() {
    const A = this.actors, rr = BODY.radius * 2;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.dead) continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (rr - d) / 2, nx = dx / d, nz = dz / d;
          this.world.move(a, -nx * push, -nz * push, BODY.radius);
          this.world.move(b, nx * push, nz * push, BODY.radius);
        }
      }
    }
  }

  // Grenades: gravity, bouncing off columns and the floor (or the top of cover), sub-stepped.
  updateNades(dt) {
    const world = this.world;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const g = this.nades[i], n = Math.max(1, Math.ceil((Math.hypot(g.vx, g.vy, g.vz) * dt) / 0.2)), h = dt / n;
      for (let k = 0; k < n; k++) {
        g.vy -= 12 * h;
        const nx = g.x + g.vx * h;
        if (world.heightAt(nx, g.z) > g.y) g.vx *= -0.4; else g.x = nx;
        const nz = g.z + g.vz * h;
        if (world.heightAt(g.x, nz) > g.y) g.vz *= -0.4; else g.z = nz;
        const floor = world.heightAt(g.x, g.z) + 0.06;
        g.y += g.vy * h;
        if (g.y < floor) {
          g.y = floor;
          if (g.vy < 0) { g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; }
        }
      }
      if ((g.t -= dt) <= 0) {
        this.nades.splice(i, 1);
        this.explode(g.x, g.y, g.z, g.own, FRAG.radius, FRAG.damage, 'frag');
      }
    }
  }

  updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if ((s.t -= dt) <= 0) {
        this.strikes.splice(i, 1);
        this.explode(s.x, 0.3, s.z, s.own, AIRSTRIKE.radius, AIRSTRIKE.damage, 'air');
      }
    }
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.drop && (k.life -= dt) <= 0) { this.pickups.splice(i, 1); continue; }
      if (k.cd > 0) { k.cd -= dt; continue; }
      if (k.land > 0) {
        if ((k.land -= dt) <= 0) this.emit('land', { x: k.x, z: k.z });
        continue;
      }
      const p = this.actors.find(a => !a.isBot && !a.dead && Math.hypot(a.x - k.x, a.z - k.z) < 1.3);
      if (!p) continue;
      if (k.kind === 'care') {
        this.giveAmmo(p, true);
        p.hp = 100;
        this.pickups.splice(i, 1);
        this.emit('pickup', { a: p, kind: 'care' });
      } else if (this.giveAmmo(p, false)) {
        this.emit('pickup', { a: p, kind: 'ammo' });
        if (k.drop) this.pickups.splice(i, 1); else k.cd = 20;
      }
    }
  }

  end() {
    this.over = true;
    const { blue, red } = this.score;
    this.result = blue > red ? 'blue' : blue < red ? 'red' : 'draw';
    this.emit('end', { result: this.result });
  }

  resultFor(team) {
    return this.result === 'draw' ? 'draw' : this.result === team ? 'win' : 'loss';
  }

  // What the Django leaderboard records about one human's match.
  summaryFor(a) {
    return {
      map: this.mapDef.slug, weapon: a.loadout[0], difficulty: this.difficulty,
      kills: a.kills, deaths: a.deaths, score: a.xp, bestStreak: a.bestStreak,
      teamScore: this.score[a.team], enemyScore: this.score[other(a.team)], duration: Math.max(1, Math.round(this.time)),
    };
  }
}
