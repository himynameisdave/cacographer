import { defineEnvVars } from '@sveltejs/kit/env';

// SvelteKit-managed env, imported via $app/env/public. `static: true` because this is a
// prerender-free SPA built by adapter-static and served as files by the Bun game server —
// there is no SvelteKit runtime to inject a value at request time, so a dynamic var would
// only ever see the build-time value anyway, one extra `/_app/env.js` request later.
// The schema is a plain function rather than a zod schema: the client is deliberately
// zero-dependency (CLAUDE.md), and Kit accepts either.
export const variables = defineEnvVars({
	PUBLIC_GAME_SERVER: {
		public: true,
		static: true,
		description: 'Base URL of the Bun game server. Empty means same origin (production).',
		schema: (value: string | undefined): string => value ?? ''
	}
});
