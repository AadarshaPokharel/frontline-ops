// Talks to the Django backend: game configuration, player look-ups and saving match results.
const DJANGO = (process.env.DJANGO_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const KEY = process.env.GAME_SERVER_KEY || '';

async function call(path, init = {}, timeoutMs = 3000) {
  const res = await fetch(DJANGO + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${path}`), { status: res.status });
  return res.json();
}

// The same /api/config the browser downloads, so both sides play by identical rules. Retries until Django is up.
export async function loadConfig() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call('/api/config');
    } catch (err) {
      if (attempt % 5 === 1) console.log(`waiting for Django at ${DJANGO} (${err.message})`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Returns the player's callsign if the anonymous id exists, otherwise null (they can still play, unrecorded).
export async function lookupPlayer(id) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    return (await call(`/api/players/${id}`)).callsign;
  } catch {
    return null;
  }
}

export async function saveResults(matches) {
  if (!KEY || !matches.length) return null;
  try {
    return await call('/api/internal/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Game-Server-Key': KEY },
      body: JSON.stringify({ matches }),
    }, 5000);
  } catch (err) {
    console.error('could not save results:', err.message);
    return null;
  }
}
