import { expect, test } from '@playwright/test';
import { createRoom } from './helpers';

test('create game lands in a room with a shareable 5-char code', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Create game' }).click();
	await expect(page).toHaveURL(/\/game\/[A-Z0-9]{5}$/u);
	const code = page.url().split('/').pop() ?? '';
	await expect(page.getByText('Joining room')).toBeVisible();
	await expect(page.locator('.code-chip')).toHaveText(code);
});

test('join form uppercases input, strips junk, and gates the button', async ({ page }) => {
	await page.goto('/');
	const input = page.getByLabel('Room code');
	const joinButton = page.getByRole('button', { name: 'Join', exact: true });
	await expect(joinButton).toBeDisabled();
	await input.fill('ab-1!');
	await expect(input).toHaveValue('AB1');
	await expect(joinButton).toBeDisabled();
	await input.fill('abcde');
	await expect(input).toHaveValue('ABCDE');
	await expect(joinButton).toBeEnabled();
});

test('joining an unknown code fails on the home page', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Room code').fill('ZZZZZ');
	await page.getByRole('button', { name: 'Join', exact: true }).click();
	await expect(page.getByText('No game found with that code.')).toBeVisible();
});

test('a dead room link shows the not-found screen with a way home', async ({ page }) => {
	await page.goto('/game/ZZZZZ');
	await page.getByPlaceholder('Your name').fill('Ghost');
	await page.getByRole('button', { name: 'Join game' }).click();
	await expect(page.getByText('That room doesn’t exist (anymore).')).toBeVisible();
	await page.getByRole('link', { name: 'Back home' }).click();
	await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
});

test('the name gate requires a name before joining', async ({ page, request }) => {
	const code = await createRoom(request);
	await page.goto(`/game/${code}`);
	await expect(page.getByRole('button', { name: 'Join game' })).toBeDisabled();
	await page.getByPlaceholder('Your name').fill('Ada');
	await expect(page.getByRole('button', { name: 'Join game' })).toBeEnabled();
});
