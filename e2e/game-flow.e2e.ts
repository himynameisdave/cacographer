import { expect, test } from './fixtures';
import {
	chooseFirstWord,
	createRoom,
	currentDrawer,
	drawStroke,
	drawerWord,
	inkCount,
	rosterRow,
	sendChat,
	setSlider,
	setWordSource,
	startGame,
	systemChat,
	WORDS,
	type Player
} from './helpers';

/**
 * The issue-52 smoke test: two players play a complete game in real browsers —
 * lobby → choose → draw → guess → reveal → rotate → final scoreboard → gallery
 * → play again. One round means both players draw once; a correct guess ends a
 * turn immediately, so the whole game takes well under a minute.
 */
test('two players play a full game end to end', async ({ request, joinPlayers }) => {
	test.setTimeout(120_000);
	const code = await createRoom(request);
	const [alice, bob] = await joinPlayers(code, 'Alice', 'Bob');
	if (!alice || !bob) {
		throw new Error('setup failed');
	}
	const players: readonly Player[] = [alice, bob];

	await setSlider(alice.page, 'Rounds', 1);
	await setWordSource(alice.page, 'custom', WORDS);
	await startGame(alice.page);

	// --- Turn 1: choosing ---
	const drawer1 = await currentDrawer(players);
	const guesser1 = drawer1 === alice ? bob : alice;
	await expect(drawer1.page.getByRole('heading', { name: 'Pick a word' })).toBeVisible();
	await expect(
		guesser1.page.getByRole('heading', { name: `${drawer1.name} is choosing a word…` })
	).toBeVisible();
	await expect(alice.page.getByText('Round 1/1')).toBeVisible();

	// Choices come from the custom list and never reach the guesser.
	const choices = await drawer1.page.locator('.word-choices button').allInnerTexts();
	expect(choices).toHaveLength(3);
	const guesserBody = (await guesser1.page.locator('body').textContent()) ?? '';
	for (const choice of choices) {
		expect(WORDS).toContain(choice.trim());
		expect(guesserBody).not.toContain(choice.trim());
	}

	// --- Turn 1: drawing ---
	const word1 = await chooseFirstWord(drawer1.page);
	await expect(drawer1.page.locator('.wordblanks .label')).toHaveText('draw:');
	expect(await drawerWord(drawer1.page)).toBe(word1);
	// The guesser sees one blank per letter, none revealed, and never the word.
	await expect(guesser1.page.locator('.wordblanks .slot')).toHaveCount(word1.length);
	await expect(guesser1.page.locator('.wordblanks .slot.revealed')).toHaveCount(0);
	await expect(guesser1.page.locator('body')).not.toContainText(word1);

	// Strokes reach the guesser's canvas live.
	await drawStroke(drawer1.page);
	await expect.poll(async () => inkCount(guesser1.page)).toBeGreaterThan(50);

	// A wrong guess is public chatter.
	await sendChat(guesser1.page, 'not the word');
	await expect(drawer1.page.locator('.msg', { hasText: 'not the word' })).toBeVisible();

	// The correct guess — case-insensitive — is announced but never echoed.
	await sendChat(guesser1.page, word1.toUpperCase());
	await expect(systemChat(guesser1.page, `${guesser1.name} guessed the word!`)).toBeVisible();
	await expect(drawer1.page.locator('.messages')).not.toContainText(word1.toUpperCase());
	await expect(rosterRow(guesser1.page, `${guesser1.name}(you)`).locator('.check')).toBeVisible();

	// --- Turn 1: reveal (the only guesser got it, so the turn ends early) ---
	await expect(guesser1.page.locator('.reveal-word')).toHaveText(word1);
	const gains = guesser1.page.locator('.gains li');
	await expect(gains).toHaveCount(2);
	await expect(gains.filter({ hasText: '+0' })).toHaveCount(0);
	// The guesser likes what they see; the drawer watches the tally live.
	await guesser1.page.locator('.vote-btn', { hasText: '👍' }).click();
	await expect(drawer1.page.locator('.vote-pill', { hasText: '👍 1' })).toBeVisible();

	// --- Turn 2: roles rotate ---
	const drawer2 = await currentDrawer(players);
	expect(drawer2.name).not.toBe(drawer1.name);
	const guesser2 = drawer2 === alice ? bob : alice;
	// Scores from turn 1 already show in the roster.
	await expect(rosterRow(guesser2.page, drawer1.name).locator('.score')).not.toHaveText('0 pts');

	const word2 = await chooseFirstWord(drawer2.page);
	await drawStroke(drawer2.page);
	await sendChat(guesser2.page, word2);
	// Thumb down turn 2's drawing so the gallery has a "worst" too.
	await guesser2.page.locator('.vote-btn', { hasText: '👎' }).click();

	// --- Game over ---
	await expect(alice.page.getByRole('heading', { name: '🎉 Game over!' })).toBeVisible({
		timeout: 15_000
	});
	await expect(bob.page.getByRole('heading', { name: '🎉 Game over!' })).toBeVisible();
	await expect(alice.page.locator('.final li')).toHaveCount(2);
	await expect(alice.page.locator('.final li.winner .medal')).toHaveText('👑');
	const finalScores = await alice.page.locator('.final .f-score').allInnerTexts();
	expect(finalScores).toHaveLength(2);
	for (const score of finalScores) {
		expect(Number(score)).toBeGreaterThan(0);
	}
	// The voted drawings made the gallery.
	await expect(alice.page.getByText('Most liked')).toBeVisible();
	await expect(alice.page.getByText('Most disliked')).toBeVisible();

	// --- Play again (host-only) returns everyone to the lobby, scores wiped ---
	await expect(bob.page.getByText('Waiting for Alice to start another game…')).toBeVisible();
	await expect(bob.page.getByRole('button', { name: 'Play again' })).toHaveCount(0);
	await alice.page.getByRole('button', { name: 'Play again' }).click();
	await expect(alice.page.getByText('Room code')).toBeVisible();
	await expect(bob.page.getByText('Room code')).toBeVisible();
	// Scores stay on the lobby scoreboard after play-again by design; they reset
	// on the next startGame (unit-tested in room.test.ts).
	// Settings survived the reset.
	await expect(
		alice.page.locator('.settings label', { hasText: 'Rounds' }).locator('.val')
	).toHaveText('1');
});
