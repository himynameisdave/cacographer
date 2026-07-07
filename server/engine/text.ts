/** Guess/word normalization: trim, lowercase, collapse internal whitespace. */
export function normalize(s: string): string {
	return s.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
}

/** Levenshtein distance, used for the "you're close!" hint (distance === 1). */
export function levenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}

	let prev = Array.from({ length: b.length + 1 }, () => 0);
	let curr = Array.from({ length: b.length + 1 }, () => 0);
	for (let j = 0; j <= b.length; j++) {
		prev[j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[b.length];
}
