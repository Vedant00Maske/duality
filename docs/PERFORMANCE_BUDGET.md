# Performance

Measured on the development machine (Windows 11, Microsoft Edge 156, headless) unless noted. Re-measure on the deployment host and a representative phone.

| Metric | Target | Measured |
|---|---|---|
| Client frame rate | 60 FPS | 114–120 FPS on all 12 levels (vsync cap) |
| Initial download | under 8 MB compressed | **≈ 430 KB gzipped** total (Phaser 332 KB, game 92 KB, CSS 5 KB); zero images or audio files |
| Server tick | under 5 ms avg per room | logged as `tick_stats` every 10 s; the sim is a few dozen AABB checks per tick |
| State patch rate | 15–20 Hz | 20 Hz delta patches |
| Input upstream | 20–30 Hz | about 30 Hz, 2–17 bytes per message |
| Local correction at ~120 ms RTT | invisible | **0.00 px** (local prediction is exact) |
| Partner correction at ~120 ms RTT | smoothed | at most 33 px on sudden turns or jumps, blended over ~70 ms |
| Reconnect after refresh | under 5 s | about 1 s (token in sessionStorage) |

Techniques:
- Terrain is pre-rendered into one canvas texture per level (one draw call). Liquids are scrolling TileSprites.
- Mechanism graphics redraw only when their state key changes.
- Particles are capped and reduced with "reduce motion".
- Fixed 60 Hz simulation with render interpolation, so it's smooth on 120/144 Hz displays and frame-rate independent.
- Device pixel ratio is capped (2 on desktop, 1.75 on touch) for crisp but affordable rendering.
- Phaser input, audio and DOM plugins are disabled; HUD DOM writes are throttled and diffed.

Reproduce: `node tests/e2e/levels.mjs <url>` (FPS per level), and `COLYSEUS_LATENCY=100 npm start` + `node tests/e2e/latency.mjs <url>`.
