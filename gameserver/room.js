import { Match } from '../shared/match.js';
import { TICK } from '../shared/constants.js';
import { clamp } from '../shared/util.js';
import {
  SNAPSHOT_HZ, INTERMISSION, PERSONAL, unpackCommand, packActor, packSelf, packNade, packStrike, packPickup, packEvent, rosterEntry,
} from '../shared/protocol.js';

const SNAPSHOT_EVERY = Math.round(1 / TICK / SNAPSHOT_HZ);   // ticks between snapshots
export const MAX_HUMANS = 10;
const MAX_QUEUE = 30;             // buffered commands per player
const BUDGET = 6;                 // commands a player may catch up on in one tick; refills one per tick (no speed hacks)
const REWIND = 0.6;               // furthest back lag compensation will look (seconds)

/** One room: a match that runs continuously, rotating maps, with humans joining and leaving and bots filling gaps. */
export class Room {
  constructor({ code, isPrivate, data, onResults, onEmpty }) {
    Object.assign(this, { code, isPrivate, data, onResults, onEmpty });
    this.clients = new Set();
    this.mapIndex = Math.floor(Math.random() * data.maps.length);
    this.intermission = 0;
    this.ticks = 0;
    this.newMatch();
    this.last = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.loop(), 4);   // fine-grained timer; loop() runs whole fixed ticks
  }

  get full() { return this.clients.size >= MAX_HUMANS; }

  newMatch() {
    const map = this.data.maps[this.mapIndex % this.data.maps.length];
    this.M = new Match(this.data, { map: map.slug, limit: this.data.match.defaultScoreLimit, difficulty: 1, lagComp: true });
    for (const c of this.clients) {
      c.actor = this.M.addHuman(c.name, this.M.teamForNewHuman(), c.primary, c.playerId, c.optic);
      c.queue.length = 0;
    }
    this.M.balanceBots(this.data.match.teamSize);
    this.M.emit('start', {});
    this.intermission = 0;
    for (const c of this.clients) this.welcome(c, 'map');
  }

  welcome(c, type = 'welcome') {
    const M = this.M;
    c.send({
      t: type, you: c.actor.id, code: this.isPrivate ? this.code : null, map: M.mapDef.slug, limit: M.limit, difficulty: M.difficulty,
      time: M.time, left: M.left, roster: M.actors.map(rosterEntry), loadout: c.actor.loadout,
      over: M.over, intermission: Math.max(0, this.intermission),   // joining between matches
    });
  }

  broadcastRoster() {
    const msg = JSON.stringify({ t: 'roster', roster: this.M.actors.map(rosterEntry) });
    for (const c of this.clients) c.sendRaw(msg);
  }

  join(c) {
    if (this.full) return false;
    this.clients.add(c);
    c.room = this;
    c.actor = this.M.addHuman(c.name, this.M.teamForNewHuman(), c.primary, c.playerId, c.optic);
    this.M.balanceBots(this.data.match.teamSize);   // a bot on that team makes room
    this.welcome(c);
    this.broadcastRoster();
    console.log(`room ${this.code}: ${c.name} joined (${this.clients.size} humans)`);
    return true;
  }

  leave(c) {
    if (!this.clients.delete(c)) return;
    if (c.actor) this.M.removeActor(c.actor);
    this.M.balanceBots(this.data.match.teamSize);   // a bot takes the empty slot
    this.broadcastRoster();
    console.log(`room ${this.code}: ${c.name} left (${this.clients.size} humans)`);
    if (!this.clients.size) this.onEmpty(this);
  }

  onMessage(c, msg) {
    if (msg.t === 'in' && Array.isArray(msg.c)) {
      for (const raw of msg.c.slice(0, 8)) {
        const cmd = unpackCommand(raw);
        if (cmd && cmd.seq > c.lastSeq) { c.queue.push(cmd); c.lastSeq = cmd.seq; }
      }
      if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
    } else if (msg.t === 'ping' && Number.isFinite(msg.id)) {
      c.send({ t: 'pong', id: msg.id, tm: this.M.time });
    }
  }

  loop() {
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.step();
    }
  }

  step() {
    const M = this.M;
    if (this.intermission > 0) {
      if ((this.intermission -= TICK) <= 0) { this.mapIndex++; this.newMatch(); }
      return;
    }
    // each player's commands are applied in order, with targets rewound to what that player was seeing
    for (const c of this.clients) {
      c.budget = Math.min(BUDGET, c.budget + 1);
      while (c.queue.length && c.budget >= 1) {
        const cmd = c.queue.shift();
        c.budget--;
        M.applyCommand(c.actor, cmd, TICK, clamp(cmd.viewTime, M.time - REWIND, M.time));
        c.ack = cmd.seq;
      }
    }
    M.tick();
    if (++this.ticks % SNAPSHOT_EVERY === 0 || M.over) this.snapshot();
    if (M.over) {
      this.intermission = INTERMISSION;
      this.onResults(this, M);
    }
  }

  // State everyone shares is serialised once; each player then gets their own private block and events.
  snapshot() {
    const M = this.M, events = M.events;
    M.events = [];
    const shared = events.filter(e => !PERSONAL.has(e.type)).map(packEvent);
    const head = JSON.stringify({
      t: 's', tm: Math.round(M.time * 1000) / 1000, lf: Math.round(M.left * 10) / 10, sc: [M.score.blue, M.score.red],
      uv: [Math.ceil(M.uav.blue), Math.ceil(M.uav.red)], ac: M.actors.map(packActor), nd: M.nades.map(packNade),
      st: M.strikes.map(packStrike), pk: M.pickups.map(packPickup),
    }).slice(0, -1);
    for (const c of this.clients) {
      const mine = events.filter(e => PERSONAL.has(e.type) && e.a === c.actor).map(packEvent);
      c.sendRaw(`${head},"me":${JSON.stringify(packSelf(c.actor))},"ak":${c.ack},"ev":${JSON.stringify(mine.length ? shared.concat(mine) : shared)}}`);
    }
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.clients) c.ws.close(1001, 'room closed');
    this.clients.clear();
  }
}
