import { buildGrid } from '@shared/world.js';
import { esc } from './hud.js';

const $ = id => document.getElementById(id);

function thumbnail(map) {
  const grid = buildGrid(map), s = 4, c = document.createElement('canvas'), colors = map.theme.mini;
  c.width = map.w * s;
  c.height = map.h * s;
  c.className = 'thumb';
  const g = c.getContext('2d');
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const ch = grid[y][x];
    g.fillStyle = ch === '#' ? colors.wall : ch === 'c' || ch === 'C' ? colors.cover : colors.floor;
    g.fillRect(x * s, y * s, s, s);
  }
  return c;
}

function selectOne(container, chosen) {
  for (const el of container.children) el.classList.toggle('sel', el === chosen);
}

const stat = (label, v) =>
  `<div class="stat">${label}<div class="bar"><div style="width:${Math.round(Math.min(1, Math.max(0.05, v)) * 100)}%"></div></div></div>`;

export function buildMenu(data, cfg, { onChange, onMap, onLeaderboard, onPractice, onQuick, onCreate, onJoin }) {
  const mapsEl = $('maps'), weaponsEl = $('weapons');
  for (const m of data.maps) {
    const card = document.createElement('div');
    card.className = `card${cfg.map === m.slug ? ' sel' : ''}`;
    card.append(thumbnail(m));
    card.insertAdjacentHTML('beforeend', `<b>${esc(m.name)}</b><i>${esc(m.desc)}</i>`);
    card.onclick = () => {
      cfg.map = m.slug;
      selectOne(mapsEl, card);
      onChange();
      onMap(m);
    };
    mapsEl.append(card);
  }
  for (const id of data.primaries) {
    const w = data.weapons[id], card = document.createElement('div');
    card.className = `card w${cfg.primary === id ? ' sel' : ''}`;
    card.innerHTML = `<b>${esc(w.name)}</b><i>${esc(w.cls)} · ${w.mag} rds</i>` +
      stat('DAMAGE', (w.dmg * w.pellets) / 140) + stat('FIRE RATE', w.rpm / 950) +
      stat('RANGE', w.falloff[1] / 100) + stat('MOBILITY', ((w.move || 1) - 0.7) / 0.45);
    card.onclick = () => {
      cfg.primary = id;
      selectOne(weaponsEl, card);
      showOptics();
      onChange();
    };
    weaponsEl.append(card);
  }

  // the sights the selected gun can take; the choice is remembered per gun
  const showOptics = () => {
    const list = data.weapons[cfg.primary].optics || ['iron'], chosen = list.includes(cfg.optics[cfg.primary]) ? cfg.optics[cfg.primary] : list[0];
    $('optic').innerHTML = list.map(o => `<option value="${o}">${esc(data.optics[o].name)}</option>`).join('');
    $('optic').value = chosen;
    $('optic-desc').textContent = data.optics[chosen].desc;
  };
  showOptics();
  $('optic').addEventListener('change', () => {
    cfg.optics[cfg.primary] = $('optic').value;
    $('optic-desc').textContent = data.optics[$('optic').value].desc;
    onChange();
  });

  $('diff').innerHTML = data.difficulties.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join('');
  $('limit').innerHTML = data.match.scoreLimits.map(n => `<option value="${n}">${n}</option>`).join('');
  $('lb-map').innerHTML = '<option value="all">All maps</option>' + data.maps.map(m => `<option value="${m.slug}">${esc(m.name)}</option>`).join('');
  $('name').value = cfg.name;
  $('diff').value = String(cfg.diff);
  $('limit').value = String(cfg.limit);
  $('sens').value = String(cfg.sens);
  $('fov').value = String(cfg.fov);
  $('hq').checked = cfg.hq;
  const showValues = () => { $('sens-v').textContent = Number($('sens').value).toFixed(1); $('fov-v').textContent = $('fov').value; };
  showValues();

  const read = () => {
    cfg.name = $('name').value;
    cfg.diff = Number($('diff').value);
    cfg.limit = Number($('limit').value);
    cfg.sens = Number($('sens').value);
    cfg.fov = Number($('fov').value);
    cfg.hq = $('hq').checked;
    showValues();
    onChange();
  };
  for (const id of ['name', 'diff', 'limit', 'hq']) $(id).addEventListener('change', read);
  for (const id of ['sens', 'fov']) $(id).addEventListener('input', read);
  for (const id of ['lb-map', 'lb-period']) $(id).addEventListener('change', onLeaderboard);
  $('code').addEventListener('input', () => { $('code').value = $('code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('deploy').onclick = () => { read(); onPractice(); };
  $('quick').onclick = () => { read(); onQuick(); };
  $('create').onclick = () => { read(); onCreate(); };
  $('join').onclick = () => { read(); onJoin($('code').value); };
}

export function renderRecord(stats) {
  const el = $('record'), t = stats?.totals;
  if (!t?.matches) {
    el.className = 'record empty';
    el.textContent = 'Play a match to start your record.';
    return;
  }
  el.className = 'record';
  el.innerHTML = [
    ['Rank', stats.rank ? `#${stats.rank}` : '—'], ['Score', t.score], ['Wins', `${t.wins}/${t.matches}`],
    ['Kills', t.kills], ['K/D', (t.kills / Math.max(1, t.deaths)).toFixed(2)], ['Best streak', t.best_streak],
  ].map(([label, value]) => `<div><b>${esc(value)}</b><span>${label}</span></div>`).join('');
}

export function renderLeaderboard(rows) {
  const el = $('leaderboard');
  if (!rows) { el.textContent = 'Leaderboard unavailable.'; return; }
  if (!rows.length) { el.textContent = 'No matches recorded yet. Be the first.'; return; }
  el.innerHTML = '<table><tr><th>#</th><th>Player</th><th>Score</th><th>K</th><th>D</th><th>W</th></tr>' +
    rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${r.rank}</td><td>${esc(r.callsign)}</td><td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.wins}</td></tr>`).join('') +
    '</table>';
}
