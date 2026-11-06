// Frontline Ops game server: WebSocket rooms running the shared match rules at 60 Hz.
import http from 'node:http';
import { randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { loadConfig, lookupPlayer, saveResults } from './django.js';

const PORT = Number(process.env.PORT) || 8081;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 50;
const MESSAGES_PER_SECOND = 90;    // a client sends ~30; anything far above is dropped
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CALLSIGN = /^[A-Za-z0-9 _.-]{1,12}$/;

const data = await loadConfig();
if (Number(process.env.MATCH_SECONDS) > 0) data.match.timeLimit = Number(process.env.MATCH_SECONDS);   // optional shorter matches
console.log(`config loaded: ${data.maps.length} maps, ${Object.keys(data.weapons).length} weapons, ${data.match.timeLimit}s matches`);
const rooms = new Map();

function newCode() {
  let code;
  do code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  while (rooms.has(code));
  return code;
}

function createRoom(isPrivate) {
  const room = new Room({
    code: newCode(), isPrivate, data,
    onResults: (r, M) => {
      const matches = [...r.clients].filter(c => c.playerId && c.actor).map(c => ({ player: c.playerId, ...M.summaryFor(c.actor) }));
      saveResults(matches).then(res => res && console.log(`room ${r.code}: saved ${res.saved} results`));
    },
    // keep an empty room briefly so a player who drops can rejoin, then free it
    onEmpty: r => setTimeout(() => { if (!r.clients.size && rooms.get(r.code) === r) { r.close(); rooms.delete(r.code); } }, 30000),
  });
  rooms.set(room.code, room);
  console.log(`room ${room.code} created (${isPrivate ? 'private' : 'public'})`);
  return room;
}

class Client {
  constructor(ws, ip) {
    Object.assign(this, { ws, ip, room: null, actor: null, name: 'Ghost', primary: 'ar', optic: null, playerId: null });
    this.queue = [];
    this.lastSeq = -1;
    this.ack = -1;
    this.budget = 0;
    this.window = Date.now();
    this.count = 0;
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  sendRaw(text) { if (this.ws.readyState === 1 && this.ws.bufferedAmount < 1 << 20) this.ws.send(text); }
  allowed() {
    const now = Date.now();
    if (now - this.window > 1000) { this.window = now; this.count = 0; }
    return ++this.count <= MESSAGES_PER_SECOND;
  }
}

async function handleJoin(c, msg) {
  c.name = typeof msg.name === 'string' && CALLSIGN.test(msg.name.trim()) ? msg.name.trim() : 'Ghost';
  c.primary = data.primaries.includes(msg.primary) ? msg.primary : data.primaries[0];
  c.optic = typeof msg.optic === 'string' ? msg.optic : null;   // Match.addHuman falls back to the weapon's default
  const callsign = await lookupPlayer(msg.player);   // results are only saved for real anonymous profiles
  if (callsign) { c.playerId = msg.player; c.name = callsign; }
  if (c.ws.readyState !== 1) return;
  let room;
  if (msg.mode === 'join') {
    room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return c.send({ t: 'err', m: 'Room not found. Check the code.' });
    if (room.full) return c.send({ t: 'err', m: 'That room is full.' });
  } else if (msg.mode === 'create') {
    if (rooms.size >= MAX_ROOMS) return c.send({ t: 'err', m: 'The server is busy. Try again soon.' });
    room = createRoom(true);
  } else {
    room = [...rooms.values()].filter(r => !r.isPrivate && !r.full && r.intermission <= 0).sort((a, b) => b.clients.size - a.clients.size)[0];
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return c.send({ t: 'err', m: 'The server is busy. Try again soon.' });
      room = createRoom(false);
    }
  }
  room.join(c);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const players = [...rooms.values()].reduce((n, r) => n + r.clients.size, 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  const c = new Client(ws, req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress);
  let joining = false;
  ws.on('message', raw => {
    if (!c.allowed()) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { ws.close(1003, 'bad message'); return; }
    if (c.room) c.room.onMessage(c, msg);
    else if (msg.t === 'join' && !joining) {
      joining = true;
      handleJoin(c, msg).catch(err => { console.error(err); c.send({ t: 'err', m: 'Could not join.' }); });
    }
  });
  ws.on('close', () => c.room?.leave(c));
  ws.on('error', () => {});
});

server.listen(PORT, () => console.log(`game server listening on :${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const r of rooms.values()) r.close(); server.close(() => process.exit(0)); });
