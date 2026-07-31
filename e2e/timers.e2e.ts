import { expect, test } from './fixtures';
import { createRoom, currentDrawer, startGame, setSlider, setWordSource } from './helpers';

/** Real-clock paths: these tests wait out the engine's actual timers
 * (CHOOSE_MS = 15s auto-pick; hints and turn end paced by the 30s minimum
 * draw time), so this spec is the slow one by design. */

test('the drawer dawdles and the server picks for them', async ({ request, joinPlayers }) => {
	test.setTimeout(90_000);
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob');
	const [host] = players;
	if (host === undefined) {
		throw new Error('setup failed');
	}
	await setSlider(host.page, 'Rounds', 1);
	await setWordSource(host.page, 'custom', ['adventure']);
	await startGame(host.page);
	const drawer = await currentDrawer(players);
	const guesser = players.find((p) => p !== drawer);
	if (guesser === undefined) {
		throw new Error('setup failed');
	}

	// Nobody clicks a word choice; after CHOOSE_MS (15s) the server auto-picks.
	await expect(drawer.page.locator('.wordblanks .label')).toBeVisible({ timeout: 22_000 });
	await expect(guesser.page.locator('.wordblanks .slot')).toHaveCount('adventure'.length);
});

test('hints drip out and the turn dies at the buzzer', async ({ request, joinPlayers }) => {
	test.setTimeout(90_000);
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob');
	const [host] = players;
	if (host === undefined) {
		throw new Error('setup failed');
	}
	await setSlider(host.page, 'Rounds', 1);
	await setSlider(host.page, 'Draw time', 30);
	await setSlider(host.page, 'Letter hints', 5);
	// A one-word pool keeps the word deterministic.
	await setWordSource(host.page, 'custom', ['adventure']);
	await startGame(host.page);
	const drawer = await currentDrawer(players);
	const guesser = players.find((p) => p !== drawer);
	if (guesser === undefined) {
		throw new Error('setup failed');
	}
	await drawer.page.locator('.word-choices button').first().click();

	// 5 hints over 30s → reveals land every 5s; the first within ~12s.
	await expect(guesser.page.locator('.timer .num')).toBeVisible();
	await expect(guesser.page.locator('.wordblanks .slot.revealed').first()).toBeVisible({
		timeout: 12_000
	});

	// Nobody guesses; the buzzer ends the turn, revealing the word and zero gains.
	await expect(guesser.page.locator('.reveal-word')).toHaveText('adventure', {
		timeout: 35_000
	});
	await expect(guesser.page.locator('.gains li.dim')).toHaveCount(2);
});
