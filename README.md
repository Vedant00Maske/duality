# DUALITY

**Two elements. Two devices. One Resonance Link.**

DUALITY is an online co-op puzzle platformer for exactly two players, each on their own phone, tablet or laptop. One of you is **Ember** (fire: safe in lava, put out by water), the other is **Tide** (water: safe in water, boiled by lava). When you stand close enough to see each other, a glowing energy tether forms between you. That's the **Resonance Link**, and any crystal it passes through is powered. Every one of the 12 levels needs both players.

- No accounts, no installs. Open the link, create a room, and share the 5-letter code.
- 12 levels across 4 worlds (Elemental Caverns, Machineworks, Light Temple, Sky Vault), about 3–6 minutes each.
- Keyboard (← → / A D, Space, E) or on-screen touch controls.

## Play locally

```bash
npm install
npm run dev          # game server on :2567 + Vite client on :5173
```

Open `http://localhost:5173` in two browser windows, or on a second device at `http://<your-LAN-IP>:5173`.

## Production

```bash
npm run build        # builds the client (apps/web/dist) and bundles the server (apps/server/dist)
npm start            # one Node process serves the client, the matchmaking API and the game WebSockets
```

The server listens on `$PORT` (default 2567) and exposes `/health`.

### Deploy

The game deploys as a single long-lived Node service. It needs a host that supports WebSockets, so serverless functions won't work.

- **Render**: push this repo to GitHub, then *New → Blueprint* and pick the repo. `render.yaml` configures everything.
- **Any Docker host** (Fly.io, Railway, Koyeb, a VPS): `docker build -t duality . && docker run -p 8080:8080 duality`.

Production URLs must use HTTPS. The client then connects over `wss://` on the same origin automatically.

## Tests

```bash
npm test                 # physics, determinism, rollback, 12 level solutions, room integration, asset audits (48 tests)
npm run validate-levels  # schema + reference validation for every level
npm run typecheck
npm run e2e              # two real browser windows (needs Microsoft Edge; run `npm run dev` first)
node tests/e2e/ui.mjs                 # menus, rooms, settings, audio, 5 viewport sizes (62 checks)
node tests/e2e/levels.mjs             # screenshots all 12 levels, asserts pixel-art environment loads
node tests/e2e/animations.mjs [--as tide]   # all 9 animations per character on both clients
PORT=3001 COLYSEUS_LATENCY=120 npm start & node tests/e2e/latency.mjs http://localhost:3001
```

Each level has a scripted reference solution (`tests/solutions.ts`). The tests play it through the real simulation and fail if anyone dies, the level can't be finished, or the run takes longer than par. So no level ships with an impossible jump or a softlock.

## Art and audio pipeline

All art is original pixel art produced by deterministic generators, so it can be regenerated and re-validated at any time:

```bash
node tools/art/char-anims.mjs all     # Ember + Tide: 9 animations, 43 frames each -> art-src/<name>/final
node tools/art/export-characters.mjs  # copy validated atlases into apps/web/src/art/characters
node tools/art/worlds.mjs             # 4 tilesets, 3 animated liquids, 12 parallax backgrounds (+ validation.json)
node tools/art/objects.mjs            # interactive-object atlas (greyscale parts are tinted with the 6 wiring colours)
node tools/art/branding.mjs           # favicon + touch icon
npm run asset-audit                   # character sheet audit (frames, alpha, baseline, palette, timing)
node tools/cover/capture.mjs && node tools/cover/render.mjs   # 1200x630 cover from real gameplay
```

World art is loaded lazily per world (World 1 at boot, the next world prefetched). If any file fails to load, the renderer falls back to the procedural painter. Music is four composed loops played by a look-ahead WebAudio sequencer, so there are no audio downloads.

Production build sizes (gzip/PNG): JS + CSS ≈ 455 KB; initial images ≈ 60 KB; each further world ≈ 15–37 KB. Total ≈ 0.6 MB.

## Troubleshooting

- **Room code not found:** rooms close when both players leave. Create a new room.
- **No sound:** browsers start audio only after a click or tap. Also check *Settings → Mute* and the HUD speaker button.
- **Blurry or uneven pixels:** use the default *Pixel art* character setting. The gameplay camera then uses whole-number zoom.
- **Render build fails:** the build command must be `npm ci --include=dev && npm run build`, as in `render.yaml`.

## Architecture

```
packages/shared   deterministic fixed-step simulation (60 Hz), level format + compiler + validator, protocol
apps/server       Colyseus 0.18 authoritative room: input queues, simulation, schema state sync, reconnection
apps/web          Phaser 3.90 renderer, client prediction/reconciliation, HTML/CSS UI, WebAudio synth
tests             unit + integration (vitest), level-solving bot, Playwright E2E scripts
docs              design, protocol, level authoring, performance notes
```

- **Server-authoritative.** Clients send only sequenced input bits. The server simulates and replicates state. Clients never decide that a door opened or a level ended.
- **Zero-lag local controls.** The client runs the exact same simulation code, applies your input immediately, and rewinds and replays unacknowledged inputs whenever an authoritative snapshot arrives. At ~120 ms ping the local player's correction measured **0.00 px**.
- **Resilient.** If a player drops, their seat is held for 45 s and the level freezes. They can come back through automatic reconnect or by refreshing the page. A free seat can be taken by a new player using the same code.

More detail is in [`docs/`](docs) and [`DECISIONS.md`](DECISIONS.md).
