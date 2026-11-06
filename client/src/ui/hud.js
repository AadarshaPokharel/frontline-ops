import { TILE } from '@shared/constants.js';
import { eyeHeight } from '@shared/movement.js';
import { TAU, angDiff, yawTo } from '@shared/util.js';

const FONT = '"Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif';
const BANNERS = {
  uav: ['UAV ONLINE', 'Enemy positions revealed on the minimap'],
  care: ['CARE PACKAGE INBOUND', 'Grab it for a full resupply'],
  air: ['AIRSTRIKE INBOUND', 'Danger close — stay clear of the red markers'],
};
const STREAK_SHORT = { uav: 'UAV', care: 'CARE', air: 'AIR' };
const MINIMAP_METRES = 64;   // width of world shown on the minimap

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function scoreTable(M, me) {
  const row = a => `<tr class="${a === me ? 'me' : ''}"><td>${esc(a.name)}${a.isBot ? ' <small>BOT</small>' : ''}</td><td>${a.xp}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${(a.kills / Math.max(1, a.deaths)).toFixed(2)}</td></tr>`;
  const team = (t, label) => `<tr><td class="t ${t}" colspan="5">${label} — ${M.score[t]}</td></tr>` +
    '<tr><th>Player</th><th>Score</th><th>K</th><th>D</th><th>K/D</th></tr>' +
    M.actors.filter(a => a.team === t).sort((a, b) => b.xp - a.xp).map(row).join('');
  return `<table class="sb">${team('blue', 'RANGERS')}${team('red', 'OPFOR')}</table>`;
}

