import { test as base, type BrowserContext } from '@playwright/test';
import { join, type Player } from './helpers';

type Fixtures = {
	/** Join players into a room; the first name joins first and is therefore the
	 * host. Every context it opens is closed on test teardown. */
	joinPlayers: (code: string, ...names: readonly string[]) => Promise<Player[]>;
};

export const test = base.extend<Fixtures>({
	joinPlayers: async ({ browser }, use) => {
		const contexts: BrowserContext[] = [];
		await use(async (code, ...names) => {
			const [hostName, ...rest] = names;
			if (hostName === undefined) {
				throw new Error('joinPlayers needs at least one name');
			}
			// Host must join first (room creator = host); the rest can pile in together.
			const host = await join(browser, code, hostName);
			contexts.push(host.context);
			const others = await Promise.all(rest.map(async (n) => join(browser, code, n)));
			for (const p of others) {
				contexts.push(p.context);
			}
			return [host, ...others];
		});
		// Some tests close a context themselves (disconnect paths) — allSettled shrugs that off.
		await Promise.allSettled(contexts.map(async (c) => c.close()));
	}
});

export { expect } from '@playwright/test';
