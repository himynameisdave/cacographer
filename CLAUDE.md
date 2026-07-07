# Contributing to cacographer

A Skribbl-clone drawing/guessing game. Product scope: `docs/PRD.md`. Architecture: `docs/TRD.md`. Read both before making non-trivial changes.

## Commands

```sh
bun run dev           # game server (:3001) + Vite (:5173) together
bun test server       # engine unit tests
bun run lint          # oxlint, strict — must be clean
bun run format        # oxfmt --write (tabs, single quotes, 100 cols)
bun run format:check  # what CI runs
bun run check         # svelte-check, fails on warnings
bun run build         # static client → build/
```

CI (`.github/workflows/ci.yml`) runs lint → format:check → check → test → build. All five must pass; run them locally before pushing.

## Architecture rules (load-bearing — do not erode)

1. **The server is the only authority.** Scoring, timing, guess correctness, and word secrecy are decided in `server/engine/`. The client renders server-pushed state and sends intents. Never add game logic to the client, even "just for responsiveness".
2. **`src/lib/protocol.ts` is the single source of truth** for every message shape on the wire. Both client and server import it. Keep it dependency-free. Any protocol change updates that one file plus both sides in the same commit.
3. **The engine is transport-agnostic.** Nothing under `server/engine/` may import Bun APIs, sockets, or `server/index.ts`. Rooms receive intents via method calls and emit messages through injected `deps.send`. Time and randomness come from `deps` too — that's what makes the engine testable (see the FakeClock pattern in `server/engine/room.test.ts`) and portable.
4. **Secrets never leak by construction.** The current word and the drawer's choices travel only via targeted `yourWord`/`wordChoices` sends. `toClientRoom()` must stay safe to broadcast to anyone. If you add state, decide explicitly whether it belongs in the projection.
5. **Wire types use `null`, not `undefined`** — this is a JSON protocol; `null` round-trips, `undefined` silently disappears. (`unicorn/no-null` is disabled for this reason.)

## Style

- **Formatting is not a discussion.** oxfmt owns it: tabs, single quotes, 100-column width, no trailing commas. Run `bun run format` before committing. Do not hand-format against it or commit formatter noise in otherwise-unrelated commits.
- **Linting is strict on purpose** (`.oxlintrc.json`: correctness/suspicious/pedantic/perf/style all at `error`, unicorn enabled). The disabled rules were each turned off deliberately with a reason; don't add new `"off"` entries or inline `oxlint-disable` comments without a justifying comment and a good argument.
- **Linting is type-aware.** `bun run lint` runs `oxlint --type-aware`, backed by the `oxlint-tsgolint` devDependency. This enables real type-checking rules (`prefer-readonly-parameter-types`, `no-confusing-void-expression`, `strict-boolean-expressions`, etc.) beyond what plain syntax linting can catch. Caveat: tsgolint doesn't yet resolve `bun:test`'s ambient globals or `node:fs`/`node:path`/`bun`'s ambient types in this project's tsconfig setup, so a few rules are scoped off for `*.test.ts`/`server/index.ts` in `.oxlintrc.json` with a comment explaining why — don't extend those overrides to other files without checking the finding is actually a false positive first.
- **Function parameters are `readonly` by default.** Arrays/objects a function only reads should be typed `readonly T[]` / `Readonly<T>` (or the type's own fields marked `readonly` if the function owns that type) — enforced by `typescript/prefer-readonly-parameter-types`. `src/lib/protocol.ts`'s wire types are deeply `readonly` for this reason; see `src/lib/game.svelte.ts`'s `Mutable<T>`/`toMutable()` for the pattern used where a local mirror of wire state legitimately needs to stay mutable (Svelte 5 `$state` patched in place).
- **Prefer `type` over `interface`** (`typescript/consistent-type-definitions`). Both work in TS, but this codebase picked one so it doesn't have to be decided per-PR.
- **Prefer `Set`/`Map` over array scans** where membership/lookup is the point — e.g. `Set#has()` over `Array#includes()` (`unicorn/prefer-set-has`).
- **Exported functions get a one-line JSDoc description** (see `server/engine/scoring.ts`) where the name/signature alone doesn't already say enough. This is a code-review expectation, not lint-enforced — oxlint's `jsdoc` plugin has no "a JSDoc block must exist" rule, and `require-param`/`require-returns` are deliberately off since they'd force full tag blocks onto every documented function, which is more ceremony than this codebase's terse style wants. `jsdoc/check-tag-names` stays on to catch typos in whatever JSDoc is written.
- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`. No legacy stores, no `$:` reactive statements, no `export let`.
- **No new runtime dependencies** without a strong reason. The client is deliberately zero-dep (system fonts, hand-rolled components); the server is Bun built-ins only. (Lint/format tooling devDependencies are a separate bar — `oxlint-tsgolint` was added for type-aware linting.)
- Comments explain _why_ or state invariants; they never narrate what the next line does.
- TypeScript: no `any` outside tests; prefer discriminated unions (see `ClientMessage`/`ServerMessage`) over optional-field grab-bags.

## Known gaps

- **`server/` isn't type-checked by `bun run check`.** svelte-check's tsconfig scope (via `.svelte-kit/tsconfig.json`'s `include`) only covers `src/**`, so `server/engine/` and `server/index.ts` get zero `tsc` coverage from any CI gate today — `bun test server` runs the TS through Bun's transpiler (types stripped, not checked), and oxlint's type-aware rules check specific patterns rather than full program correctness. In practice this means a real type error under `server/` can currently ship silently. Worth closing (e.g. a `server/tsconfig.json` plus `@types/bun`/`@types/node` and a dedicated `check:server` script) but out of scope for whoever's reading this unless you're the one asked to fix it.

## Testing

- Engine changes require `bun:test` coverage in `server/engine/*.test.ts`. Pure functions (scoring, masking, words, text) get direct unit tests; `Room` behavior is tested by driving a room with fake deps and asserting on the emitted messages — never by reaching into private state.
- Anything timing-dependent must go through `deps.now`/`deps.schedule` so tests can advance a fake clock deterministically. Adding a raw `setTimeout`/`Date.now()` inside the engine is a bug.

## Workflow

- Small, logical commits; imperative subject line ("Add X", "Fix Y"), no trailer noise.
- Feature branches + PRs into `main`; CI green before merge.
- If you change the protocol, the engine, and the client in one effort, keep them reviewable: protocol commit first, then server, then client.
