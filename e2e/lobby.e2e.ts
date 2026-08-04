import { expect, test } from './fixtures';
import { createRoom, rosterRow, sendChat, setSlider, setWordSource, systemChat } from './helpers';

test('the roster and system chat update live as players join', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const [alice, bob] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice || !bob) {
		throw new Error('setup failed');
	}
	await expect(alice.page.locator('.players .player')).toHaveCount(2);
	await expect(systemChat(alice.page, 'Bob joined')).toBeVisible();
	await expect(rosterRow(bob.page, 'Alice')).toBeVisible();
	await expect(rosterRow(alice.page, 'Alice(you)').locator('.crown')).toBeVisible();
	await expect(rosterRow(bob.page, 'Alice').locator('.crown')).toBeVisible();
});

test('starting is host-only and gated on two connected players', async ({
	request,
	joinPlayers
}) => {
	const code = await createRoom(request);
	const [alice] = await joinPlayers(code, 'Alice');
	if (!alice) {
		throw new Error('setup failed');
	}
	const start = alice.page.getByRole('button', { name: 'Start game' });
	await expect(start).toBeDisabled();
	await expect(alice.page.getByText('Need at least 2 connected players to start.')).toBeVisible();

	const [bob] = await joinPlayers(code, 'Bob');
	if (!bob) {
		throw new Error('setup failed');
	}
	await expect(start).toBeEnabled();
	await expect(bob.page.getByRole('button', { name: 'Start game' })).toHaveCount(0);
	await expect(bob.page.getByText('Waiting for Alice to start the game…')).toBeVisible();
});

test('host settings changes sync to the guest read-only panel', async ({
	request,
	joinPlayers
}) => {
	const code = await createRoom(request);
	const [alice, bob] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice || !bob) {
		throw new Error('setup failed');
	}
	await expect(bob.page.getByText('Only the host can change settings.')).toBeVisible();
	await expect(bob.page.locator('.settings input[type="range"]')).toHaveCount(0);

	await setSlider(alice.page, 'Rounds', 5);
	await expect(bob.page.locator('.summary div', { hasText: 'Rounds' }).locator('dd')).toHaveText(
		'5'
	);

	await setWordSource(alice.page, 'custom', ['pizza', 'robot']);
	// "Custom words" is a substring of the "Words: Custom words only" row too —
	// pin the row by its exact <dt>.
	await expect(
		bob.page
			.locator('.summary div')
			.filter({ has: bob.page.locator('dt', { hasText: /^Custom words$/u }) })
			.locator('dd')
	).toHaveText('2');
});

test('a taken name bounces at the gate and a new name gets in', async ({
	request,
	joinPlayers,
	browser
}) => {
	const code = await createRoom(request);
	await joinPlayers(code, 'Alice');

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`/game/${code}`);
	await page.getByPlaceholder('Your name').fill('Alice');
	await page.getByRole('button', { name: 'Join game' }).click();
	await expect(page.getByText('That name is taken — try another.')).toBeVisible();
	await page.getByPlaceholder('Your name').fill('Bob');
	await page.getByRole('button', { name: 'Join game' }).click();
	await expect(rosterRow(page, 'Bob(you)')).toBeVisible();
	await context.close();
});

test('your name is remembered for next time', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const [alice] = await joinPlayers(code, 'Alice');
	if (!alice) {
		throw new Error('setup failed');
	}
	await alice.page.reload();
	await expect(alice.page.getByPlaceholder('Your name')).toHaveValue('Alice');
});

test('copy link puts the room URL on the clipboard', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const [alice] = await joinPlayers(code, 'Alice');
	if (!alice) {
		throw new Error('setup failed');
	}
	await alice.context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await alice.page.getByRole('button', { name: 'Copy link' }).click();
	await expect(alice.page.getByRole('button', { name: 'Copied!' })).toBeVisible();
	const copied = await alice.page.evaluate(async () => navigator.clipboard.readText());
	expect(copied).toBe(alice.page.url());
});

test('a full room turns latecomers away', async ({ request, joinPlayers, browser }) => {
	const code = await createRoom(request);
	const [alice] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice) {
		throw new Error('setup failed');
	}
	await setSlider(alice.page, 'Max players', 2);

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`/game/${code}`);
	await page.getByPlaceholder('Your name').fill('Carol');
	await page.getByRole('button', { name: 'Join game' }).click();
	await expect(page.getByText('That room is full.')).toBeVisible();
	await context.close();
});

test('lobby chat flows both ways and filters potty mouths', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const [alice, bob] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice || !bob) {
		throw new Error('setup failed');
	}
	await sendChat(alice.page, 'hello there');
	await expect(bob.page.locator('.msg', { hasText: 'hello there' })).toBeVisible();

	await sendChat(bob.page, 'fuck');
	// The server swaps the message for a potty-mouth phrase, rendered italicized.
	await expect(alice.page.locator('.msg .text.filtered')).toBeVisible();
	await expect(alice.page.locator('.messages')).not.toContainText('fuck');
	await expect(bob.page.locator('.messages')).not.toContainText('fuck');
});

test('avatar and name color travel with the player', async ({ request, joinPlayers, browser }) => {
	const code = await createRoom(request);
	const [alice] = await joinPlayers(code, 'Alice');
	if (!alice) {
		throw new Error('setup failed');
	}

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`/game/${code}`);
	// Scribble a self-portrait on the gate's avatar canvas.
	const canvas = page.locator('.gate-card canvas');
	const box = await canvas.boundingBox();
	if (box === null) {
		throw new Error('avatar canvas not visible');
	}
	await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 5 });
	await page.mouse.up();
	// Pick a chat name color (Sky, #38bdf8).
	await page.getByRole('button', { name: 'Color Sky (#38bdf8)' }).click();
	await expect(page.locator('.gate-preview')).toHaveCSS('color', 'rgb(56, 189, 248)');
	await page.getByPlaceholder('Your name').fill('Bob');
	await page.getByRole('button', { name: 'Join game' }).click();
	await expect(rosterRow(page, 'Bob(you)')).toBeVisible();

	// Alice sees Bob's drawn avatar in the roster, and his name color in chat.
	await expect(rosterRow(alice.page, 'Bob').locator('img.avatar')).toBeVisible();
	await sendChat(page, 'nice to be here');
	const bobChatName = alice.page.locator('.msg', { hasText: 'nice to be here' }).locator('.name');
	await expect(bobChatName).toHaveCSS('color', 'rgb(56, 189, 248)');
	await context.close();
});
