import { beforeEach, describe, expect, test } from 'bun:test';
import type { ClientPlayer, ServerMessage } from '$lib/protocol';
import { isMuted, notesFor, play, toggleMute } from '$lib/sound';

const ME = 'p1';
const PLAYER: ClientPlayer = {
	id: 'p2',
	name: 'Bob',
	score: 0,
	isHost: false,
	connected: true,
	guessedThisTurn: false,
	avatar: null,
	nameColor: null
};

describe('notesFor', () => {
	test('correct guesses ring, wrong-but-not-close ones stay silent', () => {
		expect(notesFor({ type: 'guessResult', correct: true }, ME).length).toBe(3);
		expect(notesFor({ type: 'guessResult', correct: false, close: true }, ME).length).toBe(1);
		expect(notesFor({ type: 'guessResult', correct: false, close: false }, ME)).toEqual([]);
	});

	test('my own guess does not double up with the broadcast blip', () => {
		expect(notesFor({ type: 'playerGuessed', id: ME }, ME)).toEqual([]);
		expect(notesFor({ type: 'playerGuessed', id: 'p2' }, ME).length).toBe(1);
	});

	test('every message type sounds the number of notes it should', () => {
		const cases: readonly [ServerMessage, number][] = [
			[{ type: 'playerJoined', player: PLAYER }, 2],
			[{ type: 'playerLeft', id: 'p2' }, 2],
			[{ type: 'wordChoices', choices: ['a'], endsAt: 0 }, 2],
			[{ type: 'drawingStarted', masked: '_', endsAt: 0 }, 2],
			[{ type: 'letterRevealed', masked: 'a' }, 1],
			[{ type: 'turnEnded', word: 'a', gains: {}, totals: {}, endsAt: 0 }, 2],
			[{ type: 'gameEnded', totals: {}, winnerId: ME }, 4],
			[{ type: 'error', code: 'rate_limited', message: 'slow down' }, 1],
			// Bookkeeping the player never needs to hear.
			[{ type: 'timeSync', endsAt: 0 }, 0],
			[{ type: 'clearCanvas' }, 0],
			[{ type: 'yourWord', word: 'apple' }, 0],
			[{ type: 'voteUpdate', likes: 1, dislikes: 0 }, 0]
		];
		for (const [msg, count] of cases) {
			expect(notesFor(msg, ME)).toHaveLength(count);
		}
	});

	test('chatter is silent', () => {
		expect(
			notesFor({ type: 'chat', entry: { id: null, name: '', text: 'hi', scope: 'system' } }, ME)
		).toEqual([]);
	});
});

/** Minimal stand-in for the bits of Web Audio `play()` touches. */
class FakeOscillator {
	type = '';
	frequency = { value: 0 };
	started: number | null = null;
	stopped: number | null = null;
	connect<T>(node: T): T {
		return node;
	}
	start(at: number): void {
		this.started = at;
	}
	stop(at: number): void {
		this.stopped = at;
	}
}

class FakeAudioContext {
	static oscillators: FakeOscillator[] = [];
	currentTime = 0;
	createOscillator(): FakeOscillator {
		const osc = new FakeOscillator();
		FakeAudioContext.oscillators.push(osc);
		return osc;
	}
	createGain() {
		return {
			gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
			connect: <T>(node: T): T => node
		};
	}
	async resume(): Promise<void> {
		await Promise.resolve();
	}
}

const store = new Map<string, string>();

beforeEach(() => {
	FakeAudioContext.oscillators = [];
	store.clear();
	// @ts-expect-error -- test doubles for APIs bun's runtime has no DOM for.
	globalThis.AudioContext = FakeAudioContext;
	// @ts-expect-error -- see above.
	globalThis.localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
		removeItem: (k: string) => {
			store.delete(k);
		}
	};
});

describe('play', () => {
	test('sounds one oscillator per note', () => {
		play({ type: 'letterRevealed', masked: '_ _ _' }, ME);
		expect(FakeAudioContext.oscillators).toHaveLength(1);

		play({ type: 'guessResult', correct: true }, ME);
		expect(FakeAudioContext.oscillators).toHaveLength(4);
	});

	test('muting silences everything', () => {
		expect(toggleMute()).toBe(true);
		play({ type: 'guessResult', correct: true }, ME);
		expect(FakeAudioContext.oscillators).toEqual([]);

		// ...and unmuting brings it back.
		expect(toggleMute()).toBe(false);
		play({ type: 'guessResult', correct: true }, ME);
		expect(FakeAudioContext.oscillators).toHaveLength(3);
	});

	test('a silent message never touches the audio context', () => {
		play({ type: 'timeSync', endsAt: 0 }, ME);
		expect(FakeAudioContext.oscillators).toEqual([]);
	});

	test('mute survives a reload', () => {
		toggleMute();
		expect(isMuted()).toBe(true);
	});
});
