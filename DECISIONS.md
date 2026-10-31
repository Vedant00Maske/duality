# Decisions log

Places where the build intentionally differs from the technical blueprint (`game.docx`). Each entry gives the problem, the decision, and its impact.

## 1. Levels authored as ASCII grids instead of Tiled maps
- **Problem:** the blueprint calls for Tiled → JSON. There was no level designer or Tiled pass available within the deadline.
- **Decision:** levels are ASCII grids plus a typed legend (`packages/shared/src/levels`). They're compiled into the same runtime structures the blueprint describes (stable IDs, linked mechanisms by ID, bounds, element properties) and validated at build and test time.
- **Impact:** the grids are human-reviewable in any editor. A Tiled importer can feed the same `compileLevel` later without touching gameplay code.
- **Mitigation for "don't let an LLM author coordinates blindly":** every level has a scripted reference solution played through the real physics in CI (`tests/solutions.ts`). This found and fixed five real design flaws (an unreachable platform, beams crossing walkways that dropped a partner's bridge, a crate that could be pushed into a softlock, and a lift that reversed before riders could step off).

## 2. Resonance Link appears in Level 1, not first in Level 6
- **Problem:** judges and new players should meet the signature mechanic in the first minute.
- **Decision:** Level 1 ends with a simple link crystal. Level 6, *Resonance Test*, then teaches line of sight, charge timers and lining up two crystals at once. The mechanic passed the blueprint's acceptance gate: a crystal is powered by the tether's *geometry* (where you both stand and whether you can see each other), which two pressure plates can't replicate.

## 3. One process serves client + API + WebSockets
- **Problem:** the blueprint puts static files on a CDN and the game server separately. That's two deployments and CORS, with more ways to break before the deadline.
- **Decision:** the Colyseus server also serves `apps/web/dist`. Hashed assets get immutable cache headers and `index.html` gets none.
- **Impact:** one URL and one deploy. Splitting later only needs `VITE_SERVER_URL` set at build time.

## 4. Client-side prediction from day one, with partner extrapolation
- The blueprint allows prediction "after the basic loop works". It's implemented now: every snapshot rewinds to authoritative state and replays unacknowledged inputs. Errors fold into a ~70 ms decaying visual offset.
- The partner is extrapolated from their last held keys (not interpolated in the past), so platforms, crates and the partner all render in the same time frame. Riding a platform or pushing a crate never visually desyncs.
- Server input queues repeat held keys for at most 200 ms on starvation, then assume release. This was found by the integration test: a stalled client used to keep running forever.

## 5. Procedural art and audio
- **Problem:** the blueprint expects sprite and tile sheets from an artist pipeline.
- **Decision:** all textures (terrain, characters, mechanisms, backgrounds) are painted to canvases at boot, and all sound effects and the ambient score are synthesised with WebAudio.
- **Impact:** zero image or audio downloads (≈430 KB gzipped total, against an 8 MB budget), instant load, and a consistent look. Real sprite sheets can replace the generated textures later because entities reference texture keys.

## 6. HUD in HTML rather than in-canvas
- The HUD is HTML/CSS for crisp text and accessibility. It's updated at most 5×/s, and only when values change, to avoid layout cost. World-space prompts (sign bubbles, "Press E", partner name) are drawn in the canvas.

## 7. Mechanics scope adjustments
- Colour filters (blueprint level 8) were replaced by a prism plus element-restricted mirrors, so each player owns one beam branch.
- Mirrors and levers can be element-restricted (orange or blue rings), which keeps "both players contribute" true by construction.
- Looping lifts pause 0.75 s at each end, and wind zones disable the variable-jump "jump-cut" gravity. Both came out of bot playtests.
