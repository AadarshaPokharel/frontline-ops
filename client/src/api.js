// Talks to the Django backend. There is no login: the server hands out an anonymous player id,
// which the browser keeps in localStorage.
const PROFILE_KEY = 'frontline_profile';

function csrfToken() {
  const hit = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
  return hit ? decodeURIComponent(hit.slice('csrftoken='.length)) : '';
}

async function request(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status });
  return data;
}

export const api = {
  config: () => request('GET', '/api/config'),
  createPlayer: callsign => request('POST', '/api/players', { callsign }),
  getPlayer: id => request('GET', `/api/players/${id}`),
  renamePlayer: (id, callsign) => request('PATCH', `/api/players/${id}`, { callsign }),
  submitMatch: body => request('POST', '/api/matches', body),
  leaderboard: (map, period, me) =>
    request('GET', `/api/leaderboard?${new URLSearchParams({ map, period })}`, null, me ? { 'X-Player': me } : {}),
};

// Same rule as the server: 1-12 letters, digits, spaces, '.', '_' or '-'.
export const cleanCallsign = s => String(s || '').replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 12) || 'Ghost';

export class Profile {
  constructor() {
    this.id = null;
    this.callsign = null;
    this.stats = null;
    this.queue = Promise.resolve();   // serialises calls so two quick requests never create two players
    try { Object.assign(this, JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}); } catch { /* storage unavailable */ }
  }

  save() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ id: this.id, callsign: this.callsign })); } catch { /* ignore */ }
  }

  ensure(callsign) {
    const run = this.queue.then(() => this.ensureNow(callsign));
    this.queue = run.catch(() => {});
    return run;
  }

  async ensureNow(callsign) {
    if (this.id && this.callsign === callsign) return this;
    if (this.id) {
      try {
        this.stats = await api.renamePlayer(this.id, callsign);
        this.callsign = this.stats.callsign;
        this.save();
        return this;
      } catch (e) {
        if (e.status !== 404) throw e;   // the server forgot us (e.g. database reset): register again
      }
    }
    this.stats = await api.createPlayer(callsign);
    this.id = this.stats.id;
    this.callsign = this.stats.callsign;
    this.save();
    return this;
  }

  async submit(summary, callsign) {
    await this.ensure(callsign);
    try {
      this.stats = await api.submitMatch({ player: this.id, ...summary });
    } catch (e) {
      if (e.status !== 404) throw e;
      this.id = null;
      await this.ensure(callsign);
      this.stats = await api.submitMatch({ player: this.id, ...summary });
    }
    return this.stats;
  }

  async refresh() {
    if (!this.id) return null;
    try {
      this.stats = await api.getPlayer(this.id);
    } catch (e) {
      if (e.status === 404) { this.id = null; this.save(); }
      return null;
    }
    return this.stats;
  }
}
