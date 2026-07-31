/**
 * The single sanctioned console seam for the game server. Server code logs through `logger`,
 * never through `console.*` directly, so `eslint/no-console` can stay an error everywhere else
 * without scattering `oxlint-disable-next-line` comments across call sites.
 *
 * Deliberately server-only: it lives under `server/**` (covered by `server/tsconfig.json`) rather
 * than in `src/lib`, so nothing here can be pulled into the client bundle. The engine under
 * `server/engine/` stays transport-agnostic and does not log — it emits messages through
 * `deps.send`.
 */

/* oxlint-disable eslint/no-console -- this module is the one sanctioned console seam */
export const logger = {
	info: (...args: readonly unknown[]): void => {
		console.log(...args);
	},
	error: (...args: readonly unknown[]): void => {
		console.error(...args);
	}
};
/* oxlint-enable eslint/no-console */
