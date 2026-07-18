import { describe, expect, test } from 'bun:test';
import { POTTY_PHRASES, hasProfanity, pottyPhrase } from './moderation';

describe('hasProfanity', () => {
	test('flags a swear anywhere in the message, whatever the case or punctuation', () => {
		expect(hasProfanity('shit', null)).toBe(true);
		expect(hasProfanity('well SHIT.', null)).toBe(true);
		expect(hasProfanity('what the fuck?!', null)).toBe(true);
		expect(hasProfanity('that drawing is bullshit', null)).toBe(true);
	});

	test('clean messages pass', () => {
		expect(hasProfanity('what a nice duck', null)).toBe(false);
		expect(hasProfanity('', null)).toBe(false);
	});

	test('only whole words match — no substring false positives', () => {
		expect(hasProfanity('peacock', null)).toBe(false); // contains 'cock'
		expect(hasProfanity('a classic grape', null)).toBe(false); // 'ass'
		expect(hasProfanity('nice title', null)).toBe(false); // 'tit'
	});

	test('tokens of the exempt word are fair game; other swears still trip', () => {
		expect(hasProfanity('shit', 'shit')).toBe(false);
		expect(hasProfanity('shit show', 'shit show')).toBe(false);
		expect(hasProfanity('shit', 'shit show')).toBe(false);
		expect(hasProfanity('fucking shit', 'shit')).toBe(true);
		expect(hasProfanity('shit', 'duck')).toBe(true);
	});
});

describe('pottyPhrase', () => {
	test('picks from POTTY_PHRASES by the injected rng', () => {
		expect(pottyPhrase(() => 0)).toBe(POTTY_PHRASES[0]!);
		expect(pottyPhrase(() => 0.999)).toBe(POTTY_PHRASES.at(-1)!);
		for (const r of [0.1, 0.4, 0.7]) {
			expect(POTTY_PHRASES).toContain(pottyPhrase(() => r));
		}
	});
});
