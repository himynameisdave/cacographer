import { type ClientMessage, type ServerMessage } from '$lib/protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface GameSocketHandlers {
	onMessage: (msg: ServerMessage) => void;
	onStatus: (status: SocketStatus) => void;
}

const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 8000;

/**
 * Thin WebSocket wrapper: JSON in/out, auto-reconnect with exponential
 * backoff on unexpected closes. An intentional `close()` disables reconnect.
 * Messages sent while the socket isn't open are dropped — the server
 * re-broadcasts full room state on rejoin, so nothing critical is lost.
 */
export class GameSocket {
	private ws: WebSocket | null = null;
	private intentionallyClosed = false;
	private backoff = BACKOFF_START_MS;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private url: string,
		private handlers: GameSocketHandlers
	) {}

	connect(): void {
		this.intentionallyClosed = false;
		this.open('connecting');
	}

	send(msg: ClientMessage): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	close(): void {
		this.intentionallyClosed = true;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
		}
		this.reconnectTimer = null;
		const { ws } = this;
		this.ws = null;
		ws?.close();
		this.handlers.onStatus('closed');
	}

	private open(status: SocketStatus): void {
		this.handlers.onStatus(status);
		const ws = new WebSocket(this.url);
		this.ws = ws;

		ws.addEventListener('open', () => {
			if (ws !== this.ws) {
				return;
			}
			this.backoff = BACKOFF_START_MS;
			this.handlers.onStatus('open');
		});

		ws.addEventListener('message', (ev) => {
			if (ws !== this.ws) {
				return;
			}
			let msg: ServerMessage;
			try {
				msg = JSON.parse(String(ev.data));
			} catch {
				return; // ignore malformed frames
			}
			this.handlers.onMessage(msg);
		});

		// No 'error' listener: a close event always follows and handles it.
		ws.addEventListener('close', () => {
			if (ws !== this.ws) {
				return;
			}
			this.ws = null;
			if (this.intentionallyClosed) {
				this.handlers.onStatus('closed');
				return;
			}
			this.scheduleReconnect();
		});
	}

	private scheduleReconnect(): void {
		this.handlers.onStatus('reconnecting');
		const delay = this.backoff;
		this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.intentionallyClosed) {
				this.open('reconnecting');
			}
		}, delay);
	}
}
