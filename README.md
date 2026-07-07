# cacographer

If Core built skribbl.

A real-time multiplayer drawing-and-guessing game for a trusted group of coworkers. One player draws a secret word, everyone else races to guess it in chat. No accounts, no database — share a link, play, done.

**Stack:** Bun · SvelteKit 5 (runes) · Bun-native WebSockets · in-memory game state. See [docs/PRD.md](docs/PRD.md) and [docs/TRD.md](docs/TRD.md).

## Development

```sh
bun install
bun run dev        # game server (:3001) + Vite dev server (:5173), together
```

Open http://localhost:5173, create a game, open the room link in a second tab to play against yourself.

```sh
bun test server    # engine unit tests
bun run check      # svelte-check
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
