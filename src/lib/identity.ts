/**
 * Player-identity presentation helpers shared by the chat and the player list.
 */
import { type PlayerId } from '$lib/protocol';

/** The player's picked name color, or a stable pastel derived from their id. */
export function playerColor(id: PlayerId, picked: string | null): string {
	if (picked !== null) {
		return picked;
	}
	let h = 0;
	for (let i = 0; i < id.length; i++) {
		h = (h * 31 + (id.codePointAt(i) ?? 0)) % 4_294_967_296;
	}
	return `hsl(${h % 360}, 65%, 72%)`;
}
