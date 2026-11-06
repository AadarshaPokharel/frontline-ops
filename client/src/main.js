import './styles.css';
import { TICK } from '@shared/constants.js';
import { rand } from '@shared/util.js';
import { api, cleanCallsign, Profile } from './api.js';
import { LocalSession } from './session.js';
import { NetSession } from './net.js';
import { GameView } from './render/view.js';
import { Hud, scoreTable } from './ui/hud.js';
import { buildMenu, renderLeaderboard, renderRecord } from './ui/menu.js';
import { Input } from './input.js';
import { Sound } from './audio.js';

const $ = id => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);

const CFG_KEY = 'frontline_cfg';
const cfg = { map: 'warehouse', primary: 'ar', diff: 1, hq: true, name: 'Ghost', limit: 30, sens: 2, fov: 78, optics: {} };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY)) || {}); } catch { /* storage unavailable */ }
if (typeof cfg.optics !== 'object' || !cfg.optics) cfg.optics = {};   // chosen sight per weapon
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ } };

let view;
try {
  view = new GameView($('gl'));
} catch (err) {
  setLoading('This browser cannot run 3D graphics (WebGL is off or unsupported). Try an up-to-date Chrome, Edge or Firefox with hardware acceleration enabled.');
  throw err;
}
const hud = new Hud($('hud'));
const input = new Input($('gl'));
const sound = new Sound();
const profile = new Profile();
let data = null, session = null, state = 'loading';

const mapDef = slug => data.maps.find(m => m.slug === slug) || data.maps[0];

function setLoading(text, fraction) {
  $('loading-text').textContent = text;
  if (fraction !== undefined) $('loading-bar').style.width = `${Math.round(fraction * 100)}%`;
}

function menuError(message) {
  $('menu-error').textContent = message;
  show('menu-error', !!message);
}

function applySettings() {
  saveCfg();
  view.setQuality(cfg.hq);
  view.baseFov = cfg.fov;
  input.sensitivity = cfg.sens;
}

async function boot() {
  try {
    setLoading('Contacting HQ…', 0.05);
    data = await api.config();
    if (!data.maps.some(m => m.slug === cfg.map)) cfg.map = data.maps[0].slug;
    if (!data.primaries.includes(cfg.primary)) cfg.primary = data.primaries[0];
    if (!data.difficulties[cfg.diff]) cfg.diff = 1;
    if (!data.match.scoreLimits.includes(cfg.limit)) cfg.limit = data.match.defaultScoreLimit;
    applySettings();
    await view.assets.loadModels(f => setLoading('Loading models…', 0.1 + f * 0.5));
    setLoading('Loading soldiers…', 0.65);
    await view.assets.loadCharacters();
    setLoading('Building map…', 0.75);
    await view.loadMap(mapDef(cfg.map));
    buildMenu(data, cfg, {
      onChange: applySettings,
      onMap: m => view.loadMap(m),
      onLeaderboard: refreshBoards,
      onPractice: practice,
      onQuick: () => online('quick'),
      onCreate: () => online('create'),
      onJoin: code => online('join', code),
    });
    show('loading', false);
    show('menu', true);
    state = 'menu';
    refreshBoards();
  } catch (err) {
    console.error(err);
    setLoading(`Could not start: ${err.message}. Is the server running?`);
  }
}

async function refreshBoards() {
  renderRecord(await profile.refresh());
  try {
    renderLeaderboard((await api.leaderboard($('lb-map').value, $('lb-period').value, profile.id)).rows);
  } catch {
    renderLeaderboard(null);
  }
}

function prepare() {
  sound.init();
  cfg.name = cleanCallsign(cfg.name);
  $('name').value = cfg.name;
  saveCfg();
  menuError('');
}

async function practice() {
  prepare();
  await view.loadMap(mapDef(cfg.map));
  start(new LocalSession(data, cfg));
  profile.ensure(cfg.name).catch(() => {});   // register in the background; results are saved at the end
}

