import { describe, expect, test } from 'bun:test';
import {
	MAX_GUESS,
	MIN_GUESS,
	ORDINAL_BONUS,
	SWEEP_BONUS,
	drawerPoints,
	guesserTimePoints,
	ordinalBonus
} from './scoring';

const DRAW_MS = 80_000;
const ENDS_AT = 1_080_000; // turn started at 1_000_000

describe('guesserTimePoints', () => {
	test('instant guess (guessedAt = endsAt - drawMs) earns MAX_GUESS (500)', () => {
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT - DRAW_MS)).toBe(500);
		expect(MAX_GUESS).toBe(500);
	});

	test('last-moment guess (guessedAt = endsAt) earns the MIN_GUESS floor (100)', () => {
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT)).toBe(100);
		expect(MIN_GUESS).toBe(100);
	});

	test('midpoint guess earns 300', () => {
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT - DRAW_MS / 2)).toBe(300);
	});

	test('clamps to the floor if guessedAt is past endsAt', () => {
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT + 5000)).toBe(100);
	});

	test('clamps to the max if guessedAt is somehow before the turn start', () => {
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT - DRAW_MS - 9999)).toBe(500);
	});

	test('linear in between (quarter points)', () => {
		// 3/4 of the time remaining → 100 + 400 * 0.75 = 400
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT - DRAW_MS * 0.75)).toBe(400);
		// 1/4 remaining → 200
		expect(guesserTimePoints(ENDS_AT, DRAW_MS, ENDS_AT - DRAW_MS * 0.25)).toBe(200);
	});
});

describe('ordinalBonus', () => {
	test('50/30/10 for the first three correct guesses', () => {
		expect(ordinalBonus(0)).toBe(50);
		expect(ordinalBonus(1)).toBe(30);
		expect(ordinalBonus(2)).toBe(10);
		expect(ORDINAL_BONUS).toEqual([50, 30, 10]);
	});

	test('0 afterwards', () => {
		expect(ordinalBonus(3)).toBe(0);
		expect(ordinalBonus(10)).toBe(0);
	});
});

describe('drawerPoints', () => {
	test('no guessers → 0, regardless of eligible count', () => {
		expect(drawerPoints([], 0)).toBe(0);
		expect(drawerPoints([], 3)).toBe(0);
	});

	test('average of time points, rounded', () => {
		expect(drawerPoints([500, 300], 3)).toBe(400); // no sweep: 2 of 3 guessed
		expect(drawerPoints([400, 300], 3)).toBe(350);
		expect(drawerPoints([405, 400], 3)).toBe(403); // 402.5 rounds up
	});

	test('sweep bonus (+200) only when every eligible guesser got it', () => {
		expect(SWEEP_BONUS).toBe(200);
		expect(drawerPoints([500, 300], 2)).toBe(400 + 200);
		expect(drawerPoints([333], 1)).toBe(333 + 200);
	});

	test('no sweep bonus when eligibleCount is 0', () => {
		// Contrived: guessers recorded but nobody counted eligible.
		expect(drawerPoints([500], 0)).toBe(500);
	});
});
