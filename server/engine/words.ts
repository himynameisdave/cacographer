import builtin from '../data/words.json';
import { normalize } from './text';
import type { Settings } from '../../src/lib/protocol';

/** Word pool for a game per the room's word-source setting. Normalized + deduped. */
export function buildWordPool(settings: Settings): string[] {
	const pool = new Set<string>();
	if (settings.wordSource !== 'custom') {
		for (const w of builtin as string[]) pool.add(normalize(w));
	}
	if (settings.wordSource !== 'builtin') {
		for (const w of settings.customWords) {
			const n = normalize(w);
			if (n) pool.add(n);
		}
	}
	pool.delete('');
	return [...pool];
}

/**
 * Sample `count` distinct choices, avoiding words already used this game.
 * If the unused pool runs dry (long games / tiny custom lists), the used set
 * is cleared and words may repeat rather than the game stalling.
 */
export function sampleChoices(
	pool: string[],
	used: Set<string>,
	count: number,
	random: () => number = Math.random
): string[] {
	let available = pool.filter((w) => !used.has(w));
	if (available.length < count) {
		used.clear();
		available = [...pool];
	}
	const arr = [...available];
	const n = Math.min(count, arr.length);
	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(random() * (arr.length - i));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr.slice(0, n);
}
