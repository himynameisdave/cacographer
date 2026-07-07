import { describe, expect, test } from 'bun:test';
import { levenshtein, normalize } from './text';

describe('normalize', () => {
	test('trims leading/trailing whitespace', () => {
		expect(normalize('  hello  ')).toBe('hello');
	});

	test('lowercases', () => {
		expect(normalize('HeLLo World')).toBe('hello world');
	});

	test('collapses internal whitespace runs to a single space', () => {
		expect(normalize('ice   cream')).toBe('ice cream');
		expect(normalize('a\t b\n\nc')).toBe('a b c');
	});

	test('all together', () => {
		expect(normalize('   Ice \t CREAM  cone ')).toBe('ice cream cone');
	});

	test('empty and whitespace-only strings become empty', () => {
		expect(normalize('')).toBe('');
		expect(normalize('   \t\n ')).toBe('');
	});
});

describe('levenshtein', () => {
	test('0 for equal strings', () => {
		expect(levenshtein('apple', 'apple')).toBe(0);
		expect(levenshtein('', '')).toBe(0);
	});

	test('single insert is 1', () => {
		expect(levenshtein('cat', 'cats')).toBe(1);
		expect(levenshtein('aple', 'apple')).toBe(1);
	});

	test('single delete is 1', () => {
		expect(levenshtein('cats', 'cat')).toBe(1);
		expect(levenshtein('apple', 'aple')).toBe(1);
	});

	test('single substitute is 1', () => {
		expect(levenshtein('cat', 'cut')).toBe(1);
	});

	test('longer distances', () => {
		expect(levenshtein('kitten', 'sitting')).toBe(3);
		expect(levenshtein('flaw', 'lawn')).toBe(2);
		expect(levenshtein('abc', 'xyz')).toBe(3);
	});

	test('empty vs non-empty is the other length', () => {
		expect(levenshtein('', 'abc')).toBe(3);
		expect(levenshtein('abcd', '')).toBe(4);
	});

	test('symmetric', () => {
		expect(levenshtein('sunday', 'saturday')).toBe(levenshtein('saturday', 'sunday'));
	});
});
