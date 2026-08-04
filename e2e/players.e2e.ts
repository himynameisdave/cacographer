import { expect, test } from './fixtures';
import {
	chooseFirstWord,
	createRoom,
	currentDrawer,
	drawStroke,
	inkCount,
	rosterRow,
	sendChat,
	startDrawingTurn,
	submitNameGate,
	systemChat
} from './helpers';

test('a vanished player dims in the roster and re-locks the start gate', async ({
	request,
	joinPlayers
}) => {
	const code = await createRoom(request);
	const [alice, bob] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice || !bob) {
		throw new Error('setup failed');
	}
	await expect(alice.page.getByRole('button', { name: 'Start game' })).toBeEnabled();

	await bob.context.close();
	await expect(systemChat(alice.page, 'Bob disconnected')).toBeVisible();
	await expect(rosterRow(alice.page, 'Bob')).toHaveClass(/disconnected/u);
	await expect(alice.page.getByRole('button', { name: 'Start game' })).toBeDisabled();
	await expect(alice.page.getByText('Need at least 2 connected players to start.')).toBeVisible();
});

test('the crown passes when the host leaves', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const [alice, bob] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice || !bob) {
		throw new Error('setup failed');
	}
	await expect(rosterRow(bob.page, 'Alice').locator('.crown')).toBeVisible();

	await alice.context.close();
	await expect(systemChat(bob.page, 'Bob is now the host')).toBeVisible();
	await expect(rosterRow(bob.page, 'Bob(you)').locator('.crown')).toBeVisible();
	// Host powers arrive with the crown: editable settings and the start button.
	await expect(bob.page.locator('.settings input[type="range"]')).toHaveCount(5);
	await expect(bob.page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('a refresh mid-turn reconnects with score and drawing intact', async ({
	request,
	joinPlayers
}) => {
	test.setTimeout(90_000);
	// Three players: when one guesser refreshes, the other keeps the turn alive
	// (with a lone guesser gone, the engine would end the turn as all-guessed).
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob', 'Carol');

	// Turn 1 completes so there are points on the board.
	const turn1 = await startDrawingTurn(players);
	const [ga, gb] = turn1.guessers;
	if (ga === undefined || gb === undefined) {
		throw new Error('setup failed');
	}
	await drawStroke(turn1.drawer.page);
	await sendChat(ga.page, turn1.word);
	await sendChat(gb.page, turn1.word);

	// Turn 2: refresh someone who is guessing this turn (everyone has points now).
	const drawer2 = await currentDrawer(players);
	const word2 = await chooseFirstWord(drawer2.page);
	await drawStroke(drawer2.page);
	const reloader = players.find((p) => p !== drawer2);
	if (reloader === undefined) {
		throw new Error('setup failed');
	}

	const scoreText = await rosterRow(drawer2.page, reloader.name).locator('.score').textContent();
	const score = scoreText ?? '';
	expect(score).not.toBe('0 pts');

	// Refresh mid-drawing: same-name rejoin reattaches the player.
	await reloader.page.reload();
	await submitNameGate(reloader.page, reloader.name);
	await expect(systemChat(drawer2.page, `${reloader.name} reconnected`)).toBeVisible();
	// Score kept, canvas replayed, word still secret.
	await expect(rosterRow(reloader.page, `${reloader.name}(you)`).locator('.score')).toHaveText(
		score
	);
	await expect(reloader.page.locator('.wordblanks .slot')).toHaveCount(word2.length);
	await expect.poll(async () => inkCount(reloader.page)).toBeGreaterThan(50);
	await expect(reloader.page.locator('body')).not.toContainText(word2);
});

test('the show goes on when the drawer bails', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob', 'Carol');
	const { drawer, guessers } = await startDrawingTurn(players);

	await drawer.context.close();
	const [g1, g2] = guessers;
	if (g1 === undefined || g2 === undefined) {
		throw new Error('setup failed');
	}
	await expect(systemChat(g1.page, 'The drawer left — turn skipped')).toBeVisible();
	await expect(systemChat(g2.page, 'The drawer left — turn skipped')).toBeVisible();
	// The next turn starts among the remaining players.
	const nextDrawer = await currentDrawer(guessers);
	expect(nextDrawer.name).not.toBe(drawer.name);
});
