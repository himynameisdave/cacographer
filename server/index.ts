/**
 * Bun game server: HTTP API + WebSocket transport in a single Bun.serve process.
 * In production it also serves the SvelteKit static build (adapter-static → ./build).
 * In dev, Vite (port 5173) serves the app and talks to this server via CORS.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { type Server, type ServerWebSocket } from 'bun';
import { type ServerMessage } from '../src/lib/protocol';
import { RoomManager } from './engine/RoomManager';
import { type Bucket, isClientMessage, safeStaticPath, take } from './net';

const PORT = Number(process.env.PORT ?? 3001);

type SocketData = {
	code: string | null;
	playerId: string | null;
};

type Socket = ServerWebSocket<SocketData>;

// ---------------------------------------------------------------------------
// Socket registry + room manager
// ---------------------------------------------------------------------------

/** Sockets keyed `${roomCode}:${playerId}`. A missing socket is silently dropped —
 * the Room keeps the player in a grace period until `disconnect` fires. */
const registry = new Map<string, Socket>();

const manager = new RoomManager((code, playerId, msg) => {
	registry.get(`${code}:${playerId}`)?.send(JSON.stringify(msg));
});

function sendTo(ws: Socket, msg: ServerMessage): void {
	ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Rate limiting — per-socket token buckets (refill/spend math lives in net.ts)
// ---------------------------------------------------------------------------

type Buckets = {
	draw: Bucket;
	text: Bucket;
	other: Bucket;
};

const bucketsBySocket = new WeakMap<Socket, Buckets>();

function bucketsFor(ws: Socket): Buckets {
	let b = bucketsBySocket.get(ws);
	if (!b) {
		const now = Date.now();
		b = {
			draw: { tokens: 120, last: now },
			text: { tokens: 10, last: now },
			other: { tokens: 20, last: now }
		};
		bucketsBySocket.set(ws, b);
	}
	return b;
}

// ---------------------------------------------------------------------------
// Static build serving (production: adapter-static output in ./build)
// ---------------------------------------------------------------------------

const BUILD_DIR = path.resolve(import.meta.dir, '../build');
const hasBuild = existsSync(BUILD_DIR) && existsSync(path.join(BUILD_DIR, 'index.html'));

function serveStatic(pathname: string): Response {
	const indexHtml = path.join(BUILD_DIR, 'index.html');
	let filePath = safeStaticPath(BUILD_DIR, pathname);

	// Directory or missing file → SPA fallback (adapter-static's fallback page).
	let stat: ReturnType<typeof statSync> | null = null;
	try {
		stat = statSync(filePath);
	} catch {
		stat = null;
	}
	if (!stat || !stat.isFile()) {
		filePath = indexHtml;
	}

	const headers = new Headers();
	if (filePath === indexHtml) {
		headers.set('Cache-Control', 'no-cache');
	} else if (pathname.startsWith('/_app/immutable')) {
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	}

	// Bun.file infers Content-Type from the extension.
	return new Response(Bun.file(filePath), { headers });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'content-type'
} as const;

function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: { 'Access-Control-Allow-Origin': '*' }
	});
}

