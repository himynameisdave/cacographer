import { describe, expect, test } from 'bun:test';
import { POTTY_PHRASES, hasProfanity, pottyPhrase } from './moderation';

describe('hasProfanity', () => {
	test('flags a hard swear anywhere in the message, whatever the case or punctuation', () => {
		expect(hasProfanity('fuck', null)).toBe(true);
		expect(hasProfanity('well FUCK.', null)).toBe(true);
		expect(hasProfanity('what the fuck?!', null)).toBe(true);
		expect(hasProfanity('you absolute wanker', null)).toBe(true);
	});

	test('clean messages pass', () => {
		expect(hasProfanity('what a nice duck', null)).toBe(false);
		expect(hasProfanity('', null)).toBe(false);
	});

	test('mild everyday swearing passes — the filter is for the strong stuff', () => {
		expect(hasProfanity('shit', null)).toBe(false);
		expect(hasProfanity('that drawing is bullshit', null)).toBe(false);
		expect(hasProfanity('my ass', null)).toBe(false);
		expect(hasProfanity('goddammit', null)).toBe(false);
		expect(hasProfanity('I am so pissed', null)).toBe(false);
	});

	test('only whole words match — no substring false positives', () => {
		expect(hasProfanity('peacock', null)).toBe(false); // contains 'cock'
		expect(hasProfanity('scunthorpe', null)).toBe(false); // 'cunt'
		expect(hasProfanity('charles dickens', null)).toBe(false); // 'dick'
	});

	test('tokens of the exempt word are fair game; other swears still trip', () => {
		expect(hasProfanity('fuck', 'fuck')).toBe(false);
		expect(hasProfanity('cluster fuck', 'cluster fuck')).toBe(false);
		expect(hasProfanity('fuck', 'cluster fuck')).toBe(false);
		expect(hasProfanity('fucking fuck', 'fuck')).toBe(true);
		expect(hasProfanity('fuck', 'duck')).toBe(true);
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
