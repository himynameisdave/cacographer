import { describe, expect, test } from 'bun:test';
import { notesFor } from '$lib/sound';

const ME = 'p1';

describe('notesFor', () => {
	test('correct guesses ring, wrong-but-not-close ones stay silent', () => {
		expect(notesFor({ type: 'guessResult', correct: true }, ME).length).toBe(3);
		expect(notesFor({ type: 'guessResult', correct: false, close: true }, ME).length).toBe(1);
		expect(notesFor({ type: 'guessResult', correct: false, close: false }, ME)).toEqual([]);
	});

	test('my own guess does not double up with the broadcast blip', () => {
		expect(notesFor({ type: 'playerGuessed', id: ME }, ME)).toEqual([]);
		expect(notesFor({ type: 'playerGuessed', id: 'p2' }, ME).length).toBe(1);
	});

	test('chatter is silent', () => {
		expect(
			notesFor({ type: 'chat', entry: { id: null, name: '', text: 'hi', scope: 'system' } }, ME)
		).toEqual([]);
	});
});
