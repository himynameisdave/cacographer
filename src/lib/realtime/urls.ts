/**
 * Where the game server lives. In dev, Vite serves the app and the Bun game
 * server runs elsewhere (PUBLIC_GAME_SERVER); in production the game server
 * serves the static build itself, so we fall back to the page's own origin.
 */
export function serverBase(): string {
	const env = (import.meta.env.PUBLIC_GAME_SERVER as string | undefined) ?? '';
	const base = env.trim() || location.origin;
	return base.replace(/\/+$/u, '');
}

export function wsUrl(): string {
	return `${serverBase().replace(/^http/u, 'ws')}/ws`;
}
