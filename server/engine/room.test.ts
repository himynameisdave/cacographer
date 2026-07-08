import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, LIMITS, type PlayerId } from '../../src/lib/protocol';
import { CHOOSE_MS, GRACE_MS, REVEAL_MS, SKIP_REVEAL_MS, SYNC_MS } from './Room';
import { Harness, WORDS, chooseWord, choicesFor, startedGame } from './testUtils';

const DRAW_MS = DEFAULT_SETTINGS.drawTimeSeconds * 1000; // 80_000

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

describe('join', () => {
	test('first player becomes host and receives a joined snapshot', () => {
		const h = new Harness();
		let registered: PlayerId | null = null;
		const res = h.room.join('Alice', (id) => {
			registered = id;
		});
		if (!res.ok) {
			throw new Error('join failed');
		}
		expect(registered).toBe(res.playerId);
		expect(h.room.hostId).toBe(res.playerId);

		const joined = h.typeTo(res.playerId, 'joined');
		expect(joined).toHaveLength(1);
		expect(joined[0].you).toBe(res.playerId);
		expect(joined[0].room.players).toHaveLength(1);
		expect(joined[0].room.players[0].isHost).toBe(true);
		expect(joined[0].room.phase).toBe('lobby');
	});

	test('playerJoined is broadcast to others, joiner gets the snapshot instead', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.clear();
		const b = h.join('Bob');

		const toA = h.typeTo(a, 'playerJoined');
		expect(toA).toHaveLength(1);
		expect(toA[0].player.name).toBe('Bob');
		expect(toA[0].player.isHost).toBe(false);

		expect(h.typeTo(b, 'playerJoined')).toHaveLength(0);
		const joined = h.typeTo(b, 'joined');
		expect(joined).toHaveLength(1);
		expect(joined[0].room.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
	});

	test('duplicate connected name is rejected (case/whitespace-insensitive)', () => {
		const h = new Harness();
		h.join('Alice');
		const res = h.room.join('  ALICE ', () => {});
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
		const res = h.room.join('Cara', () => {});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.code).toBe('room_full');
		}
	});

	test('empty name rejected, long name capped', () => {
		const h = new Harness();
		const res = h.room.join('   ', () => {});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.code).toBe('bad_message');
		}

		const long = h.room.join('x'.repeat(60), () => {});
		expect(long.ok).toBe(true);
		if (long.ok) {
			expect(h.room.players.get(long.playerId)!.name).toHaveLength(LIMITS.name);
		}
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
		expect(errs[0].code).toBe('not_allowed');
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
		expect(h.typeTo(b, 'roomState')[0].room.settings.rounds).toBe(5);
	});

	test('locked once the game has started', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		h.clear();
		h.send(ids[0], { type: 'updateSettings', settings: { rounds: 9 } });
		const errs = h.typeTo(ids[0], 'error');
		expect(errs).toHaveLength(1);
		expect(errs[0].code).toBe('not_allowed');
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
		expect(h.typeTo(b, 'error')[0].code).toBe('not_allowed');
		expect(h.room.phase).toBe('lobby');
	});

	test('rejected with fewer than 2 connected players', () => {
		const h = new Harness();
		const a = h.join('Alice');
		h.clear();
		h.send(a, { type: 'startGame' });
		expect(h.typeTo(a, 'error')[0].code).toBe('not_allowed');
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
			expect(started[0].drawerId).toBe(a);
			expect(started[0].round).toBe(1);
			expect(started[0].turnIndex).toBe(0);
		}
	});

	test('drawer gets wordChoiceCount choices; non-drawers get none', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const [a, b, c] = ids;
		const choices = h.typeTo(a, 'wordChoices');
		expect(choices).toHaveLength(1);
		expect(choices[0].choices).toHaveLength(DEFAULT_SETTINGS.wordChoiceCount);
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
		h.send(ids[1], { type: 'chooseWord', word: WORDS[0] });
		expect(h.typeTo(ids[1], 'error')[0].code).toBe('not_allowed');
		expect(h.room.phase).toBe('choosing');
	});

	test('a word outside the offered choices is rejected', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		h.clear();
		h.send(ids[0], { type: 'chooseWord', word: 'zebra' });
		expect(h.typeTo(ids[0], 'error')[0].code).toBe('not_allowed');
		expect(h.room.phase).toBe('choosing');
	});

	test('valid choice starts drawing: masked broadcast, yourWord to drawer only', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const [a, b] = ids;
		const choices = choicesFor(h, a);
		h.clear();
		h.send(a, { type: 'chooseWord', word: choices[0] });

		expect(h.room.phase).toBe('drawing');
		const startedA = h.typeTo(a, 'drawingStarted');
		const startedB = h.typeTo(b, 'drawingStarted');
		expect(startedA).toHaveLength(1);
		expect(startedB).toHaveLength(1);
		// 'apple' → all underscores, one per letter
		expect(startedB[0].masked).toBe('_'.repeat(choices[0].length));
		expect(startedB[0].masked).toMatch(/^[_ ]+$/u);
		expect(startedB[0].masked).not.toBe(choices[0]);

		expect(h.typeTo(a, 'yourWord')).toHaveLength(1);
		expect(h.typeTo(a, 'yourWord')[0].word).toBe(choices[0]);
		expect(h.typeTo(b, 'yourWord')).toHaveLength(0);

		// Guessers never see the word in room snapshots either.
		for (const rs of h.typeTo(b, 'roomState')) {
			expect(rs.room.masked).toMatch(/^[_ ]+$/u);
		}
	});

	test('masked preserves spaces in multi-word answers', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { customWords: ['ice cream'] });
		const [a, b] = ids;
		chooseWord(h, a); // only choice: 'ice cream'
		expect(h.typeTo(b, 'drawingStarted')[0].masked).toBe('___ _____');
	});

	test('auto-pick after CHOOSE_MS starts drawing automatically', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const [a, b] = ids;
		const choices = choicesFor(h, a);
		h.clear();
		h.clock.advance(CHOOSE_MS);
		expect(h.room.phase).toBe('drawing');
		// random() = 0 → picks the first choice
		expect(h.typeTo(a, 'yourWord')[0].word).toBe(choices[0]);
		expect(h.typeTo(b, 'drawingStarted')).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Guessing & chat scoping
// ---------------------------------------------------------------------------

function drawingTrio() {
	const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
	const [a, b, c] = ids;
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
			expect(guessed[0].id).toBe(b);
		}

		const system = h.chatsTo(c).filter((e) => e.scope === 'system');
		expect(system).toHaveLength(1);
		expect(system[0].text).toBe('Bob guessed the word!');
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
		expect(h.chatsTo(a)[0].scope).toBe('guessed');
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
			expect(chats[0].scope).toBe('all');
			expect(chats[0].text).toBe(close);
		}
	});

	test('normalization: guess matches despite case and extra whitespace', () => {
		const { h, b, word } = drawingTrio();
		h.send(b, { type: 'guess', text: `  ${word.toUpperCase()}  ` });
		expect(h.typeTo(b, 'guessResult')).toEqual([{ type: 'guessResult', correct: true }]);
	});
});

