# Contributing to cacographer

A Skribbl-clone drawing/guessing game. Product scope: `docs/PRD.md`. Architecture: `docs/TRD.md`. Read both before making non-trivial changes.

## Commands

```sh
bun run dev           # game server (:3001) + Vite (:5173) together
bun test              # all unit tests (engine + client)
bun test --coverage   # + per-file coverage floor (what CI runs; plain `bun test` is ungated)
bun run test:server   # engine tests only (server/**)
bun run test:client   # client tests only (src/**)
bun run lint          # oxlint, strict — must be clean
bun run format        # oxfmt --write (tabs, single quotes, 100 cols)
bun run format:check  # what CI runs
bun run check         # svelte-check (client, src/**), fails on warnings
bun run check:server  # tsc 7 native/Go (server/**, via server/tsconfig.json)
bun run build         # static client → build/
```

CI (`.github/workflows/ci.yml`) runs lint → format:check → check → check:server → test → build. All six must pass; run them locally before pushing. A Husky pre-commit hook (`.husky/pre-commit`) already runs format and lint on what you stage via `lint-staged`, then `check:server` over the whole server project; `bun run check` is CI-only.

**The two typecheck scopes are separate on purpose.** svelte-check's tsconfig (via `.svelte-kit/tsconfig.json`) only reaches `src/**`, and the server is a Bun process with no DOM — so `server/tsconfig.json` is standalone, owns `server/**` plus the shared `src/lib/protocol.ts`, and is what `check:server` and oxlint's type-aware mode both use. Add a file under `server/` and it's covered automatically; there is no third scope.

**The two scopes also run two different TypeScript majors, on purpose.** `check:server` runs TypeScript 7 — the native (Go) compiler — invoked as `node_modules/typescript-7/bin/tsc`, where `typescript-7` is a package alias (`npm:typescript@^7`). This puts the server typecheck on the same Go typechecker that `oxlint-tsgolint` already embeds, so the two can no longer disagree about `server/**`. The client scope (`bun run check`, svelte-check) stays on the default `typescript` devDependency, still TS 6, because svelte-check `^4.7.x` crashes on the TS 7 API surface (`typescript.sys` is undefined in the native port) and has no flag to point at a different compiler — it binds to the hoisted `typescript`, so that one has to be the version svelte-check tolerates. Both strict flags `server/tsconfig.json` leans on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) are honored by the native port. When svelte-check ships TS 7 support, collapse this back to a single `typescript` at 7 and drop the alias.

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
- **Prefer pure functions; do not mutate parameters.** When `prefer-readonly-parameter-types` fires, the default fix is to make the function pure — take the value by `readonly`/`Readonly<T>` and return a new value — not to mutate the argument in place. `Readonly` is the enforcement mechanism for this, and disabling it to keep mutating defeats the point. An `oxlint-disable` for this rule is a last resort reserved for a genuine hot-path/in-place-state case where returning a fresh value is measurably wrong, and it must carry a comment explaining _why purity doesn't work here_ — not merely restating that the code mutates. "The function reassigns fields" is not a justification; it's the thing the rule is asking you to reconsider. If you find yourself reaching for the disable to save effort, refactor to pure instead.
- **Prefer `type` over `interface`** (`typescript/consistent-type-definitions`). Both work in TS, but this codebase picked one so it doesn't have to be decided per-PR.
- **Prefer `Set`/`Map` over array scans** where membership/lookup is the point — e.g. `Set#has()` over `Array#includes()` (`unicorn/prefer-set-has`).
- **Exported functions get a one-line JSDoc description** (see `server/engine/scoring.ts`) where the name/signature alone doesn't already say enough. This is a code-review expectation, not lint-enforced — oxlint's `jsdoc` plugin has no "a JSDoc block must exist" rule, and `require-param`/`require-returns` are deliberately off since they'd force full tag blocks onto every documented function, which is more ceremony than this codebase's terse style wants. `jsdoc/check-tag-names` stays on to catch typos in whatever JSDoc is written.
- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`. No legacy stores, no `$:` reactive statements, no `export let`.
- **No new runtime dependencies** without a strong reason. The client is deliberately zero-dep (system fonts, hand-rolled components); the server is Bun built-ins only. (Lint/format tooling devDependencies are a separate bar — `oxlint-tsgolint` was added for type-aware linting.)
- Comments explain _why_ or state invariants; they never narrate what the next line does.
- TypeScript: no `any` outside tests; prefer discriminated unions (see `ClientMessage`/`ServerMessage`) over optional-field grab-bags.

## Testing

- The runner is `bun:test` everywhere — engine and client both. There is no second test framework.
- Engine changes require `bun:test` coverage in `server/engine/*.test.ts`. Pure functions (scoring, masking, words, text) get direct unit tests; `Room` behavior is tested by driving a room with fake deps and asserting on the emitted messages — never by reaching into private state.
- Anything timing-dependent must go through `deps.now`/`deps.schedule` so tests can advance a fake clock deterministically. Adding a raw `setTimeout`/`Date.now()` inside the engine is a bug. This applies to `RoomManager` too, not just `Room` — both take injected time/randomness.
- Client tests live in `src/**/*.test.ts` and also run under `bun:test`. Svelte 5 rune modules (`*.svelte.ts`) are compiler macros, so `bun test` can't import them raw; `test/svelte-preload.ts` (wired via `bunfig.toml`) strips the types and runs Svelte's `compileModule` on import. Logic classes like `GameState` are tested by instantiating them and feeding `ServerMessage`s — no DOM, no component mounting.

### Coverage is a floor, not a target — do not game it

CI runs `bun test --coverage` and `bunfig.toml` sets a low `coverageThreshold` (0.7). Bun enforces it **per file** against the weakest of that file's line/function/statement coverage, so the gate is only ever as high as the least-covered file. It exists for **one** purpose: to fail CI when a file's coverage falls off a cliff — a large untested addition, a deleted test file, a whole module left uncovered. It is set deliberately _below_ current coverage as a safety net.

**Never write a test whose purpose is to move that number.** A test earns its place by pinning a real behavior or contract — the ones already here assert on emitted messages, scoring, masking, reconnect timing, state after a `ServerMessage`. A test that calls a getter just so a line counts as covered, asserts nothing meaningful, or exists to turn a red gate green is worse than no test: it's dead weight that has to be read and maintained forever, and it quietly lowers the bar for what "tested" means. If a genuinely-important path is uncovered, cover it because it matters, not because the metric dipped. If coverage is low and there's nothing real to assert, **leave it low** — that's information, not a failure. Raising `coverageThreshold` to chase a percentage is the same anti-pattern one level up; don't.

## Workflow

- Small, logical commits; imperative subject line ("Add X", "Fix Y"), no trailer noise.
- Feature branches + PRs into `main`; CI green before merge.
- If you change the protocol, the engine, and the client in one effort, keep them reviewable: protocol commit first, then server, then client.