function makeMinimap(M) {
  const { world } = M, colors = M.mapDef.theme.mini, s = 6, c = document.createElement('canvas');
  c.width = world.w * s;
  c.height = world.h * s;
  const g = c.getContext('2d');
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    const ch = world.grid[y][x];
    g.fillStyle = ch === '#' ? colors.wall : ch === 'c' || ch === 'C' ? colors.cover : colors.floor;
    g.fillRect(x * s, y * s, s, s);
  }
  return c;
}

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.frameMs = 16.7;
    this.lastDraw = 0;
    this.showFps = true;
    this.resize();
    this.reset(null, null);
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio, 2);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
  }

  reset(M, me) {
    this.me = me;
    this.feed = [];
    this.popups = [];
    this.banner = null;
    this.hitmark = 0;
    this.hitKill = false;
    this.hitHead = false;
    this.dmgInd = [];
    this.mini = M ? makeMinimap(M) : null;
  }

  popup(text, color, big = false) {
    const t = big ? 1.8 : 1.2;
    this.popups.push({ text, color, big, t, max: t });
    if (this.popups.length > 5) this.popups.shift();
  }

  onEvent(e, M) {
    const me = this.me;
    switch (e.type) {
      case 'start':
        this.banner = { text: 'TEAM DEATHMATCH', sub: `${M.mapDef.name}  ·  First to ${M.limit}`, t: 3.2 };
        break;
      case 'hit':
        if (e.att === me && e.v !== me) { this.hitmark = 0.18; this.hitKill = false; this.hitHead = e.head; }
        if (e.v === me && e.att && e.att !== me) this.dmgInd.push({ att: e.att, x: e.att.x, z: e.att.z, t: 1.3 });
        break;
      case 'kill':
        this.feed.unshift({ a: e.att, v: e.v, w: e.weapon, head: e.head, t: 6 });
        if (this.feed.length > 6) this.feed.pop();
        if (e.att === me) { this.hitmark = 0.3; this.hitKill = true; this.popup(e.head ? '+150  HEADSHOT' : '+100  KILL', '#ffe08a'); }
        if (e.v === me) this.dmgInd.length = 0;
        break;
      case 'multikill':
        if (e.a === me && e.bonus) this.popup(`${e.label}  +${e.bonus}`, '#ffb347', true);
        break;
      case 'streak':
        if (e.a === me || (e.id === 'uav' && e.a.team === me.team)) {
          const [text, sub] = BANNERS[e.id];
          this.banner = { text: e.a === me ? text : `FRIENDLY ${text}`, sub, t: 2.8 };
        }
        break;
      case 'teamswap':
        if (e.a === me) this.banner = { text: 'TEAMS BALANCED', sub: `A player left · you now fight for ${e.team === 'blue' ? 'the Rangers' : 'OPFOR'}`, t: 3.6 };
        break;
      case 'pickup':
        if (e.a === me) e.kind === 'care' ? this.popup('FULL RESUPPLY', '#7dff6e') : this.popup('+AMMO', '#c9e08a');
        break;
      case 'noammo':
        if (e.a === me) this.popup('NO AMMO — SWITCH WEAPON', '#ff5347');
        break;
    }
  }

  update(dt) {
    const tick = list => { for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1); };
    tick(this.feed);
    tick(this.popups);
    tick(this.dmgInd);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    this.hitmark -= dt;
  }

  clear() {
    this.c.setTransform(1, 0, 0, 1, 0, 0);
    this.c.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  text(s, x, y, color, size, align = 'left', bold = true) {
    const c = this.c;
    c.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillStyle = 'rgba(0,0,0,.7)';
    c.fillText(s, x + 1, y + 1);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  draw(M, view, yaw, extra = {}) {
    this.clear();
    const c = this.c, me = this.me, W = this.W, H = this.H, cx = W / 2, cy = H / 2;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (view.scoped) this.drawScope(view.reticle);
    if (!me.dead && me.hp < 70) {
      const g = c.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, `rgba(150,0,0,${(1 - me.hp / 70) * 0.65})`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    // red arcs point at whoever is shooting you, relative to where you are looking
    for (const d of this.dmgInd) {
      const src = d.att && !d.att.dead ? d.att : d, rel = angDiff(yawTo(src.x - me.x, src.z - me.z), yaw), an = -Math.PI / 2 - rel;
      c.strokeStyle = `rgba(255,40,30,${Math.min(1, d.t) * 0.85})`;
      c.lineWidth = 7;
      c.beginPath();
      c.arc(cx, cy, 110, an - 0.3, an + 0.3);
      c.stroke();
    }
    // grenade warnings
    for (const g of M.nades) {
      const d = Math.hypot(g.x - me.x, g.z - me.z);
      if (g.team === me.team || d > 10 || me.dead) continue;
      const an = -Math.PI / 2 - angDiff(yawTo(g.x - me.x, g.z - me.z), yaw), x = cx + Math.cos(an) * 150, y = cy + Math.sin(an) * 150;
      c.fillStyle = `rgba(255,50,40,${0.6 + 0.4 * Math.sin(M.time * 18)})`;
      c.beginPath(); c.arc(x, y, 15, 0, TAU); c.fill();
      this.text('!', x, y + 7, '#fff', 20, 'center');
    }

    // teammates' names; the enemy under your crosshair
    for (const a of M.actors) {
      if (a.dead || a === me || a.team !== me.team) continue;
      const s = view.project(a.x, eyeHeight(a) + 0.55, a.z);
      if (!s.behind) this.text(a.name, s.x, s.y, '#8cc8ff', 12, 'center');
    }
    const aimed = view.aimedAt();
    if (aimed && aimed.team !== me.team) this.text(aimed.name, cx, cy + 46, '#ff6a5c', 14, 'center');

    this.drawScore(M);
    this.drawFeed();
    this.drawMinimap(M, yaw);
    this.drawStatus(M);
    this.drawWeapon(M);
    if (!me.dead) this.drawCrosshair(M, view);
    else {
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.fillRect(0, 0, W, H);
      this.text(view.killer ? `KILLED BY ${view.killer.name.toUpperCase()}` : 'YOU DIED', cx, H * 0.38, '#ff5347', 34, 'center');
      this.text(`Respawning in ${Math.max(0, me.respawn).toFixed(1)}`, cx, H * 0.38 + 32, '#d6dccb', 18, 'center', false);
    }
    if (this.banner) {
      c.globalAlpha = Math.min(1, this.banner.t / 0.4);
      this.text(this.banner.text, cx, H * 0.22, '#ffb347', 40, 'center');
      this.text(this.banner.sub, cx, H * 0.22 + 28, '#d6dccb', 16, 'center', false);
      c.globalAlpha = 1;
    }
    if (extra.message) this.text(extra.message, cx, H * 0.3, '#ffb347', 18, 'center');
    if (M.waiting && !M.over) this.drawWaiting(extra.code);
    if (M.time < 12) {
      c.globalAlpha = Math.min(1, 12 - M.time);
      this.text('WASD move · Mouse look · LMB fire · RMB aim · Space jump · C crouch · Shift sprint · R reload · Q swap · G frag · V knife · Tab scores',
        cx, H - 150, '#d6dccb', 13, 'center', false);
      c.globalAlpha = 1;
    }
  }

  // Looking through a magnified optic: everything outside the lens is black, with the optic's reticle.
  drawScope(type) {
    const c = this.c, W = this.W, H = this.H, sniper = type === 'sniper', r = Math.min(W, H) * (sniper ? 0.42 : 0.36), cx = W / 2, cy = H / 2;
    c.fillStyle = '#000';
    c.beginPath();
    c.rect(0, 0, W, H);
    c.arc(cx, cy, r, 0, TAU, true);
    c.fill();
    const lens = c.createRadialGradient(cx, cy, r * 0.75, cx, cy, r);   // darker towards the tube walls
    lens.addColorStop(0, 'rgba(0,0,0,0)');
    lens.addColorStop(1, 'rgba(0,0,0,.75)');
    c.fillStyle = lens;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    if (sniper) {
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - r, cy); c.lineTo(cx + r, cy);
      c.moveTo(cx, cy - r); c.lineTo(cx, cy + r);
      c.stroke();
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(cx - r, cy); c.lineTo(cx - r * 0.12, cy); c.moveTo(cx + r * 0.12, cy); c.lineTo(cx + r, cy);
      c.moveTo(cx, cy + r * 0.12); c.lineTo(cx, cy + r);
      c.stroke();
      c.fillStyle = '#ff3b30';
      c.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      return;
    }
    // ACOG: lit red chevron with a drop line and range ticks
    c.strokeStyle = '#ff3b1f';
    c.fillStyle = '#ff3b1f';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(cx - 9, cy + 9); c.lineTo(cx, cy); c.lineTo(cx + 9, cy + 9);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.85)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx, cy + 14); c.lineTo(cx, cy + r * 0.55);
    for (let i = 1; i <= 4; i++) { const y = cy + 14 + i * r * 0.1, w = 8 - i; c.moveTo(cx - w, y); c.lineTo(cx + w, y); }
    c.moveTo(cx - r, cy); c.lineTo(cx - r * 0.25, cy); c.moveTo(cx + r * 0.25, cy); c.lineTo(cx + r, cy);
    c.stroke();
  }

  // Reticle drawn over the sight while aiming down sights with a non-magnified optic.
  drawReticle(type, cx, cy) {
    const c = this.c;
    if (type === 'holo') {
      c.strokeStyle = 'rgba(255,40,30,.9)';
      c.lineWidth = 1.6;
      c.beginPath(); c.arc(cx, cy, 11, 0, TAU); c.stroke();
      c.beginPath();
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { c.moveTo(cx + dx * 11, cy + dy * 11); c.lineTo(cx + dx * 15, cy + dy * 15); }
      c.stroke();
      c.fillStyle = '#ff2a1a';
      c.beginPath(); c.arc(cx, cy, 1.6, 0, TAU); c.fill();
    } else if (type === 'dot') {
      c.fillStyle = '#ff2a1a';
      c.beginPath(); c.arc(cx, cy, 2.4, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,60,40,.25)';
      c.beginPath(); c.arc(cx, cy, 4.5, 0, TAU); c.fill();
    } else if (type === 'iron') {
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(cx, cy, 1.4, 0, TAU); c.fill();
    }
  }

  // Online, until both teams have a player: the clock is stopped and the room code is up for sharing.
  drawWaiting(code) {
    const c = this.c, cx = this.W / 2, y = this.H * 0.36, h = code ? 112 : 70;
    c.fillStyle = 'rgba(6,9,5,.78)';
    c.fillRect(cx - 250, y, 500, h);
    c.fillStyle = '#ff8a1f';
    c.fillRect(cx - 250, y, 4, h);
    this.text('WAITING FOR PLAYERS', cx, y + 34, '#ffb347', 26, 'center');
    if (code) {
      this.text(`ROOM CODE  ${code}`, cx, y + 70, '#f2f2ea', 24, 'center');
      this.text('Friends type it next to JOIN in the menu  ·  Esc to copy it', cx, y + 96, '#98a889', 13, 'center', false);
    } else this.text('The match starts when someone joins the other team', cx, y + 56, '#98a889', 14, 'center', false);
  }

  drawScore(M) {
    const c = this.c, cx = this.W / 2, lim = M.limit, s = Math.max(0, Math.ceil(M.left));
    c.fillStyle = 'rgba(6,9,5,.72)';
    c.fillRect(cx - 165, 10, 330, 56);
    this.text(M.score.blue, cx - 100, 48, '#4aa3ff', 36, 'center');
    this.text(M.score.red, cx + 100, 48, '#ff5347', 36, 'center');
    this.text(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, cx, 40, s < 30 ? '#ff5347' : '#f2f2ea', 24, 'center');
    this.text(M.waiting ? 'WAITING' : `TDM · ${lim}`, cx, 56, M.waiting ? '#ffb347' : '#8a9a7b', 11, 'center', false);
    c.fillStyle = '#1f2b38'; c.fillRect(cx - 158, 60, 110, 3);
    c.fillStyle = '#4aa3ff'; c.fillRect(cx - 158, 60, 110 * Math.min(1, M.score.blue / lim), 3);
    c.fillStyle = '#3a1f1d'; c.fillRect(cx + 48, 60, 110, 3);
    c.fillStyle = '#ff5347'; c.fillRect(cx + 48, 60, 110 * Math.min(1, M.score.red / lim), 3);
  }

  drawFeed() {
    const c = this.c, me = this.me;
    const color = a => (a === me ? '#ffb347' : a.team === 'blue' ? '#4aa3ff' : '#ff5347');
    c.font = `bold 14px ${FONT}`;
    c.textAlign = 'left';
    this.feed.forEach((e, i) => {
      c.globalAlpha = Math.min(1, e.t);
      let x = 18;
      const y = 30 + i * 22;
      const seg = (str, col) => {
        c.fillStyle = 'rgba(0,0,0,.7)'; c.fillText(str, x + 1, y + 1);
        c.fillStyle = col; c.fillText(str, x, y);
        x += c.measureText(str).width + 6;
      };
      if (e.a) seg(e.a.name, color(e.a));
      seg(`[${e.w}${e.head ? ' ✛' : ''}]`, '#d6dccb');
      seg(e.v.name, color(e.v));
    });
    c.globalAlpha = 1;
  }

  // Rotates with your view, so "up" is always the way you are facing.
  drawMinimap(M, yaw) {
    const c = this.c, me = this.me, size = Math.min(200, this.W * 0.2), x0 = this.W - size - 16, y0 = 16, k = size / MINIMAP_METRES;
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.fillRect(x0 - 4, y0 - 4, size + 8, size + 8);
    c.save();
    c.beginPath(); c.rect(x0, y0, size, size); c.clip();
    c.translate(x0 + size / 2, y0 + size / 2);
    c.rotate(yaw);
    c.scale(k, k);
    c.translate(-me.x, -me.z);
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 0.9;
    c.drawImage(this.mini, 0, 0, M.world.w * TILE, M.world.h * TILE);
    c.globalAlpha = 1;
    const uav = M.uav[me.team] > 0;
    for (const a of M.actors) {
      if (a.dead || a === me) continue;
      if (a.team === me.team) c.fillStyle = '#4aa3ff';
      else if (uav || a.spotted > 0) c.fillStyle = '#ff5347';
      else continue;
      c.beginPath(); c.arc(a.x, a.z, 1.4, 0, TAU); c.fill();
    }
    c.restore();
    if (uav) {
      const ux = ((M.time * 120) % (size + 40)) - 20, g = c.createLinearGradient(x0 + ux - 30, 0, x0 + ux, 0);
      g.addColorStop(0, 'rgba(255,80,60,0)');
      g.addColorStop(1, 'rgba(255,80,60,.3)');
      c.fillStyle = g;
      c.fillRect(Math.max(x0, x0 + ux - 30), y0, Math.min(30, x0 + size - (x0 + ux - 30)), size);
    }
    // you: an arrow in the middle pointing up
    const mx = x0 + size / 2, my = y0 + size / 2;
    c.fillStyle = '#ffb347';
    c.beginPath(); c.moveTo(mx, my - 8); c.lineTo(mx - 5, my + 5); c.lineTo(mx + 5, my + 5); c.closePath(); c.fill();
    c.strokeStyle = '#3d4a34';
    c.lineWidth = 1;
    c.strokeRect(x0 - 4, y0 - 4, size + 8, size + 8);
    this.text(M.mapDef.name.toUpperCase(), x0, y0 + size + 18, '#8a9a7b', 11, 'left', false);
    if (uav) this.text(`UAV ${Math.ceil(M.uav[me.team])}s`, x0 + size, y0 + size + 18, '#ff8a1f', 12, 'right');
    const now = performance.now();
    if (this.lastDraw) this.frameMs += (Math.min(1000, now - this.lastDraw) - this.frameMs) * 0.05;
    this.lastDraw = now;
    if (this.showFps) this.text(`${Math.round(1000 / this.frameMs)} FPS`, x0 + size, y0 + size + 34, '#6f7d62', 11, 'right', false);
  }

  drawStatus(M) {
    const c = this.c, me = this.me, bx = 20, by = this.H - 26;
    c.fillStyle = 'rgba(6,9,5,.68)';
    c.fillRect(bx - 8, by - 74, 280, 88);
    this.text(me.name.toUpperCase(), bx, by - 54, '#ffb347', 15);
    this.text(`STREAK ${me.streak}`, bx + 262, by - 54, '#d6dccb', 13, 'right');
    M.data.streaks.forEach((s, i) => {
      const x = bx + i * 88, on = me.streak >= s.kills;
      c.fillStyle = on ? '#ff8a1f' : 'rgba(255,255,255,.08)';
      c.fillRect(x, by - 44, 82, 18);
      this.text(`${s.kills} · ${STREAK_SHORT[s.id] || s.name}`, x + 41, by - 31, on ? '#1a1005' : '#8a9a7b', 12, 'center');
    });
    const hp = Math.max(0, me.hp);
    c.fillStyle = 'rgba(255,255,255,.1)';
    c.fillRect(bx, by - 14, 262, 10);
    c.fillStyle = hp > 60 ? '#7dcf5a' : hp > 30 ? '#e0b43a' : '#ff5347';
    c.fillRect(bx, by - 14, (262 * hp) / 100, 10);
    this.text('HEALTH', bx, by + 8, '#8a9a7b', 10, 'left', false);
  }

  drawWeapon(M) {
    const c = this.c, me = this.me, m = me.wp[me.cur], w = M.weapons[m.id], rx = this.W - 26, ry = this.H - 26;
    c.fillStyle = 'rgba(6,9,5,.68)';
    c.fillRect(this.W - 300, this.H - 128, 290, 116);
    const other = me.wp[1 - me.cur];
    if (other) this.text(`${2 - me.cur}  ${M.weapons[other.id].name}   ${other.mag}/${other.res}`, rx, ry - 84, '#6f7d62', 12, 'right', false);
    this.text(`${me.cur + 1}  ${w.name.toUpperCase()}`, rx, ry - 62, '#f2f2ea', 18, 'right');
    c.font = `22px ${FONT}`;
    const res = `/ ${m.res}`, resW = c.measureText(res).width;
    this.text(res, rx, ry, m.res === 0 ? '#ff5347' : '#b9c4ab', 22, 'right', false);
    this.text(m.mag, rx - resW - 8, ry, m.mag <= Math.ceil(w.mag * 0.25) ? '#ff5347' : '#ffffff', 52, 'right');
    const per = Math.ceil(w.mag / 40), icons = Math.ceil(w.mag / per), full = Math.ceil(m.mag / per);
    for (let i = 0; i < icons; i++) {
      c.fillStyle = i < full ? '#e3c25a' : 'rgba(255,255,255,.12)';
      c.fillRect(rx - (i + 1) * 6, ry - 50, 3, 9);
    }
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i < me.gren ? '#9fb26a' : 'rgba(255,255,255,.1)';
      c.beginPath(); c.arc(this.W - 284 + i * 14, ry - 8, 5, 0, TAU); c.fill();
    }
    this.text('G', this.W - 284, ry + 9, '#6f7d62', 10, 'center', false);
  }

  drawCrosshair(M, view) {
    const c = this.c, me = this.me, m = me.wp[me.cur], w = M.weapons[m.id], cx = this.W / 2, cy = this.H / 2;
    const fovScale = this.H / (2 * Math.tan((view.camera.fov * Math.PI) / 360));   // pixels per radian at the centre
    if (me.ads && view.vm.ads > 0.6) {
      if (!view.scoped) this.drawReticle(view.reticle, cx, cy);
    } else if (!view.scoped) {
      const speed = Math.hypot(me.vx, me.vz);
      const spread = (me.ads ? w.adsSpread : w.hipSpread) * (1 + Math.min(1, speed / 5) * 0.8 + (me.onGround ? 0 : 1.5)) * (1 - 0.3 * me.crouchT);
      const gap = Math.max(4, Math.tan(spread) * fovScale);
      c.globalAlpha = me.sprinting ? 0.25 : 1;
      const cross = () => {
        c.beginPath();
        if (w.pellets > 1) c.arc(cx, cy, gap, 0, TAU);
        else {
          c.moveTo(cx - gap - 9, cy); c.lineTo(cx - gap, cy);
          c.moveTo(cx + gap, cy); c.lineTo(cx + gap + 9, cy);
          c.moveTo(cx, cy - gap - 9); c.lineTo(cx, cy - gap);
          c.moveTo(cx, cy + gap); c.lineTo(cx, cy + gap + 9);
        }
        c.stroke();
      };
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.55)'; cross();
      c.lineWidth = 1.5; c.strokeStyle = '#fff'; cross();
      c.globalAlpha = 1;
    }
    if (me.reloadT > 0) {
      c.strokeStyle = '#ffb347';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - me.reloadT / me.reloadMax));
      c.stroke();
      this.text('RELOADING', cx, cy + 70, '#ffb347', 13, 'center');
    } else if (m.mag === 0 && m.res === 0) this.text('NO AMMO', cx, cy + 70, '#ff5347', 13, 'center');
    else if (m.mag === 0) this.text('[R] RELOAD', cx, cy + 70, '#ff5347', 13, 'center');
    else if (m.mag <= Math.ceil(w.mag * 0.25)) this.text('LOW AMMO', cx, cy + 70, '#e0b43a', 13, 'center');
    if (this.hitmark > 0) {
      c.globalAlpha = Math.min(1, this.hitmark / 0.12);
      c.strokeStyle = this.hitKill ? '#ff3b30' : this.hitHead ? '#ffd23a' : '#fff';
      c.lineWidth = 2;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(cx + sx * 7, cy + sy * 7); c.lineTo(cx + sx * 15, cy + sy * 15); }
      c.stroke();
      c.globalAlpha = 1;
    }
    this.popups.forEach((q, i) => {
      c.globalAlpha = Math.min(1, q.t / 0.3);
      this.text(q.text, cx + 60, cy - 30 - i * 22 - (1 - q.t / q.max) * 18, q.color, q.big ? 20 : 15, 'left');
    });
    c.globalAlpha = 1;
  }
}
