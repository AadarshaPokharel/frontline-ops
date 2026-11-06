import { Match } from '@shared/match.js';
import { TICK } from '@shared/constants.js';
import { angDiff, lerp } from '@shared/util.js';
import { INTERP_DELAY, INTERMISSION, packCommand, unpackActor, unpackSelf, unpackNade, unpackStrike, unpackPickup } from '@shared/protocol.js';

const SEND_EVERY = 2;   // ticks of input per message (30 messages a second)
// Your own shots, reloads etc. are shown immediately from prediction, so the server's copies are skipped.
const PREDICTED = new Set(['shot', 'reload', 'reloaded', 'swap', 'throw', 'knife', 'empty', 'noammo']);

function blankActor(r) {
  return {
    id: r.id, name: r.name, team: r.team, isBot: r.bot, loadout: r.loadout, optics: r.optics || r.loadout.map(() => 'iron'),
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, crouchT: 0, hp: 100, dead: false, respawn: 0,
    kills: 0, deaths: 0, xp: 0, streak: 0, bestStreak: 0, wp: r.loadout.map(id => ({ id, mag: 0, res: 0 })), cur: 0,
    reloadT: 0, reloadMax: 1, cd: 0, swapT: 0, flash: 0, gren: 0, melee: 0, knifeT: 0, moving: false, sprinting: false,
    ads: false, spotted: 0, lastHit: -99,
  };
}

/**
 * Online play. The server is authoritative; this client predicts its own soldier with the shared rules
 * (replaying unacknowledged input after each snapshot) and draws everyone else slightly in the past,
 * interpolated between snapshots. Exposes the same shape as LocalSession: M, me, step(), drain(), update().
 */
