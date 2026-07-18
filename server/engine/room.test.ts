import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_SETTINGS,
	LIMITS,
	type PlayerId,
	type Settings,
	type VoteKind
} from '../../src/lib/protocol';
import { POTTY_PHRASES } from './moderation';
import {
	CHOOSE_MS,
	GRACE_MS,
	REDO_LIMIT,
	REPEAT_LIMIT,
	REVEAL_MS,
	SKIP_REVEAL_MS,
	SYNC_MS,
	YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS
} from './Room';
import { Harness, WORDS, chooseWord, choicesFor, startedGame } from './testUtils';

const DRAW_MS = DEFAULT_SETTINGS.drawTimeSeconds * 1000; // 80_000

/** A well-formed (if tiny) PNG data URL for profile tests. */
const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

describe('join', () => {
	test('first player becomes host and receives a joined snapshot', () => {
		const h = new Harness();
		// Collected rather than assigned to a `let`: TS's control-flow analysis can't see that a
		// callback ran, so a `PlayerId | null` binding narrows to `null` at the assertion below.
		const registered: PlayerId[] = [];
		const res = h.room.join('Alice', null, null, (id) => {
			registered.push(id);
		});
		if (!res.ok) {
			throw new Error('join failed');
		}
		expect(registered).toEqual([res.playerId]);
		expect(h.room.hostId).toBe(res.playerId);

		const joined = h.typeTo(res.playerId, 'joined');
		expect(joined).toHaveLength(1);
		expect(joined[0]!.you).toBe(res.playerId);
		expect(joined[0]!.room.players).toHaveLength(1);
		expect(joined[0]!.room.players[0]!.isHost).toBe(true);
		expect(joined[0]!.room.phase).toBe('lobby');
	});

	test('playerJoined is broadcast to others, joiner gets the snapshot instead', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.clear();
		const b = h.join('Bob');

		const toA = h.typeTo(a, 'playerJoined');
		expect(toA).toHaveLength(1);
		expect(toA[0]!.player.name).toBe('Bob');
		expect(toA[0]!.player.isHost).toBe(false);

		expect(h.typeTo(b, 'playerJoined')).toHaveLength(0);
		const joined = h.typeTo(b, 'joined');
		expect(joined).toHaveLength(1);
		expect(joined[0]!.room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
	});

	test('duplicate connected name is rejected (case/whitespace-insensitive)', () => {
		const h = new Harness();
		h.join('Alice');
		const res = h.room.join('  ALICE ', null, null, () => {});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.code).toBe('name_taken');
		}
		expect(h.room.players.size).toBe(1);
	});

	test('join beyond maxPlayers → room_full', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.join('Bob');
		h.send(a, { type: 'updateSettings', settings: { maxPlayers: 2 } });
		const res = h.room.join('Cara', null, null, () => {});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.code).toBe('room_full');
		}
	});

	test('empty name rejected, long name capped', () => {
		const h = new Harness();
		const res = h.room.join('   ', null, null, () => {});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.code).toBe('bad_message');
		}

		const long = h.room.join('x'.repeat(60), null, null, () => {});
		expect(long.ok).toBe(true);
		if (long.ok) {
			expect(h.room.players.get(long.playerId)!.name).toHaveLength(LIMITS.name);
		}
	});

	test('avatar and name color round-trip into snapshots and broadcasts', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.clear();
		const b = h.join('Bob', AVATAR, '#ff8800');

		const toA = h.typeTo(a, 'playerJoined');
		expect(toA[0]!.player.avatar).toBe(AVATAR);
		expect(toA[0]!.player.nameColor).toBe('#ff8800');

		const snapshot = h.typeTo(b, 'joined')[0]!.room;
		expect(snapshot.players.find((p) => p.id === b)!.avatar).toBe(AVATAR);
		expect(snapshot.players.find((p) => p.id === a)!.avatar).toBeNull();
	});

	test('malformed profile values degrade to null without failing the join', () => {
		const h = new Harness();
		const cases: [unknown, unknown][] = [
			['data:image/svg+xml;base64,PHN2Zz4=', 'red'], // wrong mime, non-hex color
			['data:image/png;base64,not b64!', '#12'], // invalid base64, bad hex length
			[`data:image/png;base64,${'A'.repeat(LIMITS.avatarLength)}`, 42], // oversized, non-string
			[7, {}]
		];
		for (const [i, [avatar, color]] of cases.entries()) {
			const res = h.room.join(`P${i}`, avatar, color, () => {});
			expect(res.ok).toBe(true);
		}
		for (const p of h.room.players.values()) {
			expect(p.avatar).toBeNull();
			expect(p.nameColor).toBeNull();
		}
	});

	test('rejoin within grace refreshes the stored profile', () => {
		const h = new Harness();
		h.join('Alice');
		const b = h.join('Bob', AVATAR, '#ff8800');
		h.room.disconnect(b);
		h.clear();

		const res = h.room.join('Bob', null, '#00ff00', () => {});
		expect(res.ok).toBe(true);
		const player = h.room.players.get(b)!;
		expect(player.avatar).toBeNull();
		expect(player.nameColor).toBe('#00ff00');
	});
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('updateSettings', () => {
	test('non-host is rejected and nothing changes', () => {
		const h = new Harness();
		h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		h.send(b, { type: 'updateSettings', settings: { rounds: 7 } });
		const errs = h.typeTo(b, 'error');
		expect(errs).toHaveLength(1);
		expect(errs[0]!.code).toBe('not_allowed');
		expect(h.room.settings.rounds).toBe(DEFAULT_SETTINGS.rounds);
	});

	test('numeric values are clamped to SETTINGS_BOUNDS', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.send(a, {
			type: 'updateSettings',
			settings: {
				rounds: 99,
				drawTimeSeconds: 1,
				wordChoiceCount: 42,
				hintCount: -5,
				maxPlayers: 99
			}
		});
		expect(h.room.settings.rounds).toBe(10);
		expect(h.room.settings.drawTimeSeconds).toBe(30);
		expect(h.room.settings.wordChoiceCount).toBe(5);
		expect(h.room.settings.hintCount).toBe(0);
		expect(h.room.settings.maxPlayers).toBe(12);
	});

	test('wordSource accepts the known values and ignores anything else', () => {
		const h = new Harness();
		const a = h.join('Alice');

		h.send(a, { type: 'updateSettings', settings: { wordSource: 'both' } });
		expect(h.room.settings.wordSource).toBe('both');

		// Settings are untrusted wire JSON — `Partial<Settings>` describes what a well-behaved
		// client sends, not what actually arrives, so an unknown value must be dropped rather
		// than stored.
		h.send(a, {
			type: 'updateSettings',
			settings: { wordSource: 'garbage' as Settings['wordSource'] }
		});
		expect(h.room.settings.wordSource).toBe('both');
	});

	test('customWords are trimmed, empties dropped, capped in length and count', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const many = Array.from({ length: 250 }, (_, i) => `word${i}`);
		h.send(a, {
			type: 'updateSettings',
			settings: { customWords: ['  Word  ', '', '   ', 'x'.repeat(64), ...many] }
		});
		const words = h.room.settings.customWords;
		expect(words[0]).toBe('Word');
		expect(words[1]).toBe('x'.repeat(LIMITS.customWordLength));
		expect(words).toHaveLength(LIMITS.customWordsTotal);
		expect(words).not.toContain('');
	});

	test('successful update broadcasts roomState to everyone', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		h.send(a, { type: 'updateSettings', settings: { rounds: 5 } });
		expect(h.typeTo(a, 'roomState')).toHaveLength(1);
		expect(h.typeTo(b, 'roomState')).toHaveLength(1);
		expect(h.typeTo(b, 'roomState')[0]!.room.settings.rounds).toBe(5);
	});

	test('locked once the game has started', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		h.clear();
		h.send(ids[0]!, { type: 'updateSettings', settings: { rounds: 9 } });
		const errs = h.typeTo(ids[0]!, 'error');
		expect(errs).toHaveLength(1);
		expect(errs[0]!.code).toBe('not_allowed');
		expect(h.room.settings.rounds).toBe(DEFAULT_SETTINGS.rounds);
	});
});

