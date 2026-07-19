/**
 * RoomManager is driven with injected time (FakeClock) and randomness (a queued
 * fraction stub) so code generation and teardown scheduling are deterministic —
 * the same reason Room is tested this way (CLAUDE.md).
 */
import { describe, expect, test } from 'bun:test';
import { type PlayerId, type ServerMessage } from '../../src/lib/protocol';
import { type RoomDeps, type TimerHandle } from './Room';
import { type ManagerDeps, RoomManager, TEARDOWN_MS } from './RoomManager';
import { FakeClock } from './testUtils';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** The random() fractions that make generateCode() emit exactly `code`. */
function fractionsFor(code: string): number[] {
	const fractions: number[] = [];
	for (const ch of code) {
		fractions.push(ALPHABET.indexOf(ch) / ALPHABET.length);
	}
	return fractions;
}

type Sent = { readonly code: string; readonly playerId: PlayerId; readonly msg: ServerMessage };

function harness(codes: readonly string[] = []) {
	const clock = new FakeClock();
	const sent: Sent[] = [];
	// Fractions for each requested code, consumed 5 at a time by generateCode();
	// once drained, random() returns 0 → 'A' repeated.
	const randQueue = codes.flatMap((c) => fractionsFor(c));

	const deps: ManagerDeps = {
		schedule: (fn, ms) => {
			clock.schedule(fn, ms);
		},
		random: () => (randQueue.length > 0 ? randQueue.shift()! : 0),
		makeRoomDeps: (send): RoomDeps => ({
			send,
			now: () => clock.now,
			schedule: (fn, ms) => clock.schedule(fn, ms),
			cancel: (h: TimerHandle) => {
				// TimerHandle is opaque per RoomDeps; here it's always FakeClock's numeric id.
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
				clock.cancel(h as number);
			},
			random: () => 0
		})
	};

	const manager = new RoomManager((code, playerId, msg) => {
		sent.push({ code, playerId, msg });
	}, deps);

	return { manager, clock, sent };
}

describe('code generation', () => {
	test('codes are 5 chars from the unambiguous alphabet', () => {
		const { manager } = harness();
		const room = manager.create();
		// Five chars, all drawn from the unambiguous alphabet (no I/O/0/1).
		expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/u);
	});

	test('retries on collision until a free code is found', () => {
		// First create → ABCDE. Second create tries ABCDE again (taken), then FGHJK.
		const { manager } = harness(['ABCDE', 'ABCDE', 'FGHJK']);
		const first = manager.create();
		const second = manager.create();
		expect(first.code).toBe('ABCDE');
		expect(second.code).toBe('FGHJK');
		expect(manager.rooms.size).toBe(2);
	});
});

describe('lookup', () => {
	test('get() is case-insensitive and misses cleanly', () => {
		const { manager } = harness(['ABCDE']);
		const room = manager.create();
		expect(manager.get('abcde')).toBe(room);
		expect(manager.get('ABCDE')).toBe(room);
		expect(manager.get('ZZZZZ')).toBeUndefined();
	});
});

describe('teardown', () => {
	test('an empty room is disposed and removed after TEARDOWN_MS', () => {
		const { manager, clock } = harness(['ABCDE']);
		const room = manager.create();
		expect(manager.get(room.code)).toBe(room);

		clock.advance(TEARDOWN_MS - 1);
		expect(manager.get(room.code)).toBe(room); // not yet

		clock.advance(1);
		expect(manager.get(room.code)).toBeUndefined();
		expect(manager.rooms.size).toBe(0);
	});

	test('a room with a connected player survives teardown', () => {
		const { manager, clock } = harness(['ABCDE']);
		const room = manager.create();
		room.join('Alice', null, null, () => {});
		expect(room.connectedCount).toBe(1);

		clock.advance(TEARDOWN_MS);
		expect(manager.get(room.code)).toBe(room);
	});

	test('a room that empties later is torn down on the re-scheduled sweep', () => {
		const { manager, clock } = harness(['ABCDE']);
		const room = manager.create();
		let leaverId: PlayerId | null = null;
		room.join('Alice', null, null, (id) => {
			leaverId = id;
		});

		// The create-time teardown fires with a player present → room kept.
		clock.advance(TEARDOWN_MS);
		expect(manager.get(room.code)).toBe(room);

		// Player disconnects; Room's onEmpty callback re-schedules a teardown.
		room.disconnect(leaverId!);
		clock.advance(TEARDOWN_MS);
		expect(manager.get(room.code)).toBeUndefined();
	});
});

describe('send wiring', () => {
	test('room messages reach send() tagged with the room code', () => {
		const { manager, sent } = harness(['ABCDE']);
		const room = manager.create();
		room.join('Alice', null, null, () => {});

		expect(sent.length).toBeGreaterThan(0);
		expect(sent.every((s) => s.code === room.code)).toBe(true);
		expect(sent.some((s) => s.msg.type === 'joined')).toBe(true);
	});
});
