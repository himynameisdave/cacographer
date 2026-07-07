import { describe, expect, test } from 'bun:test';
import builtin from '../data/words.json';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/protocol';
import { normalize } from './text';
import { buildWordPool, sampleChoices } from './words';

function settings(partial: Partial<Settings>): Settings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...partial };
}

const builtinNormalized = new Set((builtin as string[]).map((w) => normalize(w)));

describe('buildWordPool', () => {
	test('builtin source includes builtin words and ignores customWords', () => {
		const pool = buildWordPool(
			settings({ wordSource: 'builtin', customWords: ['zzzcustomword', 'anothercustom'] })
		);
		expect(pool).toContain('cat');
		expect(pool).not.toContain('zzzcustomword');
		expect(pool).not.toContain('anothercustom');
		expect(pool.length).toBe(builtinNormalized.size);
	});

	test('custom source uses only normalized, deduped custom words', () => {
		const pool = buildWordPool(
			settings({
				wordSource: 'custom',
				customWords: [' Apple ', 'apple', 'BANANA', 'ice   CREAM']
			})
		);
		expect(pool).toEqual(['apple', 'banana', 'ice cream']);
		expect(pool).not.toContain('cat'); // no builtin leakage
	});

	test('both merges builtin and custom', () => {
		const pool = buildWordPool(settings({ wordSource: 'both', customWords: ['zzzcustomword'] }));
		expect(pool).toContain('cat');
		expect(pool).toContain('zzzcustomword');
		expect(pool.length).toBe(builtinNormalized.size + 1);
	});

	test('both dedupes custom words that match builtin words', () => {
		const pool = buildWordPool(settings({ wordSource: 'both', customWords: ['CAT', 'cat '] }));
		expect(pool.filter((w) => w === 'cat')).toHaveLength(1);
	});

	test('empty-string and whitespace-only custom words are dropped', () => {
		const pool = buildWordPool(
			settings({ wordSource: 'custom', customWords: ['', '   ', '\t', 'real'] })
		);
		expect(pool).toEqual(['real']);
	});
});

describe('sampleChoices', () => {
	test('returns count distinct words from the pool', () => {
		const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
		const rands = [0.9, 0.1, 0.5];
		const out = sampleChoices(pool, new Set(), 3, () => rands.shift() ?? 0);
		expect(out).toHaveLength(3);
		expect(new Set(out).size).toBe(3);
		for (const w of out) {
			expect(pool).toContain(w);
		}
	});

	test('avoids words in used', () => {
		const used = new Set(['a', 'c']);
		const out = sampleChoices(['a', 'b', 'c', 'd'], used, 2, () => 0);
		expect(out).toEqual(['b', 'd']);
	});

	test('clears used and reuses the full pool when the unused pool is too small', () => {
		const used = new Set(['a', 'b']);
		const out = sampleChoices(['a', 'b', 'c'], used, 2, () => 0);
		expect(used.size).toBe(0);
		expect(out).toHaveLength(2);
		expect(out).toEqual(['a', 'b']); // random()=0 keeps pool order
	});

	test('returns fewer than count when the whole pool is smaller', () => {
		const used = new Set<string>();
		const out = sampleChoices(['only'], used, 3, () => 0);
		expect(out).toEqual(['only']);
	});

	test('deterministic with an injected random sequence', () => {
		const rands = [0.5, 0];
		// i=0: j = 0 + floor(0.5*4) = 2 → swap a/c → [c,b,a,d]
		// i=1: j = 1 + floor(0*3) = 1 → keep b
		const out = sampleChoices(['a', 'b', 'c', 'd'], new Set(), 2, () => rands.shift() ?? 0);
		expect(out).toEqual(['c', 'b']);
	});

	test('random()=0 selects the first unused words in pool order', () => {
		const out = sampleChoices(['x', 'y', 'z'], new Set(), 2, () => 0);
		expect(out).toEqual(['x', 'y']);
	});

	test('does not mutate the pool', () => {
		const pool = ['a', 'b', 'c', 'd'];
		sampleChoices(pool, new Set(), 3, () => 0.7);
		expect(pool).toEqual(['a', 'b', 'c', 'd']);
	});
});
