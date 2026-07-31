/**
 * Shared helpers for the Playwright end-to-end suite. Each player is a separate
 * browser context (fully isolated storage — the "incognito window per player"
 * idea), all talking to one Bun game server over real WebSockets.
 */
import {
	expect,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Locator,
	type Page
} from '@playwright/test';
import type { Settings } from '../src/lib/protocol';

/** One connected player: an isolated browser context plus its page. */
export type Player = {
	readonly name: string;
	readonly context: BrowserContext;
	readonly page: Page;
};

/** Deterministic custom word list used by most game specs — all lowercase
 * single words (the engine normalizes words that way), none a substring of
 * any UI copy or player name, so "the word never leaks" body scans are safe. */
export const WORDS: readonly string[] = [
	'wizard',
	'goblin',
	'dragon',
	'potion',
	'castle',
	'shield',
	'jester',
	'meteor'
];

/** Create a room via the server API and return its code. */
export async function createRoom(request: APIRequestContext): Promise<string> {
	const res = await request.post('/api/rooms');
	expect(res.ok()).toBe(true);
	const body = (await res.json()) as { code: string };
	return body.code;
}

/** Fill the name gate and wait until we're in the room's roster. */
export async function submitNameGate(page: Page, name: string): Promise<void> {
	await page.getByPlaceholder('Your name').fill(name);
	await page.getByRole('button', { name: 'Join game' }).click();
	await expect(page.locator('.players .player', { hasText: `${name}(you)` })).toBeVisible();
}

/** Open a fresh isolated context and join the room through the name gate. */
export async function join(browser: Browser, code: string, name: string): Promise<Player> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`/game/${code}`);
	await submitNameGate(page, name);
	return { name, context, page };
}

/** Set a lobby slider by its row label, firing the events SettingsPanel commits on,
 * then wait for the server round-trip to echo the value back. */
export async function setSlider(page: Page, label: string, value: number): Promise<void> {
	const row = page.locator('.settings label', { hasText: label });
	await row.locator('input[type="range"]').evaluate((el: HTMLInputElement, v: number) => {
		el.value = String(v);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, value);
	await expect(row.locator('.val')).toHaveText(new RegExp(`^${value}s?$`, 'u'));
}

/** Switch the word source; optionally fill the custom-words list (committed on blur). */
export async function setWordSource(
	page: Page,
	source: Settings['wordSource'],
	words?: readonly string[]
): Promise<void> {
	await page.locator('.settings select').selectOption(source);
	if (words !== undefined) {
		const box = page.locator('.settings textarea');
		await box.fill(words.join('\n'));
		await box.blur();
		await expect(page.locator('.settings .sub', { hasText: 'saved' })).toHaveText(
			`${words.length} saved`
		);
	}
}

/** Start the game from the host's lobby. */
export async function startGame(host: Page): Promise<void> {
	await host.getByRole('button', { name: 'Start game' }).click();
}

/** Wait for the choosing phase and return whichever player is up to draw. */
export async function currentDrawer(players: readonly Player[]): Promise<Player> {
	let drawerIndex = -1;
	await expect
		.poll(
			async () => {
				const up = await Promise.all(
					players.map(async (p) => p.page.getByText('Your turn to draw!').isVisible())
				);
				drawerIndex = up.indexOf(true);
				return drawerIndex;
			},
			{ timeout: 20_000, message: 'no player entered the choosing phase' }
		)
		.toBeGreaterThan(-1);
	const drawer = players[drawerIndex];
	if (drawer === undefined) {
		throw new Error('unreachable: poll passed without finding a drawer');
	}
	return drawer;
}

/** Click the drawer's first offered word and return it (drawing starts). */
export async function chooseFirstWord(drawer: Page): Promise<string> {
	const first = drawer.locator('.word-choices button').first();
	await first.waitFor();
	const label = await first.textContent();
	const word = (label ?? '').trim();
	await first.click();
	await expect(drawer.locator('.wordblanks .label')).toBeVisible();
	return word;
}

/** The shared game canvas. */
export function gameCanvas(page: Page): Locator {
	return page.locator('.board canvas');
}

/** Count canvas pixels that aren't blank/white — a proxy for "something is drawn". */
export async function inkCount(page: Page): Promise<number> {
	return gameCanvas(page).evaluate((el: HTMLCanvasElement) => {
		const ctx = el.getContext('2d');
		if (ctx === null) {
			return 0;
		}
		const { data } = ctx.getImageData(0, 0, el.width, el.height);
		let n = 0;
		for (let i = 0; i < data.length; i += 4) {
			const alpha = data[i + 3] ?? 0;
			const r = data[i] ?? 0;
			const g = data[i + 1] ?? 0;
			const b = data[i + 2] ?? 0;
			if (alpha > 0 && (r < 245 || g < 245 || b < 245)) {
				n++;
			}
		}
		return n;
	});
}

/** Drag a pen stroke across the canvas between two normalized (0..1) points. */
export async function drawStroke(
	page: Page,
	from: readonly [number, number] = [0.25, 0.3],
	to: readonly [number, number] = [0.7, 0.6]
): Promise<void> {
	const box = await gameCanvas(page).boundingBox();
	if (box === null) {
		throw new Error('canvas is not visible');
	}
	await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
	await page.mouse.up();
	// Stroke points flush on a 40ms interval — let the tail land before asserting.
	await page.waitForTimeout(150);
}

/** Send a chat message (or guess — the server decides) through the composer. */
export async function sendChat(page: Page, text: string): Promise<void> {
	const input = page.locator('.composer input');
	await input.fill(text);
	await input.press('Enter');
}

/** Read the drawer's real word off their WordBlanks strip. */
export async function drawerWord(page: Page): Promise<string> {
	const blanks = page.locator('.wordblanks .blanks');
	await blanks.waitFor();
	// `join` renders a null textContent as '' on its own.
	return blanks.evaluate((el: HTMLElement) =>
		[...el.children]
			.map((c) => (c.classList.contains('gap') ? ' ' : c.textContent))
			.join('')
			.trim()
	);
}

export type TurnSetup = {
	readonly drawer: Player;
	readonly guessers: readonly Player[];
	readonly word: string;
};

/** Lobby → mid-drawing in one call: one round, custom words, host starts, drawer picks. */
export async function startDrawingTurn(
	players: readonly Player[],
	opts: {
		readonly words?: readonly string[];
		readonly drawTimeSeconds?: number;
		readonly hintCount?: number;
	} = {}
): Promise<TurnSetup> {
	const [host] = players;
	if (host === undefined) {
		throw new Error('need at least one player');
	}
	await setSlider(host.page, 'Rounds', 1);
	if (opts.drawTimeSeconds !== undefined) {
		await setSlider(host.page, 'Draw time', opts.drawTimeSeconds);
	}
	if (opts.hintCount !== undefined) {
		await setSlider(host.page, 'Letter hints', opts.hintCount);
	}
	await setWordSource(host.page, 'custom', opts.words ?? WORDS);
	await startGame(host.page);
	const drawer = await currentDrawer(players);
	const word = await chooseFirstWord(drawer.page);
	const guessers = players.filter((p) => p !== drawer);
	return { drawer, guessers, word };
}

/** A system line in chat ("Bob joined", "Alice guessed the word!", …). */
export function systemChat(page: Page, text: string): Locator {
	return page.locator('.msg.system', { hasText: text });
}

/** The roster row for a player. */
export function rosterRow(page: Page, name: string): Locator {
	return page.locator('.players .player', { hasText: name });
}
