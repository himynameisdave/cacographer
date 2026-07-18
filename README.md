# cacographer

[![CI](https://github.com/himynameisdave/cacographer/actions/workflows/ci.yml/badge.svg)](https://github.com/himynameisdave/cacographer/actions/workflows/ci.yml)

**cacographer** `/kəˈkɒɡ.rə.fər/` _noun_ — _someone who is bad at spelling or handwriting._

If Core built skribbl.

A real-time multiplayer drawing-and-guessing game for a trusted group of coworkers. One player at a time is the artist, the rest are simple cacographers — racing to guess the word in chat. No accounts, no database — share a link, play, done.

**Stack:** Bun · SvelteKit 5 (runes) · Bun-native WebSockets · in-memory game state. See [docs/PRD.md](docs/PRD.md) for product scope and [docs/TRD.md](docs/TRD.md) for the technical design.

## Getting started

Requires [Bun](https://bun.sh) (no other runtime is used, on either client or server).

```sh
bun install
bun run dev        # game server (:3001) + Vite dev server (:5173), together
```

Open http://localhost:5173, create a game, open the room link in a second tab to play against yourself.

## Project layout

```
server/
  index.ts          # Bun entry point: HTTP + WebSocket wiring (the only transport-aware file)
  engine/            # transport-agnostic game logic — rooms, scoring, masking, words
    Room.ts          # per-room state machine; takes intents, emits messages via injected deps
    RoomManager.ts   # creates/looks up rooms
    *.test.ts        # bun:test coverage, one file per engine module
  data/words.json    # word list

src/
  lib/
    protocol.ts      # single source of truth for every message shape on the wire
    game.svelte.ts    # client-side game store (Svelte 5 runes)
    realtime/         # WebSocket client + URL helpers
    components/       # Canvas, Chat, PlayerList, Timer, WordBlanks, SettingsPanel
  routes/             # SvelteKit pages (lobby, game/[code])

docs/
  PRD.md              # product scope — read before changing behavior
  TRD.md              # architecture/design rationale — read before changing structure
```

## Contributing

Before making non-trivial changes, read [`CLAUDE.md`](CLAUDE.md) — it has the load-bearing architecture rules (server is the sole authority, `protocol.ts` is shared source of truth, the engine stays transport-agnostic and testable) plus style and workflow conventions. The short version:

- Small, logical commits on a feature branch; PR into `main`; CI must be green before merge.
- Game logic lives in `server/engine/` only — never in the client, even for perceived responsiveness.
- Changing the wire protocol? Update `src/lib/protocol.ts` and both sides of the wire in the same commit.
- New engine behavior needs a `bun:test` in `server/engine/*.test.ts`; anything timing-dependent must go through injected `deps.now`/`deps.schedule`, not raw `setTimeout`/`Date.now()`.

Run the full CI suite locally before pushing:

```sh
bun run lint          # oxlint, strict — must be clean
bun run format        # oxfmt --write (tabs, single quotes, 100 cols)
bun run format:check  # what CI runs
bun run check         # svelte-check (client, src/**), fails on warnings
bun run check:server  # tsc (server/**, via server/tsconfig.json)
bun test server       # engine unit tests
bun run build         # static client → build/
```

## Production

```sh
bun run build      # static client → build/
bun run start      # one Bun process: HTTP (static client + API) + WebSockets on $PORT
```

### Railway

Single service, no database:

- **Build command:** `bun install && bun run build`
- **Start command:** `bun run start`
- Railway injects `PORT`; the server binds to it. Game state is in-memory — a redeploy drops live games, which is fine for v1.

## Architecture in one paragraph

One Bun process holds all game state in memory (`RoomManager` → `Room`), coordinates each room over WebSockets, and serves the static SvelteKit client. Clients are thin views: they render server-pushed state and send intents; the server is the sole authority on words, timing, guess correctness, and scoring. The engine (`server/engine/`) is transport-agnostic and fully unit-tested; `src/lib/protocol.ts` is the single shared source of truth for message shapes on both sides of the wire.
