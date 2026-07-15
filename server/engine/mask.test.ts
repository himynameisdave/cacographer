import { describe, expect, test } from 'bun:test';
import { letterCount, maskWord, maxHints, pickRevealIndex, revealSchedule } from './mask';

describe('maskWord', () => {
	test('hides all letters as underscores when nothing revealed', () => {
		expect(maskWord('apple', new Set())).toBe('_____');
	});

	test('preserves spaces', () => {
		expect(maskWord('ice cream', new Set())).toBe('___ _____');
	});

	test('shows revealed indexes', () => {
		expect(maskWord('apple', new Set([1, 3]))).toBe('_p_l_');
		expect(maskWord('ice cream', new Set([0, 4]))).toBe('i__ c____');
	});

	test('fully revealed word round-trips', () => {
		expect(maskWord('cat', new Set([0, 1, 2]))).toBe('cat');
	});

	test('same length as the word', () => {
		expect(maskWord('hot dog stand', new Set()).length).toBe('hot dog stand'.length);
	});
});

describe('letterCount', () => {
	test('counts letters only', () => {
		expect(letterCount('apple')).toBe(5);
	});

	test('excludes spaces', () => {
		expect(letterCount('ice cream')).toBe(8);
		expect(letterCount('a b c')).toBe(3);
	});

	test('empty string is 0', () => {
		expect(letterCount('')).toBe(0);
	});
});

describe('maxHints', () => {
	test('caps at letterCount - 1 so the word is never fully revealed', () => {
		expect(maxHints('cat', 10)).toBe(2);
		expect(maxHints('ice cream', 100)).toBe(7);
	});

	test('uses hintCount when below the cap', () => {
		expect(maxHints('elephant', 3)).toBe(3);
		expect(maxHints('elephant', 0)).toBe(0);
	});

	test('never negative', () => {
		expect(maxHints('', 5)).toBe(0);
		expect(maxHints('a', 5)).toBe(0);
		expect(maxHints('cat', -3)).toBe(0);
	});
});

describe('revealSchedule', () => {
	test('evenly spaces H hints over T ms: i-th at T*i/(H+1)', () => {
		expect(revealSchedule(90_000, 2)).toEqual([30_000, 60_000]);
		expect(revealSchedule(8000, 3)).toEqual([2000, 4000, 6000]);
	});

	test('rounds non-integer offsets', () => {
		expect(revealSchedule(80_000, 2)).toEqual([26_667, 53_333]);
	});

	test('matches the formula for arbitrary inputs', () => {
		const T = 123_456;
		const H = 5;
		const sched = revealSchedule(T, H);
		expect(sched).toHaveLength(H);
		for (let i = 1; i <= H; i++) {
			expect(sched[i - 1]).toBe(Math.round((T * i) / (H + 1)));
		}
	});

	test('zero hints yields an empty schedule', () => {
		expect(revealSchedule(60_000, 0)).toEqual([]);
	});

	test('offsets are strictly increasing and within (0, T)', () => {
		const sched = revealSchedule(60_000, 4);
		for (let i = 0; i < sched.length; i++) {
			expect(sched[i]).toBeGreaterThan(0);
			expect(sched[i]).toBeLessThan(60_000);
			if (i > 0) {
				expect(sched[i]).toBeGreaterThan(sched[i - 1]!);
			}
		}
	});
});

describe('pickRevealIndex', () => {
	test('deterministic pick with injected random', () => {
		// candidates for 'ab c' with nothing revealed: [0, 1, 3]
		expect(pickRevealIndex('ab c', new Set(), () => 0)).toBe(0);
		expect(pickRevealIndex('ab c', new Set(), () => 0.5)).toBe(1);
		expect(pickRevealIndex('ab c', new Set(), () => 0.99)).toBe(3);
	});

	test('never returns a space index', () => {
		for (let r = 0; r < 1; r += 0.05) {
			const idx = pickRevealIndex('a b c', new Set(), () => r);
			expect(idx).not.toBeNull();
			expect('a b c'[idx!]).not.toBe(' ');
		}
	});

	test('never returns an already-revealed index', () => {
		const revealed = new Set([0, 2]);
		for (let r = 0; r < 1; r += 0.05) {
			const idx = pickRevealIndex('abcd', revealed, () => r);
			expect(idx).not.toBeNull();
			expect(revealed.has(idx!)).toBe(false);
		}
	});

	test('returns null when every letter is revealed', () => {
		expect(pickRevealIndex('cat', new Set([0, 1, 2]), () => 0)).toBeNull();
	});

	test('returns null for a word with no letters', () => {
		expect(pickRevealIndex('   ', new Set(), () => 0)).toBeNull();
		expect(pickRevealIndex('', new Set(), () => 0)).toBeNull();
	});
});
