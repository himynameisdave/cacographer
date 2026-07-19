# Pin the Bun version this repo develops against (bun --version → 1.3.13).
# Railway auto-detects a Dockerfile and uses it instead of Nixpacks, which
# removes the Bun-vs-Node lockfile guessing that bun.lock alone can trip on.
FROM oven/bun:1.3.13 AS build
WORKDIR /app

# Install deps against the committed lockfile (devDeps included — the build needs Vite/SvelteKit).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the static client (vite build → ./build).
COPY . .
RUN bun run build

# --- Lean runtime image: the server is Bun/Node built-ins only, so it needs no node_modules. ---
FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
COPY --from=build /app/src/lib/protocol.ts ./src/lib/protocol.ts
COPY --from=build /app/package.json ./package.json

# Railway injects $PORT; server/index.ts already reads it (Bun binds 0.0.0.0 by default).
CMD ["bun", "server/index.ts"]