export class NetSession {
  static connect(data, opts) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      const timer = setTimeout(() => { ws.onclose = null; ws.close(); reject(new Error('the game server did not answer')); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', mode: opts.mode, code: opts.code, name: opts.name, primary: opts.primary, optic: opts.optic, player: opts.player }));
      ws.onclose = () => { clearTimeout(timer); reject(new Error('could not reach the game server')); };
      ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.t === 'err') { clearTimeout(timer); ws.onclose = null; ws.close(); reject(new Error(msg.m)); }
        else if (msg.t === 'welcome') { clearTimeout(timer); resolve(new NetSession(data, ws, msg)); }
      };
    });
  }

  constructor(data, ws, welcome) {
    this.online = true;
    this.data = data;
    this.ws = ws;
    this.code = welcome.code;
    this.seq = 0;
    this.offset = null;    // server clock minus local clock (seconds)
    this.events = [];
    this.known = new Map();   // every actor seen, so kill-feed names survive people leaving
    this.onMapChange = null;
    this.onClose = null;
    this.setup(welcome);
    ws.onmessage = ev => this.receive(JSON.parse(ev.data));
    ws.onclose = ev => { this.closed = true; this.onClose?.(ev.reason || 'Disconnected from the game server.'); };
  }

  // A (new) match: rebuild the prediction sandbox and the mirrored world state.
  setup(w) {
    const mine = w.roster.find(r => r.id === w.you);
    this.mapSlug = w.map;
    this.P = new Match(this.data, { map: w.map, limit: w.limit, difficulty: w.difficulty, noPickups: true });
    this.me = this.P.addHuman(mine.name, mine.team, mine.loadout[0], null, mine.optics?.[0]);
    this.me.id = w.you;
    this.P.events.length = 0;
    this.pending = [];
    this.outbox = [];
    this.snaps = [];
    this.actors = new Map();
    const P = this.P;
    this.M = {
      data: this.data, weapons: this.data.weapons, mapDef: P.mapDef, world: P.world, limit: w.limit, timeLimit: this.data.match.timeLimit,
      actors: [], nades: [], strikes: [], pickups: [], score: { blue: 0, red: 0 }, uav: { blue: 0, red: 0 },
      time: w.time, left: w.left, over: !!w.over, result: null,
      resultFor(team) { return this.result === 'draw' ? 'draw' : this.result === team ? 'win' : 'loss'; },
    };
    this.wait = w.over ? w.intermission : 0;   // seconds until the next match, when joining between matches
    this.applyRoster(w.roster);
    if (!w.over) this.events.push({ type: 'start' });
  }

  applyRoster(roster) {
    const ids = new Set();
    for (const r of roster) {
      ids.add(r.id);
      this.known.set(r.id, r);
      if (r.id === this.me.id) continue;
      const a = this.actors.get(r.id);
      if (!a) this.actors.set(r.id, blankActor(r));
      else Object.assign(a, { name: r.name, team: r.team, isBot: r.bot });
    }
    for (const id of [...this.actors.keys()]) if (!ids.has(id)) this.actors.delete(id);
    this.M.actors = [this.me, ...this.actors.values()];
  }

  actor(id) {
    if (id === null || id === undefined) return null;
    if (id === this.me.id) return this.me;
    const a = this.actors.get(id);
    if (a) return a;
    const r = this.known.get(id);
    return { id, name: r?.name || 'Player', team: r?.team || 'red', dead: true, isBot: !!r?.bot, wp: [{ id: 'ar' }], cur: 0, x: 0, y: 0, z: 0 };
  }

  // Match time of what is currently drawn for other players (also sent to the server for lag compensation).
  renderTime() {
    return this.offset === null ? this.M.time : performance.now() / 1000 + this.offset - INTERP_DELAY;
  }

  step(cmd) {
    if (this.closed || this.M.over) return;   // between matches nothing moves
    const seq = ++this.seq, viewTime = this.renderTime();
    cmd.seq = seq;
    this.pending.push(cmd);
    this.P.applyCommand(this.me, cmd, TICK, viewTime);   // predict: movement, ammo, and tracers into the map
    for (const e of this.P.events) this.events.push(e);
    this.P.events.length = 0;
    this.outbox.push(packCommand(cmd, seq, viewTime));
    if (this.outbox.length >= SEND_EVERY && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ t: 'in', c: this.outbox }));
      this.outbox = [];
    }
  }

  receive(msg) {
    if (msg.t === 's') this.snapshot(msg);
    else if (msg.t === 'roster') this.applyRoster(msg.roster);
    else if (msg.t === 'map') { this.setup(msg); this.onMapChange?.(msg.map); }
  }

  snapshot(s) {
    const now = performance.now() / 1000, off = s.tm - now;
    // keep the least-delayed clock sample, drifting slowly so a clock change is followed
    this.offset = this.offset === null ? off : Math.max(off, this.offset - 0.002);
    this.snaps.push({ tm: s.tm, actors: new Map(s.ac.map(p => [p[0], p])), nades: s.nd });
    if (this.snaps.length > 40) this.snaps.shift();
    const M = this.M;
    M.score.blue = s.sc[0]; M.score.red = s.sc[1];
    M.uav.blue = s.uv[0]; M.uav.red = s.uv[1];
    M.left = s.lf;
    M.strikes = s.st.map(unpackStrike);
    M.pickups = s.pk.map(unpackPickup);
    for (const p of s.ac) {
      if (p[0] === this.me.id) { [, , , , , , , , , , , , this.me.kills, this.me.deaths, this.me.xp] = p; continue; }
      const a = this.actors.get(p[0]);
      if (a) unpackActor(p, a);
    }
    // reconcile: take the server's state for your soldier and replay the input it has not processed yet
    const me = this.me;
    this.pending = this.pending.filter(c => c.seq > s.ak);
    unpackSelf(s.me, me);
    if (!me.dead) {
      this.P.silent = true;
      for (const c of this.pending) this.P.applyCommand(me, c, TICK);
      this.P.silent = false;
    }
    for (const raw of s.ev) {
      if (PREDICTED.has(raw.type) && raw.a === me.id) continue;
      const e = { ...raw, a: this.actor(raw.a), v: this.actor(raw.v), att: this.actor(raw.att) };
      if (e.type === 'shot' && e.a) e.a.flash = 0.06;
      if (e.type === 'kill' && e.v === me) me.dead = true;
      if (e.type === 'end') { M.over = true; M.result = e.result; this.wait = INTERMISSION; }
      this.events.push(e);
    }
  }

  // Draw other players and grenades between the two snapshots around the render time.
  update(dt) {
    this.wait = Math.max(0, this.wait - dt);
    const snaps = this.snaps;
    if (!snaps.length) return;
    const t = this.renderTime();
    let a = snaps[0], b = null;
    for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].tm <= t) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    const k = b ? Math.min(1, (t - a.tm) / (b.tm - a.tm)) : 0;
    for (const actor of this.actors.values()) {
      const pa = a.actors.get(actor.id), pb = b?.actors.get(actor.id) || pa;
      if (!pa) continue;
      actor.x = lerp(pa[1], pb[1], k);
      actor.y = lerp(pa[2], pb[2], k);
      actor.z = lerp(pa[3], pb[3], k);
      actor.yaw = pa[4] + angDiff(pb[4], pa[4]) * k;
      actor.pitch = lerp(pa[5], pb[5], k);
      actor.crouchT = lerp(pa[9], pb[9], k);
      actor.flash -= dt;
    }
    const nb = new Map((b?.nades || []).map(n => [n[0], n]));
    this.M.nades = a.nades.map(n => {
      const g = unpackNade(n), m = nb.get(g.id);
      if (m) { g.x = lerp(g.x, m[1], k); g.y = lerp(g.y, m[2], k); g.z = lerp(g.z, m[3], k); }
      return g;
    });
    this.M.time = Math.max(this.M.time, t);
  }

  drain(fn) {
    const events = this.events;
    this.events = [];
    for (const e of events) fn(e);
  }

  leave() {
    this.onClose = null;
    this.closed = true;
    this.ws.close(1000, 'left');
  }
}
