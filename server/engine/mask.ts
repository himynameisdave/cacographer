/**
 * Word masking + progressive reveal.
 * The masked string has the same length as the word: hidden letters become '_',
 * spaces stay spaces, revealed positions show the real letter. Rendering with
 * per-letter spacing is the client's job.
 */

// The Readonly<> wrapper around ReadonlySet is not redundant: tsgolint's
// prefer-readonly-parameter-types check only recognizes the outer Readonly<> generic, not the
// (already immutable) ReadonlySet interface on its own.
export function maskWord(word: string, revealed: Readonly<ReadonlySet<number>>): string {
	let out = '';
	for (let i = 0; i < word.length; i++) {
		out += word[i] === ' ' || revealed.has(i) ? word[i] : '_';
	}
	return out;
}

export function letterCount(word: string): number {
	let n = 0;
	for (const ch of word) {
		if (ch !== ' ') {
			n++;
		}
	}
	return n;
}

/** Effective hint budget for a word: never reveal the entire word. */
export function maxHints(word: string, hintCount: number): number {
	return Math.max(0, Math.min(hintCount, letterCount(word) - 1));
}

/** Elapsed-ms offsets at which to fire each of `hints` reveals, evenly spaced:
 * the i-th hint at drawMs * i / (hints + 1). */
export function revealSchedule(drawMs: number, hints: number): number[] {
	const out: number[] = [];
	for (let i = 1; i <= hints; i++) {
		out.push(Math.round((drawMs * i) / (hints + 1)));
	}
	return out;
}

/** Pick a random not-yet-revealed, non-space index; null if none remain hidden. */
export function pickRevealIndex(
	word: string,
	// See the Readonly<> note on maskWord above.
	revealed: Readonly<ReadonlySet<number>>,
	random: () => number = Math.random
): number | null {
	const candidates: number[] = [];
	for (let i = 0; i < word.length; i++) {
		if (word[i] !== ' ' && !revealed.has(i)) {
			candidates.push(i);
		}
	}
	if (candidates.length === 0) {
		return null;
	}
	return candidates[Math.floor(random() * candidates.length)];
}
