# Game design

**Audience:** pairs of friends, classmates, couples or parent and child (8+), on separate devices in the same room or over a call. No prior gaming knowledge is assumed. Every level opens with in-world signs.

**Core loop:** read the room → split up by element → operate mechanisms *for each other* → reunite through the Resonance Link → reach the exit together. Stars reward finishing, beating par, and keeping combined deaths at 2 or fewer.

## Levels
| # | World | Name | Teaches |
|---|---|---|---|
| 1 | Elemental Caverns | First Contact | movement, elements, toxin, **first link crystal** |
| 2 | Elemental Caverns | Twin Valves | plates, relay doors, simultaneous plates |
| 3 | Elemental Caverns | Meltwater | ice, element nodes, water bridge, checkpoint, timed nodes |
| 4 | Machineworks | Counterweight | crates, looping lift, lever |
| 5 | Machineworks | The Long Gear | partner-driven platform, saw timing, element levers |
| 6 | Machineworks | Resonance Test | line of sight, charge crystals, aligning two crystals |
| 7 | Light Temple | First Reflection | beams, element mirrors, bodies block light |
| 8 | Light Temple | Split the Signal | prism, light bridge, paired roles |
| 9 | Light Temple | Shadow Bridge | shadow vs light bridges, saw |
| 10 | Sky Vault | Updraft | updraft fans, wind turbines, plate relay |
| 11 | Sky Vault | Broken Circuit | electric fields, hold nodes, timed nodes, charge crystal |
| 12 | Sky Vault | Convergence | all mechanics, two checkpoints |

## Edge cases handled
Invalid or full room codes; joining twice (refresh resumes the same seat); partner disconnect (frozen level, 45 s seat hold, overlay); partner leaves (back to lobby, seat reusable); host leaves (host migrates); simultaneous actions (server-ordered, deterministic); duplicate or replayed inputs (sequence numbers); stalled tab (held keys auto-release); lost crates (return home); doors never close on a player; restart needs a double-press of R to prevent accidents.