// ---------------------------------------------------------------------------
// Scoring integration
// ---------------------------------------------------------------------------

describe('scoring integration', () => {
	test('time points + ordinal bonuses for guessers, average + sweep for drawer', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const [a, b, c] = ids;
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
		expect(ended[0].word).toBe(word);
		expect(ended[0].gains[b]).toBe(400 + 50); // first guesser
		expect(ended[0].gains[c]).toBe(300 + 30); // second guesser
		expect(ended[0].gains[a]).toBe(Math.round((400 + 300) / 2) + 200); // drawer avg + sweep
		expect(ended[0].totals).toEqual({ [a]: 550, [b]: 450, [c]: 330 });
		expect(ended[0].endsAt).toBe(h.clock.now + REVEAL_MS);

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
		expect(ended2[0].gains[a]).toBe(300 + 50);
		expect(ended2[0].gains[b]).toBe(300); // avg of [300], no sweep (1 of 2 eligible)
		expect(ended2[0].gains[c]).toBeUndefined();
		expect(ended2[0].totals).toEqual({ [a]: 900, [b]: 750, [c]: 330 });
	});

	test('turn ends by timeout with no guessers: empty gains', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		chooseWord(h, ids[0]);
		h.clear();
		h.clock.advance(DRAW_MS);
		expect(h.room.phase).toBe('reveal');
		const ended = h.typeTo(ids[1], 'turnEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0].gains).toEqual({});
		expect(ended[0].totals).toEqual({ [ids[0]]: 0, [ids[1]]: 0 });
	});
});

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

