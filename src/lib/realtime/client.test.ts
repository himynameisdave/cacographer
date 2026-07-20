/**
 * GameSocket is a reconnect/backoff state machine with race guards (`ws !== this.ws`). We drive
 * it with a fake WebSocket (events fired by hand) and Bun's fake timers, so backoff timing and
 * stale-socket handling are deterministic — no real sockets, no wall-clock waits.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { type ServerMessage } from '../protocol';
import { GameSocket, type SocketStatus } from './client';

type Listener = (ev: Readonly<{ data?: string }>) => void;

/** Minimal WebSocket stand-in: records sends, exposes fire* helpers to emit lifecycle events. */
class FakeWebSocket {
	static readonly OPEN = 1;
	static instances: FakeWebSocket[] = [];

	readyState = 0;
	readonly sent: string[] = [];
	closed = false;
	private readonly listeners = new Map<string, Listener[]>();

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: Listener): void {
		const arr = this.listeners.get(type) ?? [];
		arr.push(listener);
		this.listeners.set(type, arr);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
	}

	private emit(type: string, ev: Readonly<{ data?: string }> = {}): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(ev);
		}
	}

	fireOpen(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.emit('open');
	}

	fireMessage(data: string): void {
		this.emit('message', { data });
	}

	fireClose(): void {
		this.readyState = 3;
		this.emit('close');
	}
}

let realWebSocket: typeof WebSocket;

beforeEach(() => {
	realWebSocket = globalThis.WebSocket;
	FakeWebSocket.instances = [];
	// FakeWebSocket implements only the slice of WebSocket that GameSocket touches.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double, see comment above
	globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
	globalThis.WebSocket = realWebSocket;
});

function setup() {
	const statuses: SocketStatus[] = [];
	const messages: ServerMessage[] = [];
	const gs = new GameSocket('ws://test/ws', {
		onStatus: (s) => {
			statuses.push(s);
		},
		onMessage: (m) => {
			messages.push(m);
		}
	});
	return { gs, statuses, messages };
}

function latest(): FakeWebSocket {
	const ws = FakeWebSocket.instances.at(-1);
	if (!ws) {
		throw new Error('no socket created');
	}
	return ws;
}

describe('connect / open', () => {
	test('connect reports connecting, then open once the socket opens', () => {
		const { gs, statuses } = setup();
		gs.connect();
		expect(statuses).toEqual(['connecting']);
		expect(FakeWebSocket.instances).toHaveLength(1);
		latest().fireOpen();
		expect(statuses).toEqual(['connecting', 'open']);
	});
});

describe('send', () => {
	test('messages before open are dropped; after open they go out as JSON', () => {
		const { gs } = setup();
		gs.connect();
		gs.send({ type: 'startGame' });
		expect(latest().sent).toHaveLength(0);

		latest().fireOpen();
		gs.send({ type: 'startGame' });
		expect(latest().sent).toEqual([JSON.stringify({ type: 'startGame' })]);
	});
});

describe('incoming messages', () => {
	test('valid JSON is delivered; malformed frames are ignored', () => {
		const { gs, messages } = setup();
		gs.connect();
		latest().fireOpen();
		latest().fireMessage(JSON.stringify({ type: 'clearCanvas' }));
		expect(messages).toEqual([{ type: 'clearCanvas' }]);

		latest().fireMessage('{not json');
		expect(messages).toHaveLength(1);
	});
});

describe('reconnect / backoff', () => {
	test('an unexpected close schedules a reconnect after the backoff delay', () => {
		const { gs, statuses } = setup();
		gs.connect();
		latest().fireOpen();
		latest().fireClose();
		expect(statuses.at(-1)).toBe('reconnecting');
		expect(FakeWebSocket.instances).toHaveLength(1); // not yet

		jest.advanceTimersByTime(500);
		expect(FakeWebSocket.instances).toHaveLength(2); // reconnected
	});

	test('backoff doubles while reconnects keep failing', () => {
		const { gs } = setup();
		gs.connect();
		latest().fireOpen();

		latest().fireClose(); // first backoff: 500ms
		jest.advanceTimersByTime(500);
		expect(FakeWebSocket.instances).toHaveLength(2);

		latest().fireClose(); // never opened → next backoff: 1000ms
		jest.advanceTimersByTime(999);
		expect(FakeWebSocket.instances).toHaveLength(2);
		jest.advanceTimersByTime(1);
		expect(FakeWebSocket.instances).toHaveLength(3);
	});

	test('a successful open resets the backoff to the floor', () => {
		const { gs } = setup();
		gs.connect();
		latest().fireOpen();

		latest().fireClose(); // schedule at 500
		jest.advanceTimersByTime(500);
		latest().fireOpen(); // success → backoff reset

		latest().fireClose(); // should schedule at 500 again, not 1000
		jest.advanceTimersByTime(499);
		expect(FakeWebSocket.instances).toHaveLength(2);
		jest.advanceTimersByTime(1);
		expect(FakeWebSocket.instances).toHaveLength(3);
	});

	test('events from a stale socket are ignored after reconnect', () => {
		const { gs, messages, statuses } = setup();
		gs.connect();
		const first = latest();
		first.fireOpen();
		first.fireClose();
		jest.advanceTimersByTime(500);
		const second = latest();
		expect(second).not.toBe(first);

		// The old socket firing late must not reach handlers or flip status.
		first.fireMessage(JSON.stringify({ type: 'clearCanvas' }));
		expect(messages).toHaveLength(0);
		const before = statuses.length;
		first.fireOpen();
		expect(statuses).toHaveLength(before);

		// The current socket still works.
		second.fireOpen();
		expect(statuses.at(-1)).toBe('open');
	});
});

describe('intentional close', () => {
	test('close reports closed and cancels any pending reconnect', () => {
		const { gs, statuses } = setup();
		gs.connect();
		latest().fireOpen();
		latest().fireClose(); // schedules a reconnect
		gs.close();
		expect(statuses.at(-1)).toBe('closed');

		jest.advanceTimersByTime(10_000);
		expect(FakeWebSocket.instances).toHaveLength(1); // reconnect was cancelled
	});
});
