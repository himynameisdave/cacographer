/**
 * The network trust boundary (index.ts) delegates its pure logic to net.ts so it can be
 * tested without standing up Bun.serve. take() gets an injected `now` so refill is exact.
 */
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { type Bucket, isClientMessage, safeStaticPath, take } from './net';

describe('take (token bucket)', () => {
	test('spends down to empty, then blocks — no refill at a fixed instant', () => {
		const bucket: Bucket = { tokens: 3, last: 0 };
		expect(take(bucket, 1, 3, 0)).toBe(true);
		expect(take(bucket, 1, 3, 0)).toBe(true);
		expect(take(bucket, 1, 3, 0)).toBe(true);
		expect(take(bucket, 1, 3, 0)).toBe(false); // drained
	});

	test('refills by elapsed time at the configured rate', () => {
		const bucket: Bucket = { tokens: 0, last: 0 };
		// 1s at 5 tokens/s → 5 available; one is spent, leaving ~4.
		expect(take(bucket, 5, 10, 1000)).toBe(true);
		expect(bucket.tokens).toBeCloseTo(4, 6);
		expect(bucket.last).toBe(1000);
	});

	test('refill is capped at burst regardless of how long has passed', () => {
		const bucket: Bucket = { tokens: 0, last: 0 };
		// 100s at 5/s would be 500, but burst caps it at 10; one spent → 9.
		expect(take(bucket, 5, 10, 100_000)).toBe(true);
		expect(bucket.tokens).toBeCloseTo(9, 6);
	});

	test('a fractional token below 1 does not allow the action', () => {
		const bucket: Bucket = { tokens: 0, last: 0 };
		// 0.5s at 1/s → 0.5 tokens, not enough to spend.
		expect(take(bucket, 1, 10, 500)).toBe(false);
		expect(bucket.tokens).toBeCloseTo(0.5, 6);
		expect(bucket.last).toBe(500); // clock still advances even when blocked
	});
});

describe('isClientMessage', () => {
	test('accepts an object with a string type', () => {
		expect(isClientMessage({ type: 'join', code: 'ABCDE', name: 'Al' })).toBe(true);
		expect(isClientMessage({ type: 'draw' })).toBe(true);
	});

	test('rejects non-objects and null', () => {
		const missing: unknown = undefined;
		expect(isClientMessage(null)).toBe(false);
		expect(isClientMessage(missing)).toBe(false);
		expect(isClientMessage('join')).toBe(false);
		expect(isClientMessage(42)).toBe(false);
	});

	test('rejects objects missing a string type discriminant', () => {
		expect(isClientMessage({})).toBe(false);
		expect(isClientMessage({ code: 'ABCDE' })).toBe(false);
		expect(isClientMessage({ type: 7 })).toBe(false);
		expect(isClientMessage([])).toBe(false);
	});
});

describe('safeStaticPath', () => {
	const build = path.join('/srv', 'build');
	const indexHtml = path.join(build, 'index.html');

	test('resolves an ordinary asset inside the build dir', () => {
		expect(safeStaticPath(build, '/app.js')).toBe(path.join(build, 'app.js'));
		expect(safeStaticPath(build, '/_app/immutable/chunk.js')).toBe(
			path.join(build, '_app/immutable/chunk.js')
		);
	});

	test('collapses ../ traversal to the SPA fallback', () => {
		expect(safeStaticPath(build, '/../secret')).toBe(indexHtml);
		expect(safeStaticPath(build, '/../../etc/passwd')).toBe(indexHtml);
	});

	test('collapses percent-encoded traversal', () => {
		expect(safeStaticPath(build, '/..%2F..%2Fetc/passwd')).toBe(indexHtml);
	});

	test('rejects a sibling directory that merely shares the build-dir prefix', () => {
		// /srv/build vs /srv/build-secret — the `+ path.sep` guard is what stops this.
		expect(safeStaticPath(build, '/../build-secret/x')).toBe(indexHtml);
	});

	test('malformed percent-encoding falls back rather than throwing', () => {
		expect(safeStaticPath(build, '/%ZZ')).toBe(indexHtml);
	});
});
