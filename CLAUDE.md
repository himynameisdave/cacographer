# Contributing to cacographer

A Skribbl-clone drawing/guessing game. Product scope: `docs/PRD.md`. Architecture: `docs/TRD.md`. Read both before making non-trivial changes.

## Commands

```sh
bun run dev           # game server (:3001) + Vite (:5173) together
bun test server       # engine unit tests
bun run lint          # oxlint, strict — must be clean
bun run format        # oxfmt --write (tabs, single quotes, 100 cols)
bun run format:check  # what CI runs
bun run check         # svelte-check (client, src/**), fails on warnings
bun run check:server  # tsc (server/**, via server/tsconfig.json)
bun run build         # static client → build/
```

CI (`.github/workflows/ci.yml`) runs lint → format:check → check → check:server → test → build. All six must pass; run them locally before pushing. A Husky pre-commit hook (`.husky/pre-commit`) already runs format and lint on what you stage via `lint-staged`, then `check:server` over the whole server project; `bun run check` is CI-only.

**The two typecheck scopes are separate on purpose.** svelte-check's tsconfig (via `.svelte-kit/tsconfig.json`) only reaches `src/**`, and the server is a Bun process with no DOM — so `server/tsconfig.json` is standalone, owns `server/**` plus the shared `src/lib/protocol.ts`, and is what `check:server` and oxlint's type-aware mode both use. Add a file under `server/` and it's covered automatically; there is no third scope.

## Architecture rules (load-bearing — do not erode)

1. **The server is the only authority.** Scoring, timing, guess correctness, and word secrecy are decided in `server/engine/`. The client renders server-pushed state and sends intents. Never add game logic to the client, even "just for responsiveness".
2. **`src/lib/protocol.ts` is the single source of truth** for every message shape on the wire. Both client and server import it. Keep it dependency-free. Any protocol change updates that one file plus both sides in the same commit.
3. **The engine is transport-agnostic.** Nothing under `server/engine/` may import Bun APIs, sockets, or `server/index.ts`. Rooms receive intents via method calls and emit messages through injected `deps.send`. Time and randomness come from `deps` too — that's what makes the engine testable (see the FakeClock pattern in `server/engine/room.test.ts`) and portable.
4. **Secrets never leak by construction.** The current word and the drawer's choices travel only via targeted `yourWord`/`wordChoices` sends. `toClientRoom()` must stay safe to broadcast to anyone. If you add state, decide explicitly whether it belongs in the projection.
5. **Wire types use `null`, not `undefined`** — this is a JSON protocol; `null` round-trips, `undefined` silently disappears. (`unicorn/no-null` is disabled for this reason.)

## Style

- **Formatting is not a discussion.** oxfmt owns it: tabs, single quotes, 100-column width, no trailing commas. Run `bun run format` before committing. Do not hand-format against it or commit formatter noise in otherwise-unrelated commits.
- **Linting is strict on purpose** (`.oxlintrc.json`: correctness/suspicious/pedantic/perf/style all at `error`, unicorn enabled). The disabled rules were each turned off deliberately with a reason; don't add new `"off"` entries or inline `oxlint-disable` comments without a justifying comment and a good argument.
- **Linting is type-aware.** `bun run lint` runs `oxlint --type-aware`, backed by the `oxlint-tsgolint` devDependency. This enables real type-checking rules (`prefer-readonly-parameter-types`, `no-confusing-void-expression`, `strict-boolean-expressions`, etc.) beyond what plain syntax linting can catch. tsgolint resolves each file against the nearest `tsconfig.json`, so `server/**` gets real Bun/Node/`bun:test` types from `server/tsconfig.json` — a finding there is a genuine one, not an unresolved-import artifact. Type-aware rules trust declared types, so the one place they mislead is code validating untrusted wire JSON, where the declared type describes what a well-behaved client sends rather than what arrived (see `WORD_SOURCES` in `server/engine/Room.ts` and `isClientMessage` in `server/index.ts` — both validate at runtime against types that claim the check is redundant). Reach for a runtime-honest structure like those before reaching for a disable comment.
- **Function parameters are `readonly` by default.** Arrays/objects a function only reads should be typed `readonly T[]` / `Readonly<T>` (or the type's own fields marked `readonly` if the function owns that type) — enforced by `typescript/prefer-readonly-parameter-types`. `src/lib/protocol.ts`'s wire types are deeply `readonly` for this reason; see `src/lib/game.svelte.ts`'s `Mutable<T>`/`toMutable()` for the pattern used where a local mirror of wire state legitimately needs to stay mutable (Svelte 5 `$state` patched in place).
- **Prefer `type` over `interface`** (`typescript/consistent-type-definitions`). Both work in TS, but this codebase picked one so it doesn't have to be decided per-PR.
- **Prefer `Set`/`Map` over array scans** where membership/lookup is the point — e.g. `Set#has()` over `Array#includes()` (`unicorn/prefer-set-has`).
- **Exported functions get a one-line JSDoc description** (see `server/engine/scoring.ts`) where the name/signature alone doesn't already say enough. This is a code-review expectation, not lint-enforced — oxlint's `jsdoc` plugin has no "a JSDoc block must exist" rule, and `require-param`/`require-returns` are deliberately off since they'd force full tag blocks onto every documented function, which is more ceremony than this codebase's terse style wants. `jsdoc/check-tag-names` stays on to catch typos in whatever JSDoc is written.
- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`. No legacy stores, no `$:` reactive statements, no `export let`.
- **No new runtime dependencies** without a strong reason. The client is deliberately zero-dep (system fonts, hand-rolled components); the server is Bun built-ins only. (Lint/format tooling devDependencies are a separate bar — `oxlint-tsgolint` was added for type-aware linting.)
- Comments explain _why_ or state invariants; they never narrate what the next line does.
- TypeScript: no `any` outside tests; prefer discriminated unions (see `ClientMessage`/`ServerMessage`) over optional-field grab-bags.

## Testing

- Engine changes require `bun:test` coverage in `server/engine/*.test.ts`. Pure functions (scoring, masking, words, text) get direct unit tests; `Room` behavior is tested by driving a room with fake deps and asserting on the emitted messages — never by reaching into private state.
- Anything timing-dependent must go through `deps.now`/`deps.schedule` so tests can advance a fake clock deterministically. Adding a raw `setTimeout`/`Date.now()` inside the engine is a bug.

## Workflow

- Small, logical commits; imperative subject line ("Add X", "Fix Y"), no trailer noise.
- Feature branches + PRs into `main`; CI green before merge.
- If you change the protocol, the engine, and the client in one effort, keep them reviewable: protocol commit first, then server, then client.
