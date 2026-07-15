import { PUBLIC_GAME_SERVER } from '$env/static/public';

/**
 * Where the game server lives. In dev, Vite serves the app and the Bun game
 * server runs elsewhere (PUBLIC_GAME_SERVER); in production the game server
 * serves the static build itself, so we fall back to the page's own origin.
 */
export function serverBase(): string {
	// Must come from $env/static/public, not import.meta.env: Vite only exposes
	// VITE_-prefixed vars there, so a PUBLIC_ read silently yields undefined.
	const base = PUBLIC_GAME_SERVER.trim() || location.origin;
	return base.replace(/\/+$/u, '');
}

export function wsUrl(): string {
	return `${serverBase().replace(/^http/u, 'ws')}/ws`;
}
