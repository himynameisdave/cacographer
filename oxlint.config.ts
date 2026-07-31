import { defineConfig } from 'oxlint';
import base from '@himynameisdave/oxlint-config/base';
import svelte from '@himynameisdave/oxlint-config/svelte';
import typeAware from '@himynameisdave/oxlint-config/type-aware';

// The shared config's `vitest` add-on is deliberately not extended: this repo's suites are
// `bun:test`, which oxlint cannot recognize as test syntax, so none of those rules would fire.
export default defineConfig({
	extends: [base, svelte, typeAware],
	overrides: [
		{
			// The transport boundary: `Socket` (Bun's `ServerWebSocket<SocketData>`) and `Buffer` are
			// classes with inherently mutable members, so no wrapper makes them deeply readonly and
			// every handler here has to take one. Overriding a rule replaces its options wholesale, so
			// the shared config's platform exemptions are restated alongside these two.
			files: ['server/index.ts'],
			rules: {
				'typescript/prefer-readonly-parameter-types': [
					'error',
					{
						ignoreInferredTypes: true,
						allow: [
							{ from: 'lib', name: 'Date' },
							{ from: 'lib', name: 'URL' },
							{ from: 'lib', name: 'URLSearchParams' },
							{ from: 'lib', name: 'FormData' },
							{ from: 'lib', name: 'Request' },
							{ from: 'lib', name: 'Response' },
							{ from: 'lib', name: 'Headers' },
							{ from: 'lib', name: 'RegExp' },
							'Socket',
							{ from: 'package', package: '@types/node', name: 'Buffer' }
						]
					}
				]
			}
		}
	]
});