describe('hints', () => {
	test('letters reveal on the even schedule', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { hintCount: 2 });
		const [a, b] = ids;
		const word = chooseWord(h, a); // 'apple'
		h.clear();

		const first = Math.round(DRAW_MS / 3); // 26_667
		const second = Math.round((DRAW_MS * 2) / 3); // 53_333

		h.clock.advance(first);
		let reveals = h.typeTo(b, 'letterRevealed');
		expect(reveals).toHaveLength(1);
		expect(reveals[0].masked).toBe('a____'); // random()=0 reveals index 0

		h.clock.advance(second - first);
		reveals = h.typeTo(b, 'letterRevealed');
		expect(reveals).toHaveLength(2);
		expect(reveals[1].masked).toBe('ap___');
		expect(reveals[1].masked).not.toBe(word);
		expect(h.room.phase).toBe('drawing');
	});

	test('word is never fully revealed even when hintCount exceeds its length', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { hintCount: 10, customWords: ['cat'] });
		const [a, b] = ids;
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
		const [a, b] = ids;

		const w1 = chooseWord(h, a);
		h.send(b, { type: 'guess', text: w1 }); // instant: 500 + 50; drawer 500 + 200
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(REVEAL_MS);

		expect(h.room.phase).toBe('choosing');
		const started = h.typeTo(a, 'turnStarted');
		expect(started).toHaveLength(1);
		expect(started[0].drawerId).toBe(b);
		expect(started[0].round).toBe(1);
		expect(started[0].turnIndex).toBe(1);

		chooseWord(h, b);
		h.clock.advance(DRAW_MS); // nobody guesses
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(REVEAL_MS);

		expect(h.room.phase).toBe('finished');
		const ended = h.typeTo(b, 'gameEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0].winnerId).toBe(a); // 700 vs 550
		expect(ended[0].totals).toEqual({ [a]: 700, [b]: 550 });
		expect(h.room.winnerId).toBe(a);
	});

	test('playAgain: host only, resets to lobby', () => {
		const { h, ids } = startedGame(['Alice', 'Bob'], { rounds: 1 });
		const [a, b] = ids;
		chooseWord(h, a);
		h.clock.advance(DRAW_MS + REVEAL_MS); // turn 1 over, turn 2 begins
		chooseWord(h, b);
		h.clock.advance(DRAW_MS + REVEAL_MS);
		expect(h.room.phase).toBe('finished');

		h.clear();
		h.send(b, { type: 'playAgain' });
		expect(h.typeTo(b, 'error')[0].code).toBe('not_allowed');
		expect(h.room.phase).toBe('finished');

		h.clear();
		h.send(a, { type: 'playAgain' });
		expect(h.room.phase).toBe('lobby');
		expect(h.room.round).toBe(0);
		expect(h.room.turnIndex).toBe(0);
		expect(h.room.turnOrder).toEqual([]);
		const states = h.typeTo(b, 'roomState');
		expect(states).toHaveLength(1);
		expect(states[0].room.phase).toBe('lobby');
	});
});

// ---------------------------------------------------------------------------
// Disconnects
// ---------------------------------------------------------------------------

