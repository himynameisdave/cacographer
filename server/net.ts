/**
 * Pure helpers for the network trust boundary in index.ts: token-bucket rate limiting,
 * runtime validation of untrusted wire JSON, and path-traversal-safe static resolution.
 * Kept here — separate from the Bun.serve wiring — so each can be unit tested directly
 * without standing up a server. Time is passed in (never read from Date.now here) so the
 * refill math is deterministic under test, the same reason the engine injects its clock.
 */
import path from 'node:path';
import { type ClientMessage } from '../src/lib/protocol';

// ---------------------------------------------------------------------------
// Rate limiting — token buckets refilled by elapsed time
// ---------------------------------------------------------------------------

export type Bucket = {
	tokens: number;
	last: number;
};

/**
 * Refill `bucket` for the time elapsed since `now` was last seen, then try to spend one token.
 * Pure: returns whether a token was available (`allowed`) alongside the next bucket state the
 * caller should store — the input is never mutated. `now` is a millisecond timestamp supplied
 * by the caller.
 */
export function take(
	bucket: Readonly<Bucket>,
	ratePerSec: number,
	burst: number,
	now: number
): { allowed: boolean; bucket: Bucket } {
	const refilled = Math.min(burst, bucket.tokens + ((now - bucket.last) / 1000) * ratePerSec);
	if (refilled >= 1) {
		return { allowed: true, bucket: { tokens: refilled - 1, last: now } };
	}
	return { allowed: false, bucket: { tokens: refilled, last: now } };
}

// ---------------------------------------------------------------------------
// Wire validation
// ---------------------------------------------------------------------------

/**
 * The wire trust boundary: freshly-parsed JSON is `unknown`, and all we can establish here is
 * that it's an object carrying a string `type`. `Room.handleMessage` switches exhaustively on
 * that discriminant and each branch validates its own payload, so anything malformed past this
 * point is rejected there rather than trusted.
 */
export function isClientMessage(value: unknown): value is ClientMessage {
	return (
		typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
	);
}

// ---------------------------------------------------------------------------
// Static file resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a request pathname to an absolute path inside `buildDir`, guarding against path
 * traversal: anything that escapes the build directory (`../`, absolute paths, malformed
 * percent-encoding) collapses to `buildDir/index.html` — the SPA fallback. The result is
 * always `buildDir` itself or a descendant of it; it says nothing about whether the file
 * exists (the caller stat()s it and falls back again if it's a directory or missing).
 */
export function safeStaticPath(buildDir: string, pathname: string): string {
	const indexHtml = path.join(buildDir, 'index.html');

	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return indexHtml;
	}

	const filePath = path.normalize(path.join(buildDir, decoded));
	if (filePath !== buildDir && !filePath.startsWith(buildDir + path.sep)) {
		return indexHtml;
	}
	return filePath;
}
