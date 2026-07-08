/**
 * End-of-game drawing gallery: per-turn drawing snapshots plus like/dislike
 * tallies. Pure functions — the Room owns the state and calls in here.
 */
import {
	type DrawOp,
	type Gallery,
	type GalleryEntry,
	type PlayerId,
	type VoteKind
} from '../../src/lib/protocol';

/** A finished turn's drawing, held in Room memory until the game ends. */
export type StoredDrawing = {
	readonly drawerId: PlayerId;
	readonly drawerName: string; // snapshotted — the drawer may leave before game end
	readonly word: string;
	readonly ops: readonly DrawOp[];
	readonly votes: ReadonlyMap<PlayerId, VoteKind>;
};

/** Tally a drawing's vote map into like/dislike counts. */
export function countVotes(votes: ReadonlyMap<PlayerId, VoteKind>): {
	likes: number;
	dislikes: number;
} {
	let likes = 0;
	let dislikes = 0;
	for (const v of votes.values()) {
		if (v === 'like') {
			likes++;
		} else {
			dislikes++;
		}
	}
	return { likes, dislikes };
}

function toEntry(d: StoredDrawing): GalleryEntry {
	return {
		drawerId: d.drawerId,
		drawerName: d.drawerName,
		word: d.word,
		ops: d.ops,
		...countVotes(d.votes)
	};
}

/**
 * Pick the most liked and most disliked drawings. `best` needs at least one
 * like; `worst` needs at least one dislike and is chosen among the remaining
 * drawings so the same one is never shown twice. Ties break toward fewer
 * opposite votes, then toward the earlier turn (input is chronological).
 */
export function buildGallery(drawings: readonly StoredDrawing[]): Gallery {
	const tallied = drawings.map((d) => ({ d, ...countVotes(d.votes) }));

	let best: (typeof tallied)[number] | null = null;
	for (const t of tallied) {
		if (t.likes === 0) {
			continue;
		}
		if (!best || t.likes > best.likes || (t.likes === best.likes && t.dislikes < best.dislikes)) {
			best = t;
		}
	}

	let worst: (typeof tallied)[number] | null = null;
	for (const t of tallied) {
		if (t.dislikes === 0 || t === best) {
			continue;
		}
		if (
			!worst ||
			t.dislikes > worst.dislikes ||
			(t.dislikes === worst.dislikes && t.likes < worst.likes)
		) {
			worst = t;
		}
	}

	return {
		best: best ? toEntry(best.d) : null,
		worst: worst ? toEntry(worst.d) : null
	};
}
