import builtin from '../data/words.json';
import { normalize } from './text';
import type { Settings } from '../../src/lib/protocol';

/** Word pool for a game per the room's word-source setting. Normalized + deduped. */
export function buildWordPool(settings: Settings): string[] {
	const pool = new Set<string>();
	if (settings.wordSource !== 'custom') {
		for (const w of builtin) {
			pool.add(normalize(w));
		}
	}
	if (settings.wordSource !== 'builtin') {
		for (const w of settings.customWords) {
			const n = normalize(w);
			if (n) {
				pool.add(n);
			}
		}
	}
	pool.delete('');
	return [...pool];
}

/**
 * Sample `count` distinct choices, avoiding words already used this game.
 * If the unused pool runs dry (long games / tiny custom lists), `exhausted` is
 * true and the choices are drawn from the full pool so the game doesn't stall —
 * the caller owning `used` should reset it. Pure: `used` is never mutated here.
 */
export function sampleChoices(
	pool: readonly string[],
	// Readonly<> wrapper needed on top of ReadonlySet — same tsgolint quirk as mask.ts.
	used: Readonly<ReadonlySet<string>>,
	count: number,
	random: () => number = Math.random
): { choices: string[]; exhausted: boolean } {
	const unused = pool.filter((w) => !used.has(w));
	const exhausted = unused.length < count;
	const arr = exhausted ? [...pool] : unused;
	const n = Math.min(count, arr.length);
	for (let i = 0; i < n; i++) {
		// `i < n <= arr.length` and `j` lands in `[i, arr.length - 1]`, so both reads are in bounds;
		// the guard is what makes that checked rather than asserted, and never skips a real swap.
		const j = i + Math.floor(random() * (arr.length - i));
		const a = arr[i];
		const b = arr[j];
		if (a !== undefined && b !== undefined) {
			[arr[i], arr[j]] = [b, a];
		}
	}
	return { choices: arr.slice(0, n), exhausted };
}
