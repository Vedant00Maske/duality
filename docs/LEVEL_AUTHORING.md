# Level authoring

Levels live in `packages/shared/src/levels/data/world*.ts` as an ASCII grid plus a legend.

| Char | Meaning |
|---|---|
| `#` | solid rock |
| `-` | one-way platform (stand on it, jump up through it) |
| `L` `W` `T` | lava / water / toxic pool: solid floor with a lethal surface (Ember survives lava, Tide survives water, toxin hurts both) |
| `^` | spikes |
| `1` `2` | Ember / Tide spawn (standing on the cell below) |
| `.` | empty |
| any other character | an object from the `legend`. All cells with that character must form one filled rectangle. |

Objects: `door` (`style: 'bridge'`, `latch`, `invert`), `plate`, `lever` (`element`, `timer`), `node` (`element`, `timer`, `hold`), `ice`, `crate`, `platform` (`to`, `speed`, `loop`), `fan` (`dir`), `emitter` (`dir`), `mirror` (`orient`, `element`, `fixed`), `prism`, `receiver`, `crystal` (`timer`), `field`, `saw` (`to`, `speed`, `loop`), `checkpoint` (`element`), `exit`, `gate` (`element`), `sign` (`text`).

Targets (doors, platforms, fans, emitters, fields, saws) listen to activators (plates, levers, nodes, receivers, crystals) via `when: ['id', ...]` with `mode: 'all' | 'any'` and an optional `invert`. Matching colours in-game show what is wired to what.

## Physics budget for design
- Full jump ≈ 88 px (2.75 tiles): **climb at most 2 tiles**.
- Flat jump distance from a run ≈ 5 tiles. A gap meant to be impossible must be **at least 7 tiles**.
- Body is 20×28 px, so a 1-tile corridor is passable.
- The Link reaches 9 tiles and needs line of sight. Lines from a ledge to someone below usually clip the ledge corner, so keep link puzzles roughly level.
- Never put a beam or receiver across a walkway that a partner must cross while the beam holds up a bridge.

## Checklist (enforced by `npm run validate-levels` and `npm test`)
- One exit, both spawns on ground, every `when` id exists and is an activator, plates sit on floor, rectangular objects, single-cell objects are single cells.
- Add a reference solution to `tests/solutions.ts`. The test plays it through the real simulation and requires completion with zero deaths, under par.
