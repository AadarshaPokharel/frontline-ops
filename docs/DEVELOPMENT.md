# Frontline Ops: developer notes

How the game is built and run. For the players' description, see the [README](../README.md).

## Stack

- **Client:** Three.js (WebGL), built with Vite. First-person view, animated characters, effects and HUD.
- **Game server:** Node.js with WebSockets. Authoritative real-time matches that run the same rules as the browser.
- **Backend:** Django. Game data API, anonymous profiles, match results and leaderboards.
- **Database:** PostgreSQL (SQLite when Django runs on its own).
- **Edge:** nginx. One public port for the site and the game socket.

## Run

```bash
docker compose up -d --build        # http://localhost:8080
docker compose down                 # add -v to wipe the database
```

For other machines, copy `.env.example` to `.env`. Set `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD` and `GAME_SERVER_KEY`, and add your host or IP to `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`. For anything public, put it behind HTTPS.

## Architecture

```
browser ──HTTP──> nginx :8080 ──> Django + gunicorn ──> PostgreSQL
   │                 │               ▲
   └──WebSocket /ws──┴──> Node game server (rooms, 60 Hz) ──┘ results
```

- **`shared/`:** the game rules, plain JavaScript with no rendering. It covers the 2 m tile map, collisions, 3D hitscan against walls, cover, heads and bodies, movement, bots, grenades, killstreaks and the wire protocol. The browser and the game server import the same files.
- **Online play:**
  - The game server simulates each room at 60 Hz and sends compact snapshots 20 times a second.
  - The browser predicts its own player with the shared rules, then reconciles against each snapshot by replaying unacknowledged inputs.
  - Other players are interpolated 100 ms in the past.
  - Hits use lag compensation: targets are rewound up to 0.6 s.
  - A token bucket stops command flooding.
- **Results:** online results go from the game server to Django over the private network, with a shared key. nginx blocks `/api/internal/` from outside. Practice results come from the browser and are plausibility-checked.
- **Optics:** defined in `server/game/gamedata.py`. They affect the zoom, reticle and gun model; the server validates each player's choice.

```
client/          Three.js client: render/ (map, characters, guns and optics, viewmodel, effects), ui/ (HUD, menu), net.js, session.js
shared/          rules shared with the server: world.js, movement.js, match.js, ai.js, protocol.js
gameserver/      Node.js WebSocket server: rooms, matchmaking, private codes, snapshots
server/          Django: game/gamedata.py (maps, weapons, optics), game/views.py (API), game/tests.py
proxy/           nginx config
tools/           asset pipelines (download, simplify and compress the CC0 assets)
assets-src/      downloaded Quaternius zips (not shipped)
docs/media/      trailer (animated WebP for the README, MP4) and screenshots
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Maps, weapons, optics, difficulties, killstreaks |
| POST | `/api/players` | Create an anonymous player `{callsign}` |
| GET/PATCH | `/api/players/<id>` | Totals, rank and recent matches; rename |
| POST | `/api/matches` | Submit a practice result (plausibility-checked, 15 s cooldown) |
| GET | `/api/leaderboard?map=all&period=all&mode=all` | Top 25 by total score |
| POST | `/api/internal/results` | Game server only (shared key, blocked by nginx) |
| GET | `/api/health` | Health check |

## Local development

```bash
# backend on :8000 (SQLite)
cd server && python -m venv .venv && .venv/bin/pip install -r requirements.txt
DJANGO_DEBUG=1 .venv/bin/python manage.py migrate && DJANGO_DEBUG=1 .venv/bin/python manage.py runserver

# game server on :8081
cd gameserver && npm install && DJANGO_URL=http://127.0.0.1:8000 GAME_SERVER_KEY=dev npm start

# client on :5173 (proxies /api and /ws)
cd client && npm install && npm run dev

# tests
cd server && DJANGO_DEBUG=1 .venv/bin/python manage.py test game
```

`MATCH_SECONDS=120` on the game server shortens online matches. In the browser console:
- `FrontlineOps.simulate(seconds, command)` advances a match in fixed steps.
- `FrontlineOps.capture(true)` with `FrontlineOps.renderFrame(dt, command)` renders exact frames, for recording videos.

## Assets (all CC0)

- **Props and textures:** [Poly Haven](https://polyhaven.com). Run `cd tools && npm install && npm run assets`.
- **Characters and animations:** Quaternius [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and [Universal Animation Library](https://quaternius.itch.io/universal-animation-library), from the Standard zips in `assets-src/`. Unzip them, then:

  ```bash
  cd tools && npm run characters -- "<Universal Base Characters[Standard] folder>" "<Universal Animation Library[Standard] folder>"
  ```

## Performance notes

- **Draw calls:** walls are merged per 8×8-tile chunk with hidden faces removed, and props are chunked `InstancedMesh`es.
- **Mesh size:** props are simplified with meshoptimizer (a crate went from 13k to 1.5k triangles), and characters from 12.5k to 6k.
- **Animation:** 16 clips with only the needed bone tracks, 243 KB over the wire.
- **Assets and code:** about 5 MB of assets in total; JavaScript is about 190 KB gzipped, with Three.js in its own cached chunk.
- **Rendering:** shadows render only around the player and refresh every other frame. Lights are pooled, so shaders never recompile. Particles are pooled point sprites.
- **Server:** about 0.03 ms of server CPU per room tick with 10 players.
