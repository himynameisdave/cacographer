/**
 * GameState.apply() is the client's incremental mirror of server state — a switch over every
 * ServerMessage variant. It needs no DOM: instantiate the class, feed it messages, assert on
 * the resulting state. Rune reactivity is compiled in by test/svelte-preload.ts.
 */
import { describe, expect, jest, test } from 'bun:test';
import { DEFAULT_SETTINGS, type ClientPlayer, type ClientRoom, type DrawOp } from './protocol';
import { GameState } from './game.svelte.ts';

const stroke = (id: string, points: readonly (readonly [number, number])[]): DrawOp => ({
	kind: 'stroke',
	id,
	points,
	color: '#000',
	size: 4
});

function makePlayer(id: string, over: Partial<ClientPlayer> = {}): ClientPlayer {
	return {
		id,
		name: id,
		score: 0,
		isHost: false,
		connected: true,
		guessedThisTurn: false,
		avatar: null,
		nameColor: null,
		...over
	};
}

function makeRoom(over: Partial<ClientRoom> = {}): ClientRoom {
	return {
		code: 'ABCDE',
		phase: 'lobby',
		players: [],
		settings: DEFAULT_SETTINGS,
		round: 0,
		turnOrder: [],
		turnIndex: 0,
		drawerId: null,
		masked: null,
		endsAt: null,
		ops: [],
		lastWord: null,
		lastGains: null,
		winnerId: null,
		gallery: null,
		...over
	};
}

/** A GameState already joined as `you`, with the given room. */
function joined(you: string, room: ClientRoom): GameState {
	const g = new GameState();
	g.apply({ type: 'joined', you, room });
	return g;
}

describe('joined / roomState', () => {
	test('joined seeds identity, room, and clears secrets', () => {
		const g = new GameState();
		g.word = 'stale';
		g.apply({ type: 'joined', you: 'p1', room: makeRoom({ players: [makePlayer('p1')] }) });
		expect(g.you).toBe('p1');
		expect(g.room?.code).toBe('ABCDE');
		expect(g.word).toBeNull();
		expect(g.fatalError).toBeNull();
	});

	test('roomState replaces the room and drops choices/word outside their phases', () => {
		const g = joined('p1', makeRoom());
		g.choices = { words: ['a'], endsAt: 1 };
		g.word = 'secret';
		g.apply({ type: 'roomState', room: makeRoom({ phase: 'reveal' }) });
		expect(g.room?.phase).toBe('reveal');
		expect(g.choices).toBeNull();
		expect(g.word).toBeNull();
	});
});

describe('roster', () => {
	test('playerJoined appends a new player and replaces an existing one', () => {
		const g = joined('p1', makeRoom({ players: [makePlayer('p1')] }));
		g.apply({ type: 'playerJoined', player: makePlayer('p2', { name: 'Bo' }) });
		expect(g.room?.players.map((p) => p.id)).toEqual(['p1', 'p2']);

		g.apply({ type: 'playerJoined', player: makePlayer('p2', { name: 'Bobby' }) });
		expect(g.room?.players).toHaveLength(2);
		expect(g.room?.players.find((p) => p.id === 'p2')?.name).toBe('Bobby');
	});

	test('playerLeft removes, but the identity is remembered for chat history', () => {
		const g = joined(
			'p1',
			makeRoom({ players: [makePlayer('p1'), makePlayer('p2', { nameColor: '#abc' })] })
		);
		g.apply({ type: 'playerLeft', id: 'p2' });
		expect(g.room?.players.map((p) => p.id)).toEqual(['p1']);
		expect(g.identities.p2).toEqual({ avatar: null, color: '#abc' });
	});

	test('playerConnection toggles the connected flag', () => {
		const g = joined('p1', makeRoom({ players: [makePlayer('p1')] }));
		g.apply({ type: 'playerConnection', id: 'p1', connected: false });
		expect(g.room?.players[0]?.connected).toBe(false);
	});

	test('hostChanged moves the host flag to exactly one player', () => {
		const g = joined(
			'p1',
			makeRoom({ players: [makePlayer('p1', { isHost: true }), makePlayer('p2')] })
		);
		g.apply({ type: 'hostChanged', hostId: 'p2' });
		expect(g.room?.players.find((p) => p.isHost)?.id).toBe('p2');
		expect(g.room?.players.filter((p) => p.isHost)).toHaveLength(1);
	});
});

