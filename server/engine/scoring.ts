/** Pure scoring functions. Tune constants to taste. */

export const MAX_GUESS = 500; // instant guess
export const MIN_GUESS = 100; // last-second guess (floor)
export const SWEEP_BONUS = 200; // drawer bonus if every eligible guesser got it
export const ORDINAL_BONUS = [50, 30, 10]; // extra for 1st/2nd/3rd correct guess

/** Time-curve points: linear from MAX_GUESS at turn start to MIN_GUESS at the end. */
export function guesserTimePoints(endsAt: number, drawMs: number, guessedAtMs: number): number {
	const remaining = Math.max(0, Math.min(drawMs, endsAt - guessedAtMs));
	const ratio = remaining / drawMs; // 1 at start → 0 at end
	return Math.round(MIN_GUESS + (MAX_GUESS - MIN_GUESS) * ratio);
}

/** Extra points by guess order (0-based): +50/+30/+10, then nothing. */
export function ordinalBonus(order: number): number {
	return ORDINAL_BONUS[order] ?? 0;
}

/**
 * Drawer reward: average of the guessers' *time-curve* points (ordinal bonuses
 * excluded so drawer pay reflects drawing quality, not guesser race position),
 * plus a sweep bonus when every eligible guesser got the word.
 */
export function drawerPoints(timePoints: number[], eligibleCount: number): number {
	if (timePoints.length === 0) {
		return 0;
	}
	const avg = timePoints.reduce((a, b) => a + b, 0) / timePoints.length;
	const sweep = eligibleCount > 0 && timePoints.length === eligibleCount ? SWEEP_BONUS : 0;
	return Math.round(avg + sweep);
}
