/**
 * Bun test preload: teaches `bun test` to import Svelte 5 `.svelte.ts` rune modules.
 *
 * Runes (`$state`, `$derived`, …) are compiler macros, so the raw source throws
 * `$state is not defined` under a plain runtime. We strip the TypeScript with Bun's
 * transpiler (the rune calls survive as ordinary calls), then hand the result to
 * Svelte's `compileModule`, which lowers the runes to plain reactive JS.
 *
 * The `onLoad` filter only matches `*.svelte.ts`, so this is inert for the server
 * engine tests that share the same `bun test` run — they never hit it.
 */
import { plugin, type OnLoadArgs, type PluginBuilder, Transpiler } from 'bun';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';

const stripTypes = new Transpiler({ loader: 'ts' });

plugin({
	name: 'svelte-runes',
	// PluginBuilder is Bun's own plugin API surface — a mutable class we only call onLoad on,
	// not a value we mutate. It can't be expressed as a deeply-readonly type.
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see comment above
	setup(build: PluginBuilder) {
		build.onLoad({ filter: /\.svelte\.ts$/u }, (args: Readonly<OnLoadArgs>) => {
			const source = readFileSync(args.path, 'utf8');
			const js = stripTypes.transformSync(source);
			const compiled = compileModule(js, { filename: args.path });
			return { contents: compiled.js.code, loader: 'js' };
		});
	}
});