async function online(mode, code) {
  prepare();
  if (mode === 'join' && !/^[A-Z0-9]{4,6}$/.test(code || '')) { menuError('Enter the room code you were given.'); return; }
  const buttons = ['quick', 'create', 'join', 'deploy'].map($);
  buttons.forEach(b => { b.disabled = true; });
  try {
    await profile.ensure(cfg.name).catch(() => {});
    const s = await NetSession.connect(data, { mode, code, name: cfg.name, primary: cfg.primary, optic: cfg.optics[cfg.primary], player: profile.id });
    await view.loadMap(mapDef(s.mapSlug));
    s.onMapChange = async slug => {
      await view.loadMap(mapDef(slug));
      view.attach(s.M, s.me);
      hud.reset(s.M, s.me);
      if (state === 'over') {   // straight into the next match; clicking the game captures the mouse again
        show('end', false);
        state = 'play';
        input.enabled = true;
      }
    };
    s.onClose = reason => { if (session === s) { toMenu(); menuError(reason); } };
    start(s);
  } catch (err) {
    menuError(`Could not join: ${err.message}`);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

function start(s) {
  session = s;
  view.attach(s.M, s.me);
  hud.reset(s.M, s.me);
  input.release();
  input.yaw = s.me.yaw;
  input.pitch = 0;
  input.crouch = false;
  input.enabled = true;
  for (const id of ['menu', 'end', 'pause']) show(id, false);
  $('room-code').textContent = s.code ? `ROOM ${s.code}` : '';
  show('room-code', !!s.code);
  state = 'play';
  input.lock();
}

function onEvent(e) {
  const M = session.M, me = session.me;
  view.onEvent(e);
  hud.onEvent(e, M);
  sound.onEvent(e, M, me, input.yaw);
  if (e.type === 'shot' && e.a === me) {
    // recoil kicks your aim; you pull it back down
    const w = M.weapons[e.wid], k = w.recoil * (me.ads ? 0.7 : 1) * (me.crouchT > 0.5 ? 0.8 : 1);
    input.pitch = Math.min(1.45, input.pitch + k * rand(0.8, 1.2));
    input.yaw += k * rand(-0.4, 0.4);
  } else if (e.type === 'spawn' && e.a === me) {
    input.yaw = me.yaw;
    input.pitch = 0;
    input.crouch = false;
  } else if (e.type === 'end') endMatch(e);
}

async function endMatch() {
  const s = session, M = s.M, me = s.me, result = M.resultFor(me.team), title = $('result'), status = $('save-status');
  state = 'over';
  input.unlock();
  input.enabled = false;
  title.textContent = { win: 'VICTORY', loss: 'DEFEAT', draw: 'DRAW' }[result];
  title.className = result === 'draw' ? '' : result;
  $('finalscore').innerHTML = scoreTable(M, me);
  show('score', false);
  show('end', true);
  if (s.online) {
    status.textContent = 'Results saved by the server · next match starting soon';
    $('again').textContent = 'STAY FOR NEXT MATCH';
    return;
  }
  $('again').textContent = 'PLAY AGAIN';
  status.textContent = 'Saving to leaderboard…';
  try {
    const stats = await profile.submit(M.summaryFor(me), cfg.name);
    status.textContent = stats.rank ? `Saved · leaderboard rank #${stats.rank}` : 'Saved';
    renderRecord(stats);
  } catch (err) {
    status.textContent = `Not saved: ${err.message}`;
  }
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  $('pause-note').textContent = session?.online ? 'The match keeps going while you are away' : '';
  $('pause-code').textContent = session?.code || '';
  show('pause-room', !!session?.code);
  show('pause', true);
}

// Copy the room code to share it. Plain http on a network address has no clipboard API, so fall back to a selection copy.
async function copyCode() {
  const code = session?.code, btn = $('copy-code');
  if (!code) return;
  let ok = true;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    const t = Object.assign(document.createElement('textarea'), { value: code });
    document.body.append(t);
    t.select();
    ok = document.execCommand('copy');
    t.remove();
  }
  btn.textContent = ok ? 'COPIED' : 'COPY FAILED';
  setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
}

function resume() {
  if (state !== 'paused') return;
  show('pause', false);
  state = 'play';
  input.lock();
}

function toMenu() {
  session?.leave();
  session = null;
  state = 'menu';
  input.unlock();
  input.enabled = false;
  view.detach();
  hud.clear();
  for (const id of ['end', 'pause', 'score', 'room-code']) show(id, false);
  show('menu', true);
  refreshBoards();
}

input.onUnlock = pause;
addEventListener('keydown', e => {
  if (state !== 'play') return;
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'KeyP') { input.unlock(); return; }
  input.press(e);
});
addEventListener('resize', () => { view.resize(); hud.resize(); });
$('gl').addEventListener('click', () => { if (state === 'play') input.lock(); });
$('resume').onclick = resume;
$('quit').onclick = toMenu;
$('copy-code').onclick = copyCode;
$('again').onclick = () => {
  if (session?.online) { show('end', false); state = 'play'; input.enabled = true; input.lock(); return; }
  practice();
};
$('tomenu').onclick = toMenu;