// Request is read-only here (only .url/.method are read), but its nested Headers/
// ReadableStream/AbortSignal members are inherently mutable classes, so no wrapper can make it
// deeply readonly.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see comment above
function fetchHandler(req: Request, server: Server<SocketData>): Response | undefined {
	const url = new URL(req.url);
	const { pathname } = url;

	if (pathname.startsWith('/api/')) {
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// Cheap liveness probe for the platform health check (e.g. Railway). Serves before
		// room state so an idle deploy still reports healthy.
		if (req.method === 'GET' && pathname === '/api/health') {
			return json({ ok: true });
		}

		if (req.method === 'POST' && pathname === '/api/rooms') {
			const room = manager.create();
			return json({ code: room.code });
		}

		const roomMatch = /^\/api\/rooms\/(?<code>[^/]+)$/u.exec(pathname);
		if (req.method === 'GET' && roomMatch?.groups) {
			// `code` is a non-optional group in the pattern above, so any match defines it —
			// `groups` is just typed as an open record.
			const room = manager.get(roomMatch.groups.code!);
			if (!room) {
				return json({ exists: false });
			}
			return json({
				exists: true,
				phase: room.phase,
				playerCount: room.connectedCount,
				maxPlayers: room.settings.maxPlayers
			});
		}

		return json({ error: 'not_found' }, 404);
	}

	if (pathname === '/ws') {
		const upgraded = server.upgrade(req, { data: { code: null, playerId: null } });
		if (upgraded) {
			return undefined;
		}
		return new Response('WebSocket upgrade failed', { status: 400 });
	}

	if (hasBuild) {
		return serveStatic(pathname);
	}

	// Dev mode: Vite serves the app; nothing to serve here.
	return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const MAX_MESSAGE_BYTES = 64 * 1024;

function handleJoin(ws: Socket, msg: Readonly<Record<string, unknown>>): void {
	if (msg.type !== 'join' || typeof msg.code !== 'string' || typeof msg.name !== 'string') {
		sendTo(ws, { type: 'error', code: 'bad_message', message: 'Expected a join message' });
		return;
	}

	const code = msg.code.toUpperCase();
	const room = manager.get(code);
	if (!room) {
		sendTo(ws, { type: 'error', code: 'room_not_found', message: 'Room not found' });
		ws.close();
		return;
	}

	// `register` runs after room state is updated but before any messages are
	// sent, so the registry entry exists when the 'joined' message goes out.
	// avatar/nameColor pass through unvalidated — the engine sanitizes them.
	const result = room.join(msg.name, msg.avatar, msg.nameColor, (id) => {
		ws.data.code = room.code;
		ws.data.playerId = id;
		registry.set(`${room.code}:${id}`, ws);
	});

	if (!result.ok) {
		sendTo(ws, { type: 'error', code: result.code, message: result.message });
		ws.close();
	}
}

function messageHandler(ws: Socket, raw: string | Buffer): void {
	const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
	if (size > MAX_MESSAGE_BYTES) {
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
	} catch {
		sendTo(ws, { type: 'error', code: 'bad_message', message: 'Invalid JSON' });
		return;
	}
	if (!isClientMessage(parsed)) {
		sendTo(ws, { type: 'error', code: 'bad_message', message: 'Malformed message' });
		return;
	}
	const msg = parsed;

	// Not joined yet: the only acceptable message is 'join'.
	if (ws.data.playerId === null) {
		handleJoin(ws, msg);
		return;
	}

	// Joined: rate-limit, then hand off to the room.
	const buckets = bucketsFor(ws);
	const now = Date.now();
	if (msg.type === 'draw') {
		const r = take(buckets.draw, 60, 120, now);
		buckets.draw = r.bucket;
		if (!r.allowed) {
			return;
		} // silently drop
	} else if (msg.type === 'guess' || msg.type === 'chat') {
		const r = take(buckets.text, 5, 10, now);
		buckets.text = r.bucket;
		if (!r.allowed) {
			sendTo(ws, { type: 'error', code: 'rate_limited', message: 'Slow down' });
			return;
		}
	} else {
		const r = take(buckets.other, 10, 20, now);
		buckets.other = r.bucket;
		if (!r.allowed) {
			return;
		} // silently drop
	}

	// data.code is `string | null` but handleJoin sets it before this point is ever reached — see
	// the early return on ws.data.playerId === null above.
	manager.get(ws.data.code!)?.handleMessage(ws.data.playerId, msg);
}

function closeHandler(ws: Socket): void {
	const key = `${ws.data.code}:${ws.data.playerId}`;
	// Identity check: after a same-name rejoin a NEW socket owns this key, and
	// the OLD socket's close must not disconnect the player.
	if (ws.data.playerId !== null && registry.get(key) === ws) {
		registry.delete(key);
		// See the comment on the equivalent call in messageHandler above.
		manager.get(ws.data.code!)?.disconnect(ws.data.playerId);
	}
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve<SocketData>({
	port: PORT,
	fetch: fetchHandler,
	websocket: {
		message: messageHandler,
		close: closeHandler
	}
});

console.log(
	`Cacographer game server listening on http://localhost:${server.port} ` +
		`(${hasBuild ? 'serving static build from ./build' : 'dev mode: no ./build, Vite serves the app'})`
);
