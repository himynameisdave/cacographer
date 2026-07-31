import { expect, test } from './fixtures';
import { createRoom, drawStroke, inkCount, join, startDrawingTurn, systemChat } from './helpers';

test('guessers cannot draw', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob');
	const { drawer, guessers } = await startDrawingTurn(players);
	const [guesser] = guessers;
	if (guesser === undefined) {
		throw new Error('setup failed');
	}
	await drawStroke(guesser.page);
	await guesser.page.waitForTimeout(300);
	expect(await inkCount(guesser.page)).toBe(0);
	expect(await inkCount(drawer.page)).toBe(0);
});

test('undo, redo, and clear mirror to every canvas', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob');
	const { drawer, guessers } = await startDrawingTurn(players);
	const [guesser] = guessers;
	if (guesser === undefined) {
		throw new Error('setup failed');
	}

	await drawStroke(drawer.page, [0.1, 0.2], [0.3, 0.2]);
	await expect.poll(async () => inkCount(guesser.page)).toBeGreaterThan(0);
	const afterOne = await inkCount(guesser.page);
	await drawStroke(drawer.page, [0.6, 0.7], [0.9, 0.7]);
	await expect.poll(async () => inkCount(guesser.page)).toBeGreaterThan(afterOne);
	const afterTwo = await inkCount(guesser.page);

	await drawer.page.locator('button[title="Undo"]').click();
	await expect.poll(async () => inkCount(guesser.page)).toBeLessThan(afterTwo);
	await expect.poll(async () => inkCount(guesser.page)).toBeGreaterThan(0);

	await drawer.page.locator('button[title="Redo"]').click();
	await expect.poll(async () => inkCount(guesser.page)).toBeGreaterThan(afterOne);

	// The keyboard chord works too (focus is on the toolbar button, not an input).
	await drawer.page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => inkCount(guesser.page)).toBeLessThan(afterTwo);

	await drawer.page.locator('button[title="Clear canvas"]').click();
	await expect.poll(async () => inkCount(guesser.page)).toBe(0);
	await expect.poll(async () => inkCount(drawer.page)).toBe(0);
});

test('the fill bucket floods every canvas', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob');
	const { drawer, guessers } = await startDrawingTurn(players);
	const [guesser] = guessers;
	if (guesser === undefined) {
		throw new Error('setup failed');
	}
	await drawer.page.locator('button[title="Fill"]').click();
	const box = await drawer.page.locator('.board canvas').boundingBox();
	if (box === null) {
		throw new Error('canvas not visible');
	}
	await drawer.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	// A flood fill over a blank 800×450 canvas paints ~all 360k pixels.
	await expect
		.poll(async () => inkCount(guesser.page), { timeout: 10_000 })
		.toBeGreaterThan(300_000);
});

test('a late joiner sees the drawing in progress, not a blank canvas', async ({
	request,
	joinPlayers,
	browser
}) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob');
	const { drawer, word } = await startDrawingTurn(players);
	await drawStroke(drawer.page);

	const carol = await join(browser, code, 'Carol');
	await expect(carol.page.locator('.wordblanks .slot')).toHaveCount(word.length);
	await expect.poll(async () => inkCount(carol.page)).toBeGreaterThan(50);
	await expect(carol.page.locator('body')).not.toContainText(word);
	await expect(systemChat(drawer.page, 'Carol joined')).toBeVisible();
	await carol.context.close();
});