describe('turn lifecycle', () => {
	test('turnStarted resets the canvas, guesses, and votes into choosing', () => {
		const g = joined(
			'p1',
			makeRoom({ phase: 'reveal', players: [makePlayer('p1', { guessedThisTurn: true })] })
		);
		g.voteCounts = { likes: 3, dislikes: 1 };
		g.apply({ type: 'turnStarted', drawerId: 'p1', round: 2, turnIndex: 1, endsAt: 999 });
		expect(g.room?.phase).toBe('choosing');
		expect(g.room?.drawerId).toBe('p1');
		expect(g.room?.round).toBe(2);
		expect(g.room?.ops).toEqual([]);
		expect(g.room?.players[0]?.guessedThisTurn).toBe(false);
		expect(g.voteCounts).toEqual({ likes: 0, dislikes: 0 });
	});

	test('turnEnded patches totals and switches to reveal', () => {
		const g = joined(
			'p1',
			makeRoom({ phase: 'drawing', players: [makePlayer('p1', { score: 10 }), makePlayer('p2')] })
		);
		g.apply({
			type: 'turnEnded',
			word: 'apple',
			gains: { p1: 5 },
			totals: { p1: 15, p2: 3 },
			endsAt: 1000
		});
		expect(g.room?.phase).toBe('reveal');
		expect(g.room?.lastWord).toBe('apple');
		expect(g.room?.players.find((p) => p.id === 'p1')?.score).toBe(15);
		expect(g.room?.players.find((p) => p.id === 'p2')?.score).toBe(3);
	});

	test('gameEnded sets the winner, freezes the clock, and patches totals', () => {
		const g = joined('p1', makeRoom({ phase: 'reveal', players: [makePlayer('p1')] }));
		g.apply({ type: 'gameEnded', totals: { p1: 42 }, winnerId: 'p1' });
		expect(g.room?.phase).toBe('finished');
		expect(g.room?.winnerId).toBe('p1');
		expect(g.room?.endsAt).toBeNull();
		expect(g.room?.players[0]?.score).toBe(42);
	});
});

describe('canvas', () => {
	test('consecutive stroke ops with the same id merge into one', () => {
		const g = joined('p1', makeRoom({ phase: 'drawing' }));
		g.apply({ type: 'draw', op: stroke('s1', [[0, 0]]) });
		g.apply({ type: 'draw', op: stroke('s1', [[1, 1]]) });
		expect(g.room?.ops).toHaveLength(1);
		const op = g.room?.ops[0];
		expect(op?.kind === 'stroke' && op.points).toEqual([
			[0, 0],
			[1, 1]
		]);
	});

	test('a different stroke id and a fill stay separate ops', () => {
		const g = joined('p1', makeRoom({ phase: 'drawing' }));
		g.apply({ type: 'draw', op: stroke('s1', [[0, 0]]) });
		g.apply({ type: 'draw', op: stroke('s2', [[1, 1]]) });
		g.apply({ type: 'draw', op: { kind: 'fill', id: 'f1', x: 2, y: 2, color: '#f00' } });
		expect(g.room?.ops).toHaveLength(3);
	});

	test('clearCanvas empties ops and canvasState replaces them wholesale', () => {
		const g = joined('p1', makeRoom({ phase: 'drawing' }));
		g.apply({ type: 'draw', op: stroke('s1', [[0, 0]]) });
		g.apply({ type: 'clearCanvas' });
		expect(g.room?.ops).toEqual([]);
		g.apply({ type: 'canvasState', ops: [stroke('s9', [[9, 9]])] });
		expect(g.room?.ops).toHaveLength(1);
	});

	test('letterRevealed updates the mask', () => {
		const g = joined('p1', makeRoom({ phase: 'drawing', masked: '_ _ _' }));
		g.apply({ type: 'letterRevealed', masked: 'a _ _' });
		expect(g.room?.masked).toBe('a _ _');
	});
});

describe('chat', () => {
	test('entries append and are capped at 200', () => {
		const g = joined('p1', makeRoom());
		for (let i = 0; i < 205; i++) {
			g.apply({ type: 'chat', entry: { id: 'p1', name: 'A', text: `m${i}`, scope: 'all' } });
		}
		expect(g.chat).toHaveLength(200);
		expect(g.chat[0]?.text).toBe('m5'); // oldest five dropped
	});

	test('a non-fatal error surfaces in chat; a join error is fatal', () => {
		const g = joined('p1', makeRoom());
		g.apply({ type: 'error', code: 'rate_limited', message: 'Slow down' });
		expect(g.fatalError).toBeNull();
		expect(g.chat.at(-1)?.text).toBe('Slow down');

		g.apply({ type: 'error', code: 'room_full', message: 'Full' });
		expect(g.fatalError?.code).toBe('room_full');
	});
});

describe('close flash timer', () => {
	test('an almost-correct guess flashes, then clears after the timeout', () => {
		jest.useFakeTimers();
		try {
			const g = joined('p1', makeRoom());
			g.apply({ type: 'guessResult', correct: false, close: true });
			expect(g.closeFlash).toBe(true);
			jest.advanceTimersByTime(2500);
			expect(g.closeFlash).toBe(false);
		} finally {
			jest.useRealTimers();
		}
	});

	test('a correct guess does not flash', () => {
		const g = joined('p1', makeRoom());
		g.apply({ type: 'guessResult', correct: true });
		expect(g.closeFlash).toBe(false);
	});
});

describe('derived getters', () => {
	test('me / isHost / isDrawer / playersByScore reflect room state', () => {
		const g = joined(
			'p1',
			makeRoom({
				phase: 'drawing',
				drawerId: 'p1',
				players: [makePlayer('p1', { isHost: true, score: 5 }), makePlayer('p2', { score: 9 })]
			})
		);
		expect(g.me?.id).toBe('p1');
		expect(g.isHost).toBe(true);
		expect(g.isDrawer).toBe(true);
		expect(g.playersByScore.map((p) => p.id)).toEqual(['p2', 'p1']);
	});
});