// ---------------------------------------------------------------------------
// Starting a game
// ---------------------------------------------------------------------------

describe('startGame', () => {
	test('non-host is rejected', () => {
		const h = new Harness();
		h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		h.send(b, { type: 'startGame' });
		expect(h.typeTo(b, 'error')[0]!.code).toBe('not_allowed');
		expect(h.room.phase).toBe('lobby');
	});

	test('rejected with fewer than 2 connected players', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.clear();
		h.send(a, { type: 'startGame' });
		expect(h.typeTo(a, 'error')[0]!.code).toBe('not_allowed');
		expect(h.room.phase).toBe('lobby');
	});

	test('resets scores, broadcasts turnStarted with the first joiner drawing', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		const c = h.join('Cara');
		h.room.players.get(a)!.score = 50;
		h.room.players.get(b)!.score = 70;
		h.send(a, { type: 'updateSettings', settings: { wordSource: 'custom', customWords: WORDS } });
		h.clear();
		h.send(a, { type: 'startGame' });

		expect(h.room.phase).toBe('choosing');
		for (const id of [a, b, c]) {
			expect(h.room.players.get(id)!.score).toBe(0);
		}

		for (const id of [a, b, c]) {
			const started = h.typeTo(id, 'turnStarted');
			expect(started).toHaveLength(1);
			expect(started[0]!.drawerId).toBe(a);
			expect(started[0]!.round).toBe(1);
			expect(started[0]!.turnIndex).toBe(0);
		}
	});

	test('drawer gets wordChoiceCount choices; non-drawers get none', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		const choices = h.typeTo(a, 'wordChoices');
		expect(choices).toHaveLength(1);
		expect(choices[0]!.choices).toHaveLength(DEFAULT_SETTINGS.wordChoiceCount);
		expect(h.typeTo(b, 'wordChoices')).toHaveLength(0);
		expect(h.typeTo(c, 'wordChoices')).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Choosing a word
// ---------------------------------------------------------------------------

describe('chooseWord', () => {
	test('non-drawer is rejected', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		h.clear();
		h.send(ids[1]!, { type: 'chooseWord', word: WORDS[0]! });
		expect(h.typeTo(ids[1]!, 'error')[0]!.code).toBe('not_allowed');
		expect(h.room.phase).toBe('choosing');
	});

	test('a word outside the offered choices is rejected', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		h.clear();
		h.send(ids[0]!, { type: 'chooseWord', word: 'zebra' });
		expect(h.typeTo(ids[0]!, 'error')[0]!.code).toBe('not_allowed');
		expect(h.room.phase).toBe('choosing');
	});

	test('valid choice starts drawing: masked broadcast, yourWord to drawer only', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const a = ids[0]!;
		const b = ids[1]!;
		const choices = choicesFor(h, a);
		h.clear();
		h.send(a, { type: 'chooseWord', word: choices[0]! });

		expect(h.room.phase).toBe('drawing');
		const startedA = h.typeTo(a, 'drawingStarted');
		const startedB = h.typeTo(b, 'drawingStarted');
		expect(startedA).toHaveLength(1);
		expect(startedB).toHaveLength(1);
		// 'apple' → all underscores, one per letter
		expect(startedB[0]!.masked).toBe('_'.repeat(choices[0]!.length));
		expect(startedB[0]!.masked).toMatch(/^[_ ]+$/u);
		expect(startedB[0]!.masked).not.toBe(choices[0]);

		expect(h.typeTo(a, 'yourWord')).toHaveLength(1);
		expect(h.typeTo(a, 'yourWord')[0]!.word).toBe(choices[0]!);
		expect(h.typeTo(b, 'yourWord')).toHaveLength(0);

		// Guessers never see the word in room snapshots either.
		for (const rs of h.typeTo(b, 'roomState')) {
			expect(rs.room.masked).toMatch(/^[_ ]+$/u);
		}
	});

	test('masked preserves spaces in multi-word answers', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { customWords: ['ice cream'] });
		const a = ids[0]!;
		const b = ids[1]!;
		chooseWord(h, a); // only choice: 'ice cream'
		expect(h.typeTo(b, 'drawingStarted')[0]!.masked).toBe('___ _____');
	});

	test('auto-pick after CHOOSE_MS starts drawing automatically', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const a = ids[0]!;
		const b = ids[1]!;
		const choices = choicesFor(h, a);
		h.clear();
		h.clock.advance(CHOOSE_MS);
		expect(h.room.phase).toBe('drawing');
		// random() = 0 → picks the first choice
		expect(h.typeTo(a, 'yourWord')[0]!.word).toBe(choices[0]!);
		expect(h.typeTo(b, 'drawingStarted')).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Guessing & chat scoping
// ---------------------------------------------------------------------------

function drawingTrio() {
	const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
	const a = ids[0]!;
	const b = ids[1]!;
	const c = ids[2]!;
	const word = chooseWord(h, a); // 'apple' with random()=0
	h.clear();
	return { h, a, b, c, word };
}

describe('guessing', () => {
	test('wrong guess is broadcast to everyone with scope all', () => {
		const { h, a, b, c } = drawingTrio();
		h.send(b, { type: 'guess', text: 'zebra' });
		for (const id of [a, b, c]) {
			const chats = h.chatsTo(id);
			expect(chats).toHaveLength(1);
			expect(chats[0]).toEqual({ id: b, name: 'Bob', text: 'zebra', scope: 'all' });
		}
		expect(h.ofType('guessResult')).toHaveLength(0);
	});

	test('correct guess: private guessResult, playerGuessed broadcast, system chat', () => {
		const { h, a, b, c, word } = drawingTrio();
		h.send(b, { type: 'guess', text: word });

		expect(h.typeTo(b, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
		expect(h.typeTo(a, 'guessResult')).toHaveLength(0);
		expect(h.typeTo(c, 'guessResult')).toHaveLength(0);

		for (const id of [a, b, c]) {
			const guessed = h.typeTo(id, 'playerGuessed');
			expect(guessed).toHaveLength(1);
			expect(guessed[0]!.id).toBe(b);
		}

		const system = h.chatsTo(c).filter((e) => e.scope === 'system');
		expect(system).toHaveLength(1);
		expect(system[0]!.text).toBe('Bob guessed the word!');
		// The turn keeps going: Cara has not guessed yet.
		expect(h.room.phase).toBe('drawing');
	});

	test('after guessing, later messages go only to drawer + guessed players', () => {
		const { h, a, b, c, word } = drawingTrio();
		h.send(b, { type: 'guess', text: word });
		h.clear();

		h.send(b, { type: 'chat', text: 'that was easy' });
		expect(h.chatsTo(a)).toEqual([{ id: b, name: 'Bob', text: 'that was easy', scope: 'guessed' }]);
		expect(h.chatsTo(b)).toHaveLength(1);
		expect(h.chatsTo(c)).toHaveLength(0);

		// Same via the guess message type.
		h.clear();
		h.send(b, { type: 'guess', text: 'still chatting' });
		expect(h.chatsTo(a)).toHaveLength(1);
		expect(h.chatsTo(a)[0]!.scope).toBe('guessed');
		expect(h.chatsTo(c)).toHaveLength(0);
	});

	test('the word never appears in chat delivered to non-guessed players', () => {
		const { h, a, b, c, word } = drawingTrio();
		h.send(b, { type: 'guess', text: word }); // correct
		h.send(b, { type: 'chat', text: `it was ${word}!` }); // guessed-scope
		h.send(c, { type: 'guess', text: `${word} pie maybe` }); // contains word
		h.send(a, { type: 'chat', text: `yes ${word}` }); // drawer → guessed-scope

		for (const entry of h.chatsTo(c)) {
			expect(entry.text.toLowerCase()).not.toContain(word);
		}
		// Sanity: guessed-side players did see follow-up chatter.
		expect(h.chatsTo(a).some((e) => e.text.includes(word))).toBe(true);
	});

	test('a wrong guess containing the word routes to the guessed scope', () => {
		const { h, a, b, c, word } = drawingTrio();
		h.send(c, { type: 'guess', text: `${word} pie` });

		const toDrawer = h.chatsTo(a);
		expect(toDrawer).toHaveLength(1);
		expect(toDrawer[0]).toEqual({ id: c, name: 'Cara', text: `${word} pie`, scope: 'guessed' });
		// Non-guessed players (including the sender) do not receive it.
		expect(h.chatsTo(b)).toHaveLength(0);
		expect(h.chatsTo(c)).toHaveLength(0);
		// And it did not count as correct.
		expect(h.typeTo(c, 'guessResult')).toHaveLength(0);
		expect(h.room.players.get(c)!.guessedThisTurn).toBe(false);
	});

	test('close guess (levenshtein 1): private close hint plus normal broadcast', () => {
		const { h, a, b, c, word } = drawingTrio();
		const close = word.replace('pp', 'p'); // 'aple' — distance 1, does not contain the word
		h.send(b, { type: 'guess', text: close });

		expect(h.typeTo(b, 'guessResult')).toEqual([
			{ type: 'guessResult', correct: false, close: true }
		]);
		expect(h.typeTo(a, 'guessResult')).toHaveLength(0);
		for (const id of [a, b, c]) {
			const chats = h.chatsTo(id);
			expect(chats).toHaveLength(1);
			expect(chats[0]!.scope).toBe('all');
			expect(chats[0]!.text).toBe(close);
		}
	});

	test('normalization: guess matches despite case and extra whitespace', () => {
		const { h, b, word } = drawingTrio();
		h.send(b, { type: 'guess', text: `  ${word.toUpperCase()}  ` });
		expect(h.typeTo(b, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
	});

	test('correct guess within YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS of the previous one is flagged youreGonnaHaveToBeFasterThanThat', () => {
		const { h, b, c, word } = drawingTrio();
		h.send(b, { type: 'guess', text: word });
		h.clock.advance(YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS);
		h.send(c, { type: 'guess', text: word });

		expect(h.typeTo(b, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
		expect(h.typeTo(c, 'guessResult')).toEqual([
			{ type: 'guessResult', correct: true, youreGonnaHaveToBeFasterThanThat: true }
		]);
	});

	test('correct guess later than YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS is not flagged', () => {
		const { h, b, c, word } = drawingTrio();
		h.send(b, { type: 'guess', text: word });
		h.clock.advance(YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS + 1);
		h.send(c, { type: 'guess', text: word });
		expect(h.typeTo(c, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
	});

	test('youreGonnaHaveToBeFasterThanThat window measures from the latest correct guess, not the first', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara', 'Dan']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		const d = ids[3]!;
		const word = chooseWord(h, a);
		h.clear();

		h.send(b, { type: 'guess', text: word });
		h.clock.advance(YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS + 500);
		h.send(c, { type: 'guess', text: word }); // outside b's window → not flagged
		h.clock.advance(YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS - 200);
		h.send(d, { type: 'guess', text: word }); // inside c's window → flagged

		expect(h.typeTo(c, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
		expect(h.typeTo(d, 'guessResult')).toEqual([
			{ type: 'guessResult', correct: true, youreGonnaHaveToBeFasterThanThat: true }
		]);
	});
});

// ---------------------------------------------------------------------------
// Chat moderation: repeat limit + potty-mouth filter
// ---------------------------------------------------------------------------

describe('repeat limit', () => {
	test('the same message is blocked after REPEAT_LIMIT sends; fresh material still flows', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		for (let i = 0; i < REPEAT_LIMIT; i++) {
			h.send(a, { type: 'chat', text: 'nice' });
		}
		expect(h.chatsTo(b)).toHaveLength(REPEAT_LIMIT);
		expect(h.typeTo(a, 'error')).toHaveLength(0);

		h.send(a, { type: 'chat', text: 'nice' });
		expect(h.chatsTo(b)).toHaveLength(REPEAT_LIMIT); // the 16th never lands
		const errs = h.typeTo(a, 'error');
		expect(errs).toHaveLength(1);
		expect(errs[0]!.code).toBe('rate_limited');

		h.send(a, { type: 'chat', text: 'fresh material' });
		expect(h.chatsTo(b)).toHaveLength(REPEAT_LIMIT + 1);
	});

	test('repeats are counted per normalized text and per player', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		for (let i = 0; i < REPEAT_LIMIT; i++) {
			h.send(a, { type: 'chat', text: i % 2 === 0 ? 'GG  everyone' : '  gg everyone ' });
		}
		h.send(a, { type: 'chat', text: 'gg everyone' });
		expect(h.typeTo(a, 'error')[0]!.code).toBe('rate_limited');

		// Alice exhausting her count leaves Bob's untouched.
		h.send(b, { type: 'chat', text: 'gg everyone' });
		expect(h.chatsTo(a).filter((e) => e.id === b)).toHaveLength(1);
		expect(h.typeTo(b, 'error')).toHaveLength(0);
	});

	test('a correct guess is never repeat-blocked, even after heavy lobby spam', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.send(a, {
			type: 'updateSettings',
			settings: { wordSource: 'custom', customWords: ['apple'], hintCount: 0 }
		});
		for (let i = 0; i < REPEAT_LIMIT; i++) {
			h.send(b, { type: 'chat', text: 'apple' });
		}
		h.send(a, { type: 'startGame' });
		chooseWord(h, a); // only choice: 'apple'
		h.clear();

		h.send(b, { type: 'guess', text: 'apple' });
		expect(h.typeTo(b, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
		expect(h.typeTo(b, 'error')).toHaveLength(0);
	});

	test('unique messages are never blocked by the tracking cap', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		// 520 distinct messages — past the 500-entry per-player tracking cap.
		for (let i = 0; i < 520; i++) {
			h.send(a, { type: 'chat', text: `msg ${i}` });
		}
		expect(h.typeTo(a, 'error')).toHaveLength(0);
		expect(h.chatsTo(b)).toHaveLength(520);
	});
});

describe('potty-mouth filter', () => {
	test('a profane lobby message is replaced with a phrase for everyone', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		h.send(b, { type: 'chat', text: 'this is bullshit' });
		for (const id of [a, b]) {
			const chats = h.chatsTo(id);
			expect(chats).toHaveLength(1);
			expect(chats[0]!.id).toBe(b);
			expect(chats[0]!.name).toBe('Bob');
			expect(chats[0]!.scope).toBe('all');
			expect(chats[0]!.filtered).toBe(true);
			expect(POTTY_PHRASES).toContain(chats[0]!.text);
			expect(chats[0]!.text).not.toContain('bullshit');
		}
	});

	test('the replacement phrase shuffles with the rng', () => {
		const h = new Harness();
		h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		h.randQueue.push(0.05, 0.95);
		h.send(b, { type: 'chat', text: 'well shit' });
		h.send(b, { type: 'chat', text: 'oh fuck' });
		const chats = h.chatsTo(b);
		expect(chats).toHaveLength(2);
		expect(chats[0]!.text).not.toBe(chats[1]!.text);
		expect(POTTY_PHRASES).toContain(chats[0]!.text);
		expect(POTTY_PHRASES).toContain(chats[1]!.text);
	});

	test('a profane wrong guess mid-drawing is replaced before broadcast', () => {
		const { h, a, b, c } = drawingTrio();
		h.send(c, { type: 'guess', text: 'fucking impossible' });
		for (const id of [a, b, c]) {
			const chats = h.chatsTo(id);
			expect(chats).toHaveLength(1);
			expect(chats[0]!.scope).toBe('all');
			expect(chats[0]!.filtered).toBe(true);
			expect(POTTY_PHRASES).toContain(chats[0]!.text);
			expect(chats[0]!.text).not.toContain('fucking');
		}
		expect(h.typeTo(c, 'guessResult')).toHaveLength(0);
		expect(h.room.players.get(c)!.guessedThisTurn).toBe(false);
	});

	test('drawer profanity funnels into the guessed channel, filtered', () => {
		const { h, a, b, c } = drawingTrio();
		h.send(a, { type: 'chat', text: 'fuck I cannot draw' });
		const toDrawer = h.chatsTo(a);
		expect(toDrawer).toHaveLength(1);
		expect(toDrawer[0]!.scope).toBe('guessed');
		expect(toDrawer[0]!.filtered).toBe(true);
		expect(POTTY_PHRASES).toContain(toDrawer[0]!.text);
		expect(h.chatsTo(b)).toHaveLength(0);
		expect(h.chatsTo(c)).toHaveLength(0);
	});

	test('a profane custom word is guessable and its guess is never filtered', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.send(a, {
			type: 'updateSettings',
			settings: { wordSource: 'custom', customWords: ['shit'], hintCount: 0 }
		});
		h.send(a, { type: 'startGame' });
		chooseWord(h, a); // only choice: 'shit'
		h.clear();

		h.send(b, { type: 'guess', text: 'shit' });
		expect(h.typeTo(b, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
		const system = h.chatsTo(a).filter((e) => e.scope === 'system');
		expect(system.some((e) => e.text === 'Bob guessed the word!')).toBe(true);
		expect(h.log.some((s) => s.msg.type === 'chat' && s.msg.entry.filtered === true)).toBe(false);
	});

	test('a wrong guess sharing the profane answer token passes unfiltered', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.send(a, {
			type: 'updateSettings',
			settings: { wordSource: 'custom', customWords: ['shit show'], hintCount: 0 }
		});
		h.send(a, { type: 'startGame' });
		chooseWord(h, a); // only choice: 'shit show'
		h.clear();

		h.send(b, { type: 'guess', text: 'shit' });
		let chats = h.chatsTo(a);
		expect(chats).toHaveLength(1);
		expect(chats[0]!.text).toBe('shit');
		expect(chats[0]!.scope).toBe('all');
		expect(chats[0]!.filtered).toBeUndefined();

		// A swear that is not part of the answer still trips the filter.
		h.clear();
		h.send(b, { type: 'guess', text: 'fucking hell' });
		chats = h.chatsTo(a);
		expect(chats[0]!.filtered).toBe(true);
		expect(POTTY_PHRASES).toContain(chats[0]!.text);
	});

	test('once revealed, the profane answer is fair game in chat', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.send(a, {
			type: 'updateSettings',
			settings: { wordSource: 'custom', customWords: ['shit'], hintCount: 0 }
		});
		h.send(a, { type: 'startGame' });
		chooseWord(h, a);
		h.send(b, { type: 'guess', text: 'shit' }); // correct → everyone guessed → reveal
		expect(h.room.phase).toBe('reveal');
		h.clear();

		h.send(b, { type: 'chat', text: 'shit happens' });
		expect(h.chatsTo(a)).toEqual([{ id: b, name: 'Bob', text: 'shit happens', scope: 'all' }]);

		h.send(b, { type: 'chat', text: 'fuck yes' });
		expect(h.chatsTo(a).at(-1)!.filtered).toBe(true);
	});

	test('a repeated profane message is counted by its original text and eventually blocked', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		h.clear();
		for (let i = 0; i < REPEAT_LIMIT; i++) {
			h.send(a, { type: 'chat', text: 'fuck' });
		}
		expect(h.chatsTo(b)).toHaveLength(REPEAT_LIMIT);
		expect(h.chatsTo(b).every((e) => e.filtered === true)).toBe(true);

		h.send(a, { type: 'chat', text: 'fuck' });
		expect(h.chatsTo(b)).toHaveLength(REPEAT_LIMIT);
		expect(h.typeTo(a, 'error')[0]!.code).toBe('rate_limited');
	});
});

// ---------------------------------------------------------------------------
// Scoring integration
// ---------------------------------------------------------------------------

describe('scoring integration', () => {
	test('time points + ordinal bonuses for guessers, average + sweep for drawer', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		const word = chooseWord(h, a);
		const drawStart = h.clock.now;

		h.clock.advance(20_000); // 60s remaining → 100 + 400*(0.75) = 400
		h.send(b, { type: 'guess', text: word });
		h.clock.advance(20_000); // 40s remaining → 300
		h.clear();
		h.send(c, { type: 'guess', text: word });

		// Everyone guessed → immediate reveal, well before drawMs elapsed.
		expect(h.room.phase).toBe('reveal');
		expect(h.clock.now - drawStart).toBeLessThan(DRAW_MS);

		const ended = h.typeTo(a, 'turnEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0]!.word).toBe(word);
		expect(ended[0]!.gains[b]).toBe(400 + 50); // first guesser
		expect(ended[0]!.gains[c]).toBe(300 + 30); // second guesser
		expect(ended[0]!.gains[a]).toBe(Math.round((400 + 300) / 2) + 200); // drawer avg + sweep
		expect(ended[0]!.totals).toEqual({ [a]: 550, [b]: 450, [c]: 330 });
		expect(ended[0]!.endsAt).toBe(h.clock.now + REVEAL_MS);

		// Totals accumulate across turns: Bob draws next, only Alice guesses.
		h.clock.advance(REVEAL_MS);
		expect(h.room.phase).toBe('choosing');
		const word2 = chooseWord(h, b);
		h.clock.advance(40_000); // midpoint → 300
		h.clear();
		h.send(a, { type: 'guess', text: word2 });
		h.clock.advance(40_000); // Cara never guesses → time out

		const ended2 = h.typeTo(c, 'turnEnded');
		expect(ended2).toHaveLength(1);
		expect(ended2[0]!.gains[a]).toBe(300 + 50);
		expect(ended2[0]!.gains[b]).toBe(300); // avg of [300], no sweep (1 of 2 eligible)
		expect(ended2[0]!.gains[c]).toBeUndefined();
		expect(ended2[0]!.totals).toEqual({ [a]: 900, [b]: 750, [c]: 330 });
	});

	test('turn ends by timeout with no guessers: empty gains', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		chooseWord(h, ids[0]!);
		h.clear();
		h.clock.advance(DRAW_MS);
		expect(h.room.phase).toBe('reveal');
		const ended = h.typeTo(ids[1]!, 'turnEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0]!.gains).toEqual({});
		expect(ended[0]!.totals).toEqual({ [ids[0]!]: 0, [ids[1]!]: 0 });
	});
});

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

describe('hints', () => {
	test('letters reveal on the even schedule', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { hintCount: 2 });
		const a = ids[0]!;
		const b = ids[1]!;
		const word = chooseWord(h, a); // 'apple'
		h.clear();

		const first = Math.round(DRAW_MS / 3); // 26_667
		const second = Math.round((DRAW_MS * 2) / 3); // 53_333

		h.clock.advance(first);
		let reveals = h.typeTo(b, 'letterRevealed');
		expect(reveals).toHaveLength(1);
		expect(reveals[0]!.masked).toBe('a____'); // random()=0 reveals index 0

		h.clock.advance(second - first);
		reveals = h.typeTo(b, 'letterRevealed');
		expect(reveals).toHaveLength(2);
		expect(reveals[1]!.masked).toBe('ap___');
		expect(reveals[1]!.masked).not.toBe(word);
		expect(h.room.phase).toBe('drawing');
	});

	test('word is never fully revealed even when hintCount exceeds its length', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { hintCount: 10, customWords: ['cat'] });
		const a = ids[0]!;
		const b = ids[1]!;
		const word = chooseWord(h, a); // 'cat'
		h.clear();
		h.clock.advance(DRAW_MS); // run the whole turn

		const reveals = h.typeTo(b, 'letterRevealed');
		expect(reveals).toHaveLength(2); // maxHints = letterCount - 1
		for (const r of reveals) {
			expect(r.masked).not.toBe(word);
		}
		const lastReveal = reveals.at(-1);
		if (lastReveal === undefined) {
			throw new Error('expected at least one letterRevealed message');
		}
		const final = lastReveal.masked;
		// Masked words are plain lowercase letters/underscores (see mask.ts) — no
		// multi-codepoint graphemes, so per-character spread iteration is exact here.
		// oxlint-disable-next-line typescript/no-misused-spread -- see comment above
		expect([...final].filter((ch) => ch === '_')).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Turn rotation, game end, play again
// ---------------------------------------------------------------------------

describe('rotation and game end', () => {
	test('next player draws after REVEAL_MS; game ends after all rounds', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;

		const w1 = chooseWord(h, a);
		h.send(b, { type: 'guess', text: w1 }); // instant: 500 + 50; drawer 500 + 200
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(REVEAL_MS);

		expect(h.room.phase).toBe('choosing');
		const started = h.typeTo(a, 'turnStarted');
		expect(started).toHaveLength(1);
		expect(started[0]!.drawerId).toBe(b);
		expect(started[0]!.round).toBe(1);
		expect(started[0]!.turnIndex).toBe(1);

		chooseWord(h, b);
		h.clock.advance(DRAW_MS); // nobody guesses
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(REVEAL_MS);

		expect(h.room.phase).toBe('finished');
		const ended = h.typeTo(b, 'gameEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0]!.winnerId).toBe(a); // 700 vs 550
		expect(ended[0]!.totals).toEqual({ [a]: 700, [b]: 550 });
		expect(h.room.winnerId).toBe(a);
	});

	test('playAgain: host only, resets to lobby', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;
		chooseWord(h, a);
		h.clock.advance(DRAW_MS + REVEAL_MS); // turn 1 over, turn 2 begins
		chooseWord(h, b);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		expect(h.room.phase).toBe('finished');

		h.clear();
		h.send(b, { type: 'playAgain' });
		expect(h.typeTo(b, 'error')[0]!.code).toBe('not_allowed');
		expect(h.room.phase).toBe('finished');

		h.clear();
		h.send(a, { type: 'playAgain' });
		expect(h.room.phase).toBe('lobby');
		expect(h.room.round).toBe(0);
		expect(h.room.turnIndex).toBe(0);
		expect(h.room.turnOrder).toEqual([]);
		const states = h.typeTo(b, 'roomState');
		expect(states).toHaveLength(1);
		expect(states[0]!.room.phase).toBe('lobby');
	});
});

// ---------------------------------------------------------------------------
// Disconnects
// ---------------------------------------------------------------------------

describe('disconnects', () => {
	test('drawer disconnect during drawing skips the turn without scoring', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		chooseWord(h, a);
		h.clock.advance(1000);
		h.clear();
		h.room.disconnect(a);

		expect(h.room.phase).toBe('reveal');
		const ended = h.typeTo(b, 'turnEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0]!.gains).toEqual({});
		expect(ended[0]!.totals).toEqual({ [a]: 0, [b]: 0, [c]: 0 });
		expect(ended[0]!.endsAt).toBe(h.clock.now + SKIP_REVEAL_MS);
		expect(h.chatsTo(c).some((e) => e.scope === 'system' && e.text.includes('turn skipped'))).toBe(
			true
		);

		// Host moved off the disconnected drawer.
		expect(h.room.hostId).toBe(b);
		expect(h.typeTo(c, 'hostChanged')[0]!.hostId).toBe(b);

		h.clear();
		h.clock.advance(SKIP_REVEAL_MS);
		expect(h.room.phase).toBe('choosing');
		expect(h.typeTo(c, 'turnStarted')[0]!.drawerId).toBe(b);
	});

	test('host disconnect transfers host to the next connected player', () => {
		const h = new Harness();
		const a = h.join('Alice');
		const b = h.join('Bob');
		const c = h.join('Cara');
		h.clear();
		h.room.disconnect(a);

		expect(h.room.hostId).toBe(b);
		for (const id of [b, c]) {
			expect(h.typeTo(id, 'hostChanged')).toEqual([{ type: 'hostChanged', hostId: b }]);
			const conn = h.typeTo(id, 'playerConnection');
			expect(conn).toEqual([{ type: 'playerConnection', id: a, connected: false }]);
		}
	});

	test('rejoin within grace keeps the same id, score, and slot', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		const word = chooseWord(h, a);
		h.send(b, { type: 'guess', text: word }); // 500 + 50
		h.send(c, { type: 'guess', text: word }); // 500 + 30 → turn ends, scores applied
		expect(h.room.players.get(b)!.score).toBe(550);

		h.room.disconnect(b);
		h.clock.advance(1000);
		h.clear();

		const res = h.room.join('Bob', null, null, () => {});
		expect(res.ok).toBe(true);
		if (!res.ok) {
			return;
		}
		expect(res.playerId).toBe(b); // same slot
		const player = h.room.players.get(b)!;
		expect(player.connected).toBe(true);
		expect(player.score).toBe(550);

		const joined = h.typeTo(b, 'joined');
		expect(joined).toHaveLength(1);
		expect(joined[0]!.room.players.find((p) => p.id === b)!.score).toBe(550);
		for (const id of [a, c]) {
			expect(h.typeTo(id, 'playerConnection')).toEqual([
				{ type: 'playerConnection', id: b, connected: true }
			]);
		}
		expect(h.room.turnOrder.filter((id) => id === b)).toHaveLength(1);
	});

	test('after GRACE_MS without rejoin the player is removed', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		chooseWord(h, a);
		h.room.disconnect(b);
		h.clear();
		h.clock.advance(GRACE_MS); // still inside the 80s drawing window

		expect(h.room.players.has(b)).toBe(false);
		expect(h.room.turnOrder).not.toContain(b);
		for (const id of [a, c]) {
			expect(h.typeTo(id, 'playerLeft')).toEqual([{ type: 'playerLeft', id: b }]);
		}
		expect(h.room.phase).toBe('drawing'); // game continues with 2 connected
	});

	test('removal before the current drawer keeps the turn pointer aimed correctly', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		const w1 = chooseWord(h, a);
		h.send(b, { type: 'guess', text: w1 });
		h.send(c, { type: 'guess', text: w1 });
		h.clock.advance(REVEAL_MS); // Bob's turn (turnIndex 1)
		expect(h.typeTo(c, 'turnStarted').pop()!.drawerId).toBe(b);

		h.room.disconnect(a); // Alice (index 0, before current drawer) leaves
		chooseWord(h, b);
		h.clock.advance(GRACE_MS); // Alice removed mid-drawing
		expect(h.room.players.has(a)).toBe(false);
		expect(h.room.turnOrder).toEqual([b, c]);

		h.clock.advance(DRAW_MS - GRACE_MS); // Bob's turn times out
		h.clear();
		h.clock.advance(REVEAL_MS);
		// Cara draws next — the pointer did not skip her or repeat Bob.
		expect(h.room.phase).toBe('choosing');
		expect(h.typeTo(c, 'turnStarted')[0]!.drawerId).toBe(c);
	});

	test('mid-game disconnects leaving <2 connected abort to the lobby', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		chooseWord(h, a);
		h.room.disconnect(b);
		expect(h.room.phase).toBe('drawing'); // Cara can still guess
		h.room.disconnect(c);
		// No connected non-drawers remain → the turn resolves immediately…
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(REVEAL_MS);
		// …and the next turn cannot start with one connected player.
		expect(h.room.phase).toBe('lobby');
		expect(
			h.chatsTo(a).some((e) => e.scope === 'system' && e.text.includes('Not enough players'))
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Canvas ops
// ---------------------------------------------------------------------------

function drawingPair() {
	const { h, ids } = startedGame(['Alice', 'Bob']);
	const a = ids[0]!;
	const b = ids[1]!;
	chooseWord(h, a);
	h.clear();
	return { h, a, b };
}

describe('draw ops', () => {
	test('only the drawer may draw, and only during drawing', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const a = ids[0]!;
		const b = ids[1]!;
		const op = {
			kind: 'stroke' as const,
			id: 's1',
			points: [[0.1, 0.1]] as [number, number][],
			color: '#000000',
			size: 4
		};
		h.send(a, { type: 'draw', op }); // choosing phase → ignored
		expect(h.room.ops).toHaveLength(0);

		chooseWord(h, a);
		h.clear();
		h.send(b, { type: 'draw', op }); // non-drawer → ignored
		expect(h.room.ops).toHaveLength(0);
		expect(h.ofType('draw')).toHaveLength(0);
	});

	test('stroke batches with the same op id merge server-side and relay to others', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: {
				kind: 'stroke',
				id: 's1',
				points: [
					[0.1, 0.1],
					[0.2, 0.2]
				],
				color: '#ff0000',
				size: 4
			}
		});
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.3, 0.3]], color: '#ff0000', size: 4 }
		});

		expect(h.room.ops).toHaveLength(1);
		const merged = h.room.ops[0]!;
		if (merged.kind !== 'stroke') {
			throw new Error('expected stroke');
		}
		expect(merged.points).toEqual([
			[0.1, 0.1],
			[0.2, 0.2],
			[0.3, 0.3]
		]);

		const relayed = h.typeTo(b, 'draw');
		expect(relayed).toHaveLength(2);
		expect(relayed[0]!.op.kind === 'stroke' && relayed[0]!.op.points).toHaveLength(2);
		expect(relayed[1]!.op.kind === 'stroke' && relayed[1]!.op.points).toHaveLength(1);
		expect(h.typeTo(a, 'draw')).toHaveLength(0); // not echoed to the drawer
	});

	test('a new op id appends instead of merging', () => {
		const { h, a } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'draw', op: { kind: 'fill', id: 'f1', x: 0.5, y: 0.5, color: '#00ff00' } });
		expect(h.room.ops).toHaveLength(2);
		expect(h.room.ops[1]!.kind).toBe('fill');
	});

	test('invalid ops are rejected: bad color, empty points, malformed points', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: 'red', size: 4 }
		});
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's2', points: [], color: '#000000', size: 4 }
		});
		h.send(a, {
			type: 'draw',
			op: {
				kind: 'stroke',
				id: 's3',
				points: [[Number.NaN, 0.5]] as [number, number][],
				color: '#000000',
				size: 4
			}
		});
		expect(h.room.ops).toHaveLength(0);
		expect(h.typeTo(b, 'draw')).toHaveLength(0);
	});

	test('out-of-range values are clamped: points to [0,1], size to [1,64]', () => {
		const { h, a } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[5, -3]], color: '#123abc', size: 999 }
		});
		const op = h.room.ops[0]!;
		if (op.kind !== 'stroke') {
			throw new Error('expected stroke');
		}
		expect(op.points[0]).toEqual([1, 0]);
		expect(op.size).toBe(64);
	});

	test('clearCanvas empties ops and broadcasts; non-drawer cannot clear', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(b, { type: 'clearCanvas' });
		expect(h.room.ops).toHaveLength(1);

		h.clear();
		h.send(a, { type: 'clearCanvas' });
		expect(h.room.ops).toHaveLength(0);
		expect(h.typeTo(a, 'clearCanvas')).toHaveLength(1);
		expect(h.typeTo(b, 'clearCanvas')).toHaveLength(1);
	});

	test('undo pops the last op and broadcasts the remaining canvas state', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'draw', op: { kind: 'fill', id: 'f1', x: 0.5, y: 0.5, color: '#00ff00' } });
		h.clear();
		h.send(a, { type: 'undo' });

		expect(h.room.ops).toHaveLength(1);
		expect(h.room.ops[0]!.kind).toBe('stroke');
		for (const id of [a, b]) {
			const state = h.typeTo(id, 'canvasState');
			expect(state).toHaveLength(1);
			expect(state[0]!.ops).toHaveLength(1);
		}
	});

	test('redo restores the last undone op', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'draw', op: { kind: 'fill', id: 'f1', x: 0.5, y: 0.5, color: '#00ff00' } });
		h.send(a, { type: 'undo' });
		h.clear();
		h.send(a, { type: 'redo' });

		expect(h.room.ops).toHaveLength(2);
		expect(h.room.ops[1]!.kind).toBe('fill');
		for (const id of [a, b]) {
			const state = h.typeTo(id, 'canvasState');
			expect(state).toHaveLength(1);
			expect(state[0]!.ops).toHaveLength(2);
		}
	});

	test('redo on empty redo stack is a no-op', () => {
		const { h, a } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.clear();
		h.send(a, { type: 'redo' });

		expect(h.room.ops).toHaveLength(1);
		expect(h.typeTo(a, 'canvasState')).toHaveLength(0);
	});

	test('new draw op clears the redo stack', () => {
		const { h, a } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'undo' });
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's2', points: [[0.2, 0.2]], color: '#ff0000', size: 4 }
		});
		h.clear();
		h.send(a, { type: 'redo' });

		expect(h.room.ops).toHaveLength(1);
		expect(h.room.ops[0]!.id).toBe('s2');
		expect(h.typeTo(a, 'canvasState')).toHaveLength(0);
	});

	test('clearCanvas clears the redo stack', () => {
		const { h, a } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'undo' });
		h.send(a, { type: 'clearCanvas' });
		h.clear();
		h.send(a, { type: 'redo' });

		expect(h.room.ops).toHaveLength(0);
		expect(h.typeTo(a, 'canvasState')).toHaveLength(0);
	});

	test('redo stack is capped at REDO_LIMIT and evicts the oldest undone ops first', () => {
		const { h, a } = drawingPair();
		for (let i = 0; i < 5; i++) {
			h.send(a, {
				type: 'draw',
				op: { kind: 'stroke', id: `s${i}`, points: [[0.1, 0.1]], color: '#000000', size: 4 }
			});
		}
		for (let i = 0; i < 5; i++) {
			h.send(a, { type: 'undo' });
		}
		h.clear();

		// One redo beyond the cap should be a no-op.
		for (let i = 0; i < REDO_LIMIT + 1; i++) {
			h.send(a, { type: 'redo' });
		}

		// s3 and s4 were undone first (longest ago) and fall off the cap; s0-s2
		// (undone most recently) come back, restored in their original draw order.
		expect(h.room.ops.map((op) => op.id)).toEqual(['s0', 's1', 's2']);
	});

	test('undo after redo re-populates the redo stack correctly', () => {
		const { h, a } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's2', points: [[0.2, 0.2]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'undo' }); // ops=[s1], redoStack=[s2]
		h.send(a, { type: 'redo' }); // ops=[s1,s2], redoStack=[]
		h.send(a, { type: 'undo' }); // ops=[s1], redoStack=[s2]
		h.clear();
		h.send(a, { type: 'redo' });

		expect(h.room.ops.map((op) => op.id)).toEqual(['s1', 's2']);
		expect(h.typeTo(a, 'canvasState')).toHaveLength(1);
	});

	test('redo stack does not carry over to the next drawer’s turn', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'undo' }); // Alice's redo stack now holds s1
		h.clock.advance(DRAW_MS); // Alice's turn times out
		h.clock.advance(REVEAL_MS); // Bob's turn begins
		chooseWord(h, b);
		h.clear();

		h.send(b, { type: 'redo' });

		expect(h.room.ops).toHaveLength(0);
		expect(h.typeTo(b, 'canvasState')).toHaveLength(0);
	});

	test('non-drawer cannot redo', () => {
		const { h, a, b } = drawingPair();
		h.send(a, {
			type: 'draw',
			op: { kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }
		});
		h.send(a, { type: 'undo' });
		h.clear();
		h.send(b, { type: 'redo' });

		expect(h.room.ops).toHaveLength(0);
		expect(h.typeTo(a, 'canvasState')).toHaveLength(0);
		expect(h.typeTo(b, 'canvasState')).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Time sync
// ---------------------------------------------------------------------------

describe('timeSync', () => {
	test('broadcast every SYNC_MS during drawing with the turn deadline', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const a = ids[0]!;
		const b = ids[1]!;
		chooseWord(h, a);
		const endsAt = h.clock.now + DRAW_MS;
		h.clear();

		h.clock.advance(SYNC_MS);
		for (const id of [a, b]) {
			expect(h.typeTo(id, 'timeSync')).toEqual([{ type: 'timeSync', endsAt }]);
		}
		h.clock.advance(SYNC_MS);
		expect(h.typeTo(b, 'timeSync')).toHaveLength(2);
	});

	test('stops once the turn ends', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		chooseWord(h, ids[0]!);
		h.clock.advance(DRAW_MS);
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(SYNC_MS);
		expect(h.ofType('timeSync')).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Votes & gallery
// ---------------------------------------------------------------------------

const STROKE = {
	kind: 'stroke' as const,
	id: 's1',
	points: [[0.1, 0.1]] as [number, number][],
	color: '#000000',
	size: 4
};

/** One fully drawn turn (Alice drew 'apple') advanced into its reveal window. */
function revealedDrawing() {
	const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
	const a = ids[0]!;
	const b = ids[1]!;
	const c = ids[2]!;
	const word = chooseWord(h, a);
	h.send(a, { type: 'draw', op: STROKE });
	h.clock.advance(DRAW_MS);
	h.clear();
	return { h, a, b, c, word };
}

describe('votes & gallery', () => {
	test('a vote during reveal broadcasts the running tally to everyone', () => {
		const { h, a, b, c } = revealedDrawing();
		h.send(b, { type: 'vote', vote: 'like' });
		for (const id of [a, b, c]) {
			expect(h.typeTo(id, 'voteUpdate')).toEqual([{ type: 'voteUpdate', likes: 1, dislikes: 0 }]);
		}
		h.send(c, { type: 'vote', vote: 'dislike' });
		expect(h.typeTo(a, 'voteUpdate').at(-1)).toEqual({ type: 'voteUpdate', likes: 1, dislikes: 1 });
	});

	test('the drawer cannot vote on their own drawing', () => {
		const { h, a } = revealedDrawing();
		h.send(a, { type: 'vote', vote: 'like' });
		expect(h.typeTo(a, 'error')[0]!.code).toBe('not_allowed');
		expect(h.ofType('voteUpdate')).toHaveLength(0);
	});

	test('re-voting overwrites instead of double counting', () => {
		const { h, a, b } = revealedDrawing();
		h.send(b, { type: 'vote', vote: 'like' });
		h.send(b, { type: 'vote', vote: 'dislike' });
		expect(h.typeTo(a, 'voteUpdate').at(-1)).toEqual({ type: 'voteUpdate', likes: 0, dislikes: 1 });
		h.send(b, { type: 'vote', vote: 'dislike' }); // idempotent resend
		expect(h.typeTo(a, 'voteUpdate').at(-1)).toEqual({ type: 'voteUpdate', likes: 0, dislikes: 1 });
		expect(h.typeTo(a, 'voteUpdate')).toHaveLength(3);
	});

	test('a malformed vote value is rejected as bad_message', () => {
		const { h, b } = revealedDrawing();
		// A malformed wire value can't be expressed in ClientMessage's static types.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
		h.send(b, { type: 'vote', vote: 'meh' as unknown as VoteKind });
		expect(h.typeTo(b, 'error')[0]!.code).toBe('bad_message');
		expect(h.ofType('voteUpdate')).toHaveLength(0);
	});

	test('votes outside a reveal are rejected', () => {
		const lobby = new Harness();
		const x = lobby.join('Alice');
		lobby.send(x, { type: 'vote', vote: 'like' });
		expect(lobby.typeTo(x, 'error')[0]!.code).toBe('not_allowed');

		const { h, ids } = startedGame(['Alice', 'Bob']);
		const a = ids[0]!;
		const b = ids[1]!;
		h.send(b, { type: 'vote', vote: 'like' }); // choosing
		expect(h.typeTo(b, 'error').at(-1)?.code).toBe('not_allowed');

		chooseWord(h, a);
		h.clear();
		h.send(b, { type: 'vote', vote: 'like' }); // drawing
		expect(h.typeTo(b, 'error').at(-1)?.code).toBe('not_allowed');
		expect(h.ofType('voteUpdate')).toHaveLength(0);
	});

	test('a vote after the reveal window closes is rejected', () => {
		const { h, b } = revealedDrawing();
		h.clock.advance(REVEAL_MS); // next turn's choosing phase
		h.clear();
		h.send(b, { type: 'vote', vote: 'like' });
		expect(h.typeTo(b, 'error')[0]!.code).toBe('not_allowed');
		expect(h.ofType('voteUpdate')).toHaveLength(0);
	});

	test('a turn with nothing drawn is not votable and never enters the gallery', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;
		chooseWord(h, a);
		h.clock.advance(DRAW_MS); // blank canvas
		h.clear();
		h.send(b, { type: 'vote', vote: 'like' });
		expect(h.typeTo(b, 'error')[0]!.code).toBe('not_allowed');

		h.clock.advance(REVEAL_MS);
		chooseWord(h, b);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		expect(h.room.phase).toBe('finished');
		expect(h.typeTo(a, 'roomState').at(-1)!.room.gallery).toEqual({ best: null, worst: null });
	});

	test('a drawing whose drawer left is still votable during the short reveal', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const a = ids[0]!;
		const b = ids[1]!;
		chooseWord(h, a);
		h.send(a, { type: 'draw', op: STROKE });
		h.clear();
		h.room.disconnect(a);
		expect(h.room.phase).toBe('reveal');
		h.send(b, { type: 'vote', vote: 'like' });
		expect(h.typeTo(b, 'voteUpdate')).toEqual([{ type: 'voteUpdate', likes: 1, dislikes: 0 }]);
	});

	test('a player who joins during the reveal can vote', () => {
		const { h, b } = revealedDrawing();
		const d = h.join('Dave');
		h.send(d, { type: 'vote', vote: 'dislike' });
		expect(h.typeTo(b, 'voteUpdate').at(-1)).toEqual({ type: 'voteUpdate', likes: 0, dislikes: 1 });
	});

	test('game end publishes the most liked and most disliked drawings', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;

		const w1 = chooseWord(h, a); // 'apple'
		h.send(a, { type: 'draw', op: STROKE });
		h.clock.advance(DRAW_MS);
		h.send(b, { type: 'vote', vote: 'like' });
		h.send(c, { type: 'vote', vote: 'like' });
		h.clock.advance(REVEAL_MS);

		const w2 = chooseWord(h, b); // 'banana'
		h.send(b, { type: 'draw', op: { ...STROKE, id: 's2' } });
		h.clock.advance(DRAW_MS);
		h.send(a, { type: 'vote', vote: 'dislike' });
		h.send(c, { type: 'vote', vote: 'dislike' });
		h.clock.advance(REVEAL_MS);

		chooseWord(h, c); // 'cherry' — split votes, beaten on both boards
		h.send(c, { type: 'draw', op: { ...STROKE, id: 's3' } });
		h.clock.advance(DRAW_MS);
		h.send(a, { type: 'vote', vote: 'like' });
		h.send(b, { type: 'vote', vote: 'dislike' });
		h.clock.advance(REVEAL_MS);
		expect(h.room.phase).toBe('finished');

		const states = h.typeTo(a, 'roomState');
		// Projection safety: the gallery only ever appears in the finished phase.
		for (const s of states) {
			if (s.room.phase !== 'finished') {
				expect(s.room.gallery).toBeNull();
			}
		}
		const final = states.at(-1)!;
		expect(final.room.phase).toBe('finished');
		expect(final.room.gallery?.best).toEqual({
			drawerId: a,
			drawerName: 'Alice',
			word: w1,
			ops: [{ kind: 'stroke', id: 's1', points: [[0.1, 0.1]], color: '#000000', size: 4 }],
			likes: 2,
			dislikes: 0
		});
		expect(final.room.gallery?.worst?.word).toBe(w2);
		expect(final.room.gallery?.worst?.drawerName).toBe('Bob');
		expect(final.room.gallery?.worst?.dislikes).toBe(2);

		// The last reveal window is gone once the game is over — no more votes.
		h.clear();
		h.send(c, { type: 'vote', vote: 'like' });
		expect(h.typeTo(c, 'error')[0]!.code).toBe('not_allowed');
	});

	test('a counted vote survives the voter leaving before game end', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;
		const c = ids[2]!;
		const word = chooseWord(h, a); // 'apple'
		h.send(a, { type: 'draw', op: STROKE });
		h.clock.advance(DRAW_MS);
		h.send(b, { type: 'vote', vote: 'like' });
		h.room.disconnect(b); // leaves during the reveal, removed once grace expires
		h.clock.advance(REVEAL_MS);

		chooseWord(h, c); // Bob is skipped as drawer — Cara draws next
		h.clock.advance(DRAW_MS + REVEAL_MS); // Bob's grace expires mid-turn
		expect(h.room.phase).toBe('finished');
		expect(h.room.players.has(b)).toBe(false);

		const final = h.typeTo(a, 'roomState').at(-1)!;
		expect(final.room.gallery?.best?.word).toBe(word);
		expect(final.room.gallery?.best?.likes).toBe(1);
	});

	test('a reconnect on the game-over screen still receives the gallery', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;
		const word = chooseWord(h, a); // 'apple'
		h.send(a, { type: 'draw', op: STROKE });
		h.clock.advance(DRAW_MS);
		h.send(b, { type: 'vote', vote: 'like' });
		h.clock.advance(REVEAL_MS);
		chooseWord(h, b);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		expect(h.room.phase).toBe('finished');

		h.room.disconnect(b);
		h.clear();
		const res = h.room.join('Bob', null, null, () => {});
		expect(res.ok).toBe(true);
		const joined = h.typeTo(b, 'joined');
		expect(joined).toHaveLength(1);
		expect(joined[0]!.room.gallery?.best?.word).toBe(word);
	});

	test("playAgain discards the previous game's drawings and votes", () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { rounds: 1 });
		const a = ids[0]!;
		const b = ids[1]!;
		chooseWord(h, a);
		h.send(a, { type: 'draw', op: STROKE });
		h.clock.advance(DRAW_MS);
		h.send(b, { type: 'vote', vote: 'like' });
		h.clock.advance(REVEAL_MS);
		chooseWord(h, b);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		expect(h.room.phase).toBe('finished');

		h.clear();
		h.send(a, { type: 'playAgain' });
		expect(h.typeTo(b, 'roomState')[0]!.room.gallery).toBeNull();

		// A rematch with no drawings ends with an empty gallery — nothing carried over.
		h.send(a, { type: 'startGame' });
		chooseWord(h, a);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		chooseWord(h, b);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		expect(h.room.phase).toBe('finished');
		expect(h.typeTo(a, 'roomState').at(-1)!.room.gallery).toEqual({ best: null, worst: null });
	});
});
