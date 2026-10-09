# Data model — what lives where

Two places, one rule: **the Durable Object's storage is the live simulation;
the browser's `localStorage` is everything a visitor keeps for themselves.**
There is no database and no cache: when an ant dies, everything known about it
goes with it.

## Durable Object storage (SQLite inside `ColonyDO`)

Holds the single authoritative `ColonyState`, serialized by
`src/sim/serialize.ts`:

| key | value |
| --- | --- |
| `snapshot` | structured-clone object — the whole colony minus derived data (nest distance fields and the tile lookup are rebuilt on load) |
| `seq` | monotonic tick counter at last save |
| `lastTickMs` | wall-clock of the last processed tick (drives replay on wake) |
| `schemaVersion` | bump → `serialize.decode` rejects an old save and the worker starts a fresh colony |
| `tally` | lifetime counters (births, deaths by cause, ...) so the dashboard survives a restart |

Written every `SAVE_EVERY_TICKS` (300) ticks while someone is watching, and on
every idle alarm (see `docs/cloudflare-setup.md` §7). Read once, in the DO
constructor, which replays the wall-clock time that passed since `lastTickMs`
(capped at `MAX_RUN_TICKS` ticks; anything older is dropped). Single-writer, so no locking. Losing it rewinds the colony to the
last save — it never corrupts.

Ant names live inside `ColonyState` (nothing separate): each ant carries its
`name`; `surnameQueue` holds the surnames of dead ants waiting for the next
hatch, and `heirs` (`deadId -> heirId`, capped at `HEIRS_CAP`) lets a client
follow a dead ant to its successor. Both are bounded.

## Client (browser)

`localStorage` only. There is no visitor identity and nothing about a visitor is stored server-side:

| key | value |
| --- | --- |
| `antfarm.pins` | this visitor's pinned ant ids (client-only; a pin moves to the ant's heir when it dies) |
| `antfarm.prefs` | UI prefs (pheromone layer on/off, camera) |
