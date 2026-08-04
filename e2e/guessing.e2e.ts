import { expect, test } from './fixtures';
import {
	createRoom,
	drawStroke,
	rosterRow,
	sendChat,
	startDrawingTurn,
	systemChat
} from './helpers';

test('an almost-right guess whispers "So close!" privately', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob', 'Carol');
	const { guessers, word } = await startDrawingTurn(players);
	const [g1, g2] = guessers;
	if (g1 === undefined || g2 === undefined) {
		throw new Error('setup failed');
	}

	// One substituted letter: levenshtein distance 1, and not containing the word.
	const near = `${word.slice(0, -1)}q`;
	await sendChat(g1.page, near);
	await expect(g1.page.getByText('So close!')).toBeVisible();
	// The near-miss itself is public chatter, but the nudge is private.
	await expect(g2.page.locator('.msg', { hasText: near })).toBeVisible();
	await expect(g2.page.getByText('So close!')).not.toBeVisible();
	// Close is not correct.
	await expect(rosterRow(g1.page, `${g1.name}(you)`).locator('.check')).toHaveCount(0);
});

test('a wrong guess containing the answer is quarantined, not broadcast', async ({
	request,
	joinPlayers
}) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob', 'Carol');
	const { drawer, guessers, word } = await startDrawingTurn(players);
	const [g1, g2] = guessers;
	if (g1 === undefined || g2 === undefined) {
		throw new Error('setup failed');
	}

	const spoiler = `${word} maybe`;
	await sendChat(g1.page, spoiler);
	// The drawer sees it in the locked channel; the other guesser never does.
	await expect(drawer.page.locator('.msg.guessed', { hasText: spoiler })).toBeVisible();
	await expect(g2.page.locator('.messages')).not.toContainText(word);
});

test('post-guess chatter stays in the guessed-only channel', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob', 'Carol');
	const { drawer, guessers, word } = await startDrawingTurn(players);
	const [g1, g2] = guessers;
	if (g1 === undefined || g2 === undefined) {
		throw new Error('setup failed');
	}

	await sendChat(g1.page, word);
	await expect(systemChat(g2.page, `${g1.name} guessed the word!`)).toBeVisible();
	await expect(rosterRow(g2.page, g1.name).locator('.check')).toBeVisible();
	// Composer roles flip: the winner chats, the drawer's channel is scoped.
	await expect(g1.page.locator('.composer input')).toHaveAttribute(
		'placeholder',
		'You got it! Chat with the others…'
	);
	await expect(drawer.page.locator('.composer input')).toHaveAttribute(
		'placeholder',
		'Chat (only guessers who got it will see)…'
	);

	await sendChat(g1.page, 'that was easy');
	await expect(drawer.page.locator('.msg.guessed', { hasText: 'that was easy' })).toBeVisible();
	await expect(g2.page.locator('.messages')).not.toContainText('that was easy');

	await sendChat(drawer.page, 'thanks pal');
	await expect(g1.page.locator('.msg.guessed', { hasText: 'thanks pal' })).toBeVisible();
	await expect(g2.page.locator('.messages')).not.toContainText('thanks pal');
});

test('the second-fastest guesser gets jeered', async ({ request, joinPlayers }) => {
	const code = await createRoom(request);
	const players = await joinPlayers(code, 'Alice', 'Bob', 'Carol');
	const { drawer, guessers, word } = await startDrawingTurn(players);
	const [g1, g2] = guessers;
	if (g1 === undefined || g2 === undefined) {
		throw new Error('setup failed');
	}

	// A drawing must exist or the reveal has no vote row to assert on later.
	await drawStroke(drawer.page);

	// Pre-fill both composers, then submit back-to-back — comfortably inside
	// the 1s YOURE_GONNA_HAVE_TO_BE_FASTER_THAN_THAT_MS window.
	await g1.page.locator('.composer input').fill(word);
	await g2.page.locator('.composer input').fill(word);
	await g1.page.locator('.composer input').press('Enter');
	await g2.page.locator('.composer input').press('Enter');

	await expect(g2.page.locator('.faster-flash')).toBeVisible();
	await expect(g1.page.locator('.faster-flash')).not.toBeVisible();

	// Everyone guessed → the turn ends early; both voters like the result.
	await g1.page.locator('.vote-btn', { hasText: '👍' }).click();
	await g2.page.locator('.vote-btn', { hasText: '👍' }).click();
	await expect(drawer.page.locator('.vote-pill', { hasText: '👍 2' })).toBeVisible();
});