describe('disconnects', () => {
	test('drawer disconnect during drawing skips the turn without scoring', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const [a, b, c] = ids;
		chooseWord(h, a);
		h.clock.advance(1000);
		h.clear();
		h.room.disconnect(a);

		expect(h.room.phase).toBe('reveal');
		const ended = h.typeTo(b, 'turnEnded');
		expect(ended).toHaveLength(1);
		expect(ended[0].gains).toEqual({});
		expect(ended[0].totals).toEqual({ [a]: 0, [b]: 0, [c]: 0 });
		expect(ended[0].endsAt).toBe(h.clock.now + SKIP_REVEAL_MS);
		expect(h.chatsTo(c).some((e) => e.scope === 'system' && e.text.includes('turn skipped'))).toBe(
			true
		);

		// Host moved off the disconnected drawer.
		expect(h.room.hostId).toBe(b);
		expect(h.typeTo(c, 'hostChanged')[0].hostId).toBe(b);

		h.clear();
		h.clock.advance(SKIP_REVEAL_MS);
		expect(h.room.phase).toBe('choosing');
		expect(h.typeTo(c, 'turnStarted')[0].drawerId).toBe(b);
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
		const [a, b, c] = ids;
		const word = chooseWord(h, a);
		h.send(b, { type: 'guess', text: word }); // 500 + 50
		h.send(c, { type: 'guess', text: word }); // 500 + 30 → turn ends, scores applied
		expect(h.room.players.get(b)!.score).toBe(550);

		h.room.disconnect(b);
		h.clock.advance(1000);
		h.clear();

		const res = h.room.join('Bob', () => {});
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
		expect(joined[0].room.players.find((p) => p.id === b)!.score).toBe(550);
		for (const id of [a, c]) {
			expect(h.typeTo(id, 'playerConnection')).toEqual([
				{ type: 'playerConnection', id: b, connected: true }
			]);
		}
		expect(h.room.turnOrder.filter((id) => id === b)).toHaveLength(1);
	});

	test('after GRACE_MS without rejoin the player is removed', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const [a, b, c] = ids;
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
		const [a, b, c] = ids;
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
		expect(h.typeTo(c, 'turnStarted')[0].drawerId).toBe(c);
	});

	test('mid-game disconnects leaving <2 connected abort to the lobby', () => {
		const { h, ids } = startedGame(['Alice', 'Bob', 'Cara']);
		const [a, b, c] = ids;
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
	const [a, b] = ids;
	chooseWord(h, a);
	h.clear();
	return { h, a, b };
}

describe('draw ops', () => {
	test('only the drawer may draw, and only during drawing', () => {
		const { h, ids } = startedGame(['Alice', 'Bob']);
		const [a, b] = ids;
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
		const [merged] = h.room.ops;
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
		expect(relayed[0].op.kind === 'stroke' && relayed[0].op.points).toHaveLength(2);
		expect(relayed[1].op.kind === 'stroke' && relayed[1].op.points).toHaveLength(1);
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
		expect(h.room.ops[1].kind).toBe('fill');
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
		const [op] = h.room.ops;
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
		expect(h.room.ops[0].kind).toBe('stroke');
		for (const id of [a, b]) {
			const state = h.typeTo(id, 'canvasState');
			expect(state).toHaveLength(1);
			expect(state[0].ops).toHaveLength(1);
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
		expect(h.room.ops[1].kind).toBe('fill');
		for (const id of [a, b]) {
			const state = h.typeTo(id, 'canvasState');
			expect(state).toHaveLength(1);
			expect(state[0].ops).toHaveLength(2);
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
		expect(h.room.ops[0].id).toBe('s2');
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

	test('redo stack is capped at 3', () => {
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

		// Only 3 redos should work
		for (let i = 0; i < 4; i++) {
			h.send(a, { type: 'redo' });
		}

		expect(h.room.ops).toHaveLength(3);
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
		const [a, b] = ids;
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
		chooseWord(h, ids[0]);
		h.clock.advance(DRAW_MS);
		expect(h.room.phase).toBe('reveal');
		h.clear();
		h.clock.advance(SYNC_MS);
		expect(h.ofType('timeSync')).toHaveLength(0);
	});
});
