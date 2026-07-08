/**
 * Bun game server: HTTP API + WebSocket transport in a single Bun.serve process.
 * In production it also serves the SvelteKit static build (adapter-static → ./build).
 * In dev, Vite (port 5173) serves the app and talks to this server via CORS.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { type Server, type ServerWebSocket } from 'bun';
import { type ClientMessage, type ServerMessage } from '../src/lib/protocol';
import { RoomManager } from './engine/RoomManager';

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
// Rate limiting — simple token buckets refilled by timestamp
// ---------------------------------------------------------------------------

type Bucket = {
	tokens: number;
	last: number;
};

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

// bucket.tokens/last are reassigned below (refill + spend), so this can't be Readonly<Bucket>.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see comment above
function take(bucket: Bucket, ratePerSec: number, burst: number): boolean {
	const now = Date.now();
	bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.last) / 1000) * ratePerSec);
	bucket.last = now;
	if (bucket.tokens >= 1) {
		bucket.tokens -= 1;
		return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Static build serving (production: adapter-static output in ./build)
// ---------------------------------------------------------------------------

const BUILD_DIR = path.resolve(import.meta.dir, '../build');
const hasBuild = existsSync(BUILD_DIR) && existsSync(path.join(BUILD_DIR, 'index.html'));

function serveStatic(pathname: string): Response {
	const indexHtml = path.join(BUILD_DIR, 'index.html');

	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		decoded = '/';
	}

	// Resolve inside the build dir and guard path traversal.
	let filePath = path.normalize(path.join(BUILD_DIR, decoded));
	if (filePath !== BUILD_DIR && !filePath.startsWith(BUILD_DIR + path.sep)) {
		filePath = indexHtml;
	}

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
	} else if (decoded.startsWith('/_app/immutable')) {
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
function fetchHandler(req: Request, server: Server): Response | undefined {
	const url = new URL(req.url);
	const { pathname } = url;

	if (pathname.startsWith('/api/')) {
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		if (req.method === 'POST' && pathname === '/api/rooms') {
			const room = manager.create();
			return json({ code: room.code });
		}

		const roomMatch = /^\/api\/rooms\/(?<code>[^/]+)$/u.exec(pathname);
		if (req.method === 'GET' && roomMatch?.groups) {
			const room = manager.get(roomMatch.groups.code);
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
	const result = room.join(msg.name, (id) => {
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

	let msg: ClientMessage;
	try {
		msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
	} catch {
		sendTo(ws, { type: 'error', code: 'bad_message', message: 'Invalid JSON' });
		return;
	}
	// msg's static type is optimistic; JSON.parse can actually return null/non-objects here.
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- see comment above
	if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
		sendTo(ws, { type: 'error', code: 'bad_message', message: 'Malformed message' });
		return;
	}

	// Not joined yet: the only acceptable message is 'join'.
	if (ws.data.playerId === null) {
		handleJoin(ws, msg);
		return;
	}

	// Joined: rate-limit, then hand off to the room.
	const buckets = bucketsFor(ws);
	if (msg.type === 'draw') {
		if (!take(buckets.draw, 60, 120)) {
			return;
		} // silently drop
	} else if (msg.type === 'guess' || msg.type === 'chat') {
		if (!take(buckets.text, 5, 10)) {
			sendTo(ws, { type: 'error', code: 'rate_limited', message: 'Slow down' });
			return;
		}
	} else {
		if (!take(buckets.other, 10, 20)) {
			return;
		} // silently drop
	}

	// data.code is set by handleJoin before this point is ever reached (see the early return
	// on ws.data.playerId === null above); tsgolint can't resolve Bun's ServerWebSocket<T>
	// generic (see the file-level oxlintrc override) so it misjudges this assertion as unnecessary.
	manager.get(ws.data.code!)?.handleMessage(ws.data.playerId, msg);
}

function closeHandler(ws: Socket): void {
	const key = `${ws.data.code}:${ws.data.playerId}`;
	// Identity check: after a same-name rejoin a NEW socket owns this key, and
	// the OLD socket's close must not disconnect the player.
	if (ws.data.playerId && registry.get(key) === ws) {
		registry.delete(key);
		// See the comment on the equivalent call in messageHandler above.
		manager.get(ws.data.code!)?.disconnect(ws.data.playerId);
	}
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve<SocketData, undefined>({
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
