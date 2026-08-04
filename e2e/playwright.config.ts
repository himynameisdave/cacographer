import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? '3100');

// Headful local runs get a default slow-mo so a human can actually watch the
// game play out; SLOWMO=<ms> (or SLOWMO=0) overrides in either direction.
const headed = process.argv.includes('--headed');
const envSlowMo = process.env.SLOWMO;
const slowMo = envSlowMo === undefined ? (headed ? 200 : 0) : Number(envSlowMo);

export default defineConfig({
	testDir: '.',
	testMatch: '**/*.e2e.ts',
	outputDir: 'test-results',
	fullyParallel: true,
	forbidOnly: process.env.CI !== undefined,
	retries: process.env.CI === undefined ? 0 : 2,
	reporter: process.env.CI === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
	timeout: 60_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure',
		launchOptions: { slowMo }
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		// Production shape: one Bun process serving the static build plus the WebSocket,
		// same origin — exactly what Railway runs.
		command: `bun run build && NODE_ENV=production PORT=${PORT} bun server/index.ts`,
		url: `http://localhost:${PORT}/api/health`,
		cwd: path.join(import.meta.dirname, '..'),
		reuseExistingServer: process.env.CI === undefined,
		timeout: 120_000
	}
});
