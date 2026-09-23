#!/usr/bin/env bun
/**
 * Runs `svelte-check` on tsgo (TS 7) and turns its swallowed failures into a non-zero exit.
 *
 * Why this exists: svelte-check's CLI wraps its whole run in a `try/catch` that only
 * `console.error`s the error plus the line `svelte-check failed` — it never sets an exit
 * code, so a thrown error (TS 7 alias missing, broken tsconfig, ...) exits 0 and CI goes
 * green while checking nothing. Verified on svelte-check@4.7.6; master still has it.
 * Remove this wrapper once upstream exits non-zero from that catch.
 *
 * Extra args are passed through (e.g. `bun scripts/check.ts --watch`).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const FAILED = 'svelte-check failed';
const bin = join('node_modules', '.bin', 'svelte-check');
const args = [
	'--tsconfig',
	'./tsconfig.json',
	'--tsgo-experimental-api',
	'--fail-on-warnings',
	...process.argv.slice(2)
];

const run = spawnSync(bin, args, { stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8' });
process.stderr.write(run.stderr);

if (run.stderr.includes(FAILED)) {
	// oxlint-disable-next-line eslint/no-console -- make the swallowed checker failure visible.
	console.error(`\n✗ check: svelte-check threw (see above) — treating as failure.`);
	process.exit(1);
}
process.exit(run.status ?? 1);
