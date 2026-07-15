// Pre-commit tasks (see .husky/pre-commit). Lives here rather than in package.json because the
// `server/**` entry has to be a function — see the note on it below.
const tasks = {
	'*.{ts,js,mjs,cjs,svelte}': ['oxfmt --write', 'oxlint --deny-warnings --type-aware'],
	'*.{json,md,yml,yaml,css}': ['oxfmt --write'],
	// `tsc -p` type-checks a whole program and refuses to run at all if it's also handed
	// individual filenames (TS5112), so this ignores lint-staged's file list and checks the
	// server project once. Whole-project, but ~0.5s — unlike `bun run check` (svelte-check),
	// which stays in CI only.
	'server/**/*.ts': () => 'bun run check:server'
};

export default tasks;
