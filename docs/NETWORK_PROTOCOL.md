# Network protocol

Transport: Colyseus 0.18 over WebSocket (`wss://` in production). One room = one 2-player session. The room ID is the 5-character code, drawn from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no O/0/I/1).

## Join
`client.create('duality', { name, v })` / `client.joinById(code, { name, v })`. The server rejects a mismatched `v` (`PROTOCOL_VERSION`) with "please refresh", and rejects a third player with "room is full". Slot 0 is Ember and slot 1 is Tide. The first joiner hosts; if they leave, host passes to the other player.

## Client → room
| Message | Payload | Notes |
|---|---|---|
| `in` | `[firstSeq, b0, b1, …]` (≤16 bytes) | One byte per 60 Hz tick: Left 1, Right 2, JumpHeld 4, JumpPressed 8, InteractPressed 16. Sent every 2 ticks, or immediately when a press edge is included. Old or duplicate sequence numbers are ignored; malformed batches are dropped. |
| `ready` | `{ ready }` | Lobby only. Both ready → countdown → playing. |
| `level` | `{ id }` | Host only, lobby only. |
| `swap` | — | Swap Ember/Tide (lobby). |
| `restart` | — | Restart the current level (either player; the partner gets a notice). |
| `lobby` | — | Back to level select. |
| `vote` | `{ v: 'next' or 'replay' }` | Results screen; acts when both votes match. |
| `name` | `{ name }` | Sanitised server-side. |

Rate limit: 150 messages/s per client. Clients normally send about 30/s.

## Room → clients
- **Schema state** (delta-patched every 50 ms = 20 Hz): phase, level, `seq` (increments on every (re)start), host, tick, countdown, `paused`, per-slot player simulation state including `ack` (last consumed input sequence), and per-object dynamic state `{s, p, x, y, vx, vy}`. Positions are `float64`, so client replays match the server exactly.
- `notice` `{ text, kind }`: transient toasts (joined, left, restarted, …).

## Simulation and prediction
- The server steps at a fixed 60 Hz, consuming one queued input per player per tick. If more than 4 inputs are buffered, older ones are skipped, but their press edges are merged forward so taps are never lost. If the queue is empty, held keys repeat for at most 200 ms, then release.
- The client predicts with the same `stepWorld`. On every snapshot it clones the authoritative world, drops acknowledged inputs, replays the rest, and blends any difference into a decaying render offset.
- Countdown and paused phases acknowledge but discard inputs, so prediction never diverges across pauses.

## Disconnects
- Drop (non-consented): the seat is held for 45 s, the level freezes for both players, and the partner sees a waiting overlay. The SDK auto-reconnects. After a page refresh, the client reconnects using the token in `sessionStorage`.
- Leave (consented, or grace expired): the seat is freed and the room returns to the lobby. Anyone with the code can take the seat.
- The room disposes when empty and frees its code.