const IDLE = { f: 0, s: 0, fire: false, ads: false, sprint: false, crouch: false, jump: false, actions: [] };
let last = performance.now(), acc = 0, scoreShown = false, scoreRefreshed = 0;
let capturing = false, captureClock = 0, captureAcc = 0;   // offline rendering for recording videos
function frame(now) {
  if (capturing) { requestAnimationFrame(frame); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const running = session && (state === 'play' || (session.online && state !== 'menu'));   // online matches never pause
  if (running) {
    acc += dt;
    let steps = 0;
    for (; acc >= TICK && steps < 6; steps++, acc -= TICK) {
      const cmd = state === 'play' ? input.command() : { ...IDLE, yaw: input.yaw, pitch: input.pitch };
      session.step(cmd, now);
      session.drain(onEvent);
      if (!session) break;   // the match was left from inside an event handler
    }
    if (steps === 6) acc = 0;   // far behind (tab was hidden): drop the backlog instead of fast-forwarding
    session?.update(dt, now);
    hud.update(dt);
  }
  input.zoom = view.fov / view.baseFov;   // lower sensitivity while zoomed in
  view.update(running || state === 'menu' ? dt : 0, { yaw: input.yaw, pitch: input.pitch, lookX: input.lookX, lookY: input.lookY }, now / 1000);
  input.lookX = input.lookY = 0;
  view.render();
  if (session && state !== 'menu') {
    const message = state !== 'play' ? '' : session.online && session.M.over ? `Next match starts in ${Math.ceil(session.wait)} s`
      : !input.locked && !session.me.dead ? 'Click to play' : '';
    hud.draw(session.M, view, input.yaw, { message, code: session.code });
  } else hud.clear();

  const wantScore = !!session && state === 'play' && !!input.keys.Tab;
  if (wantScore !== scoreShown) { scoreShown = wantScore; show('score', wantScore); }
  if (wantScore && now - scoreRefreshed > 250) { scoreRefreshed = now; $('score').innerHTML = scoreTable(session.M, session.me); }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
boot();

// Handy from devtools, and lets automated tests play on machines that render slowly.
window.FrontlineOps = {
  get session() { return session; },
  get state() { return state; },
  view,
  input,
  // Advance `seconds` of game time in fixed steps with an optional command override (works without pointer lock).
  simulate(seconds, cmd = {}) {
    for (let t = 0; t < seconds && session; t += TICK) {
      session.step({ ...IDLE, yaw: input.yaw, pitch: input.pitch, ...cmd, actions: t === 0 ? [...(cmd.actions || [])] : [] });
      session.drain(onEvent);
      hud.update(TICK);
      view.update(TICK, { yaw: input.yaw, pitch: input.pitch, lookX: 0, lookY: 0 }, performance.now() / 1000);
    }
  },
  // Offline rendering (used to record the trailer): stop the real-time loop and draw exact frames on request.
  capture(on) {
    capturing = on;
    hud.showFps = !on;
    last = performance.now();
  },
  renderFrame(dt, cmd = {}) {
    captureClock += dt;
    if (session && state === 'play') {
      captureAcc += dt;
      let first = true;
      for (; captureAcc >= TICK - 1e-9; captureAcc -= TICK) {
        session.step({ ...IDLE, yaw: input.yaw, pitch: input.pitch, ...cmd, actions: first ? [...(cmd.actions || [])] : [] });
        first = false;
        session.drain(onEvent);
      }
      hud.update(dt);
    }
    input.zoom = view.fov / view.baseFov;
    view.update(dt, { yaw: input.yaw, pitch: input.pitch, lookX: cmd.lookX || 0, lookY: cmd.lookY || 0 }, captureClock);
    view.render();
    if (session && state !== 'menu') hud.draw(session.M, view, input.yaw); else hud.clear();
  },
};
