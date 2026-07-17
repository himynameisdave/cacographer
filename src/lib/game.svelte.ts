import {
	type ChatEntry,
	type ClientPlayer,
	type ClientRoom,
	type DrawOp,
	type ErrorCode,
	type PlayerId,
	type ServerMessage,
	type VoteKind
} from '$lib/protocol';
import { type SocketStatus } from '$lib/realtime/client';

const CHAT_CAP = 200;
const CLOSE_FLASH_MS = 2500;

/** Errors that mean the join itself failed (server closes the socket after). */
const JOIN_ERRORS: ReadonlySet<ErrorCode> = new Set(['room_not_found', 'room_full', 'name_taken']);

/**
 * `protocol.ts`'s wire types are deeply `readonly` (they're immutable snapshots once sent).
 * `GameState.room` is a live local mirror that this class patches incrementally in place —
 * that needs its own mutable shape, converted once at the wire boundary.
 */
type Mutable<T> = T extends readonly [infer A, infer B]
	? [Mutable<A>, Mutable<B>]
	: T extends readonly (infer U)[]
		? Mutable<U>[]
		: T extends object
			? { -readonly [K in keyof T]: Mutable<T[K]> }
			: T;

/** Every wire payload is freshly deserialized per message with no other holder of the
 * reference, so treating it as an exclusively-owned mutable copy is safe. */
function toMutable<T>(value: T): Mutable<T> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
	return value as Mutable<T>;
}

/** Without `noUncheckedIndexedAccess`, `Record` access types as always-present; a player
 * who joined mid-round is genuinely absent from an earlier turn's `totals`. The explicit
 * `| undefined` return type (rather than relying on the plain index access) is what makes
 * the presence check at call sites meaningful to the type checker. */
function scoreFor(totals: Readonly<Record<PlayerId, number>>, id: PlayerId): number | undefined {
	return totals[id];
}

/** How a player presents in chat: their self-drawn avatar and picked name color. */
export type PlayerIdentity = {
	avatar: string | null;
	color: string | null;
};

/**
 * Client-side mirror of the room, maintained incrementally from server
 * messages. `roomState` broadcasts are the resync source of truth — every
 * phase change carries one, so incremental patches only need to be
 * "good enough until the next snapshot".
 */
export class GameState {
	you = $state<PlayerId | null>(null);
	room = $state<Mutable<ClientRoom> | null>(null);
	chat = $state<ChatEntry[]>([]);
	/** Word choices — only ever populated at the drawer, during 'choosing'. */
	choices = $state<{ words: readonly string[]; endsAt: number } | null>(null);
	/** The secret word — only ever populated at the drawer, during 'drawing'. */
	word = $state<string | null>(null);
	/** Live like/dislike tally for the drawing being revealed. */
	voteCounts = $state<{ likes: number; dislikes: number }>({ likes: 0, dislikes: 0 });
	/** My vote on the drawing being revealed — local echo only, the server is authoritative. */
	myVote = $state<VoteKind | null>(null);
	/** Last-seen profile per player id — never pruned, so chat history keeps its
	 * avatars and name colors after a player leaves the roster. */
	identities = $state<Record<PlayerId, PlayerIdentity>>({});
	/** Briefly true after an almost-correct guess ("So close!"). */
	closeFlash = $state(false);
	status = $state<SocketStatus>('closed');
	fatalError = $state<{ code: ErrorCode; message: string } | null>(null);

	private closeFlashTimer: ReturnType<typeof setTimeout> | null = null;

	get me(): ClientPlayer | null {
		return this.room?.players.find((p) => p.id === this.you) ?? null;
	}

	get isHost(): boolean {
		return this.me?.isHost ?? false;
	}

	get isDrawer(): boolean {
		return this.you !== null && this.room?.drawerId === this.you;
	}

	get drawer(): ClientPlayer | null {
		const { room } = this;
		if (!room || room.drawerId === null) {
			return null;
		}
		return room.players.find((p) => p.id === room.drawerId) ?? null;
	}

	get playersByScore(): ClientPlayer[] {
		return this.room ? [...this.room.players].toSorted((a, b) => b.score - a.score) : [];
	}

	apply(msg: ServerMessage): void {
		switch (msg.type) {
			case 'joined': {
				this.you = msg.you;
				this.room = toMutable(msg.room);
				this.rememberIdentities(msg.room.players);
				this.fatalError = null;
				// If we're the drawer and we dropped, the server ended our turn —
				// stale secrets from a previous connection can't apply anymore.
				this.choices = null;
				this.word = null;
				break;
			}

			case 'roomState': {
				this.room = toMutable(msg.room);
				this.rememberIdentities(msg.room.players);
				if (msg.room.phase !== 'choosing') {
					this.choices = null;
				}
				if (msg.room.phase !== 'drawing') {
					this.word = null;
				}
				break;
			}

			case 'playerJoined': {
				this.rememberIdentities([msg.player]);
				const { room } = this;
				if (!room) {
					break;
				}
				const i = room.players.findIndex((p) => p.id === msg.player.id);
				if (i === -1) {
					room.players.push(msg.player);
				} else {
					room.players[i] = msg.player;
				}
				break;
			}

			case 'playerLeft': {
				if (this.room) {
					this.room.players = this.room.players.filter((p) => p.id !== msg.id);
				}
				break;
			}

			case 'playerConnection': {
				const player = this.room?.players.find((p) => p.id === msg.id);
				if (player) {
					player.connected = msg.connected;
				}
				break;
			}

			case 'hostChanged': {
				if (this.room) {
					for (const p of this.room.players) {
						p.isHost = p.id === msg.hostId;
					}
				}
				break;
			}

			case 'turnStarted': {
				const { room } = this;
				if (!room) {
					break;
				}
				room.phase = 'choosing';
				room.drawerId = msg.drawerId;
				room.round = msg.round;
				room.turnIndex = msg.turnIndex;
				room.endsAt = msg.endsAt;
				room.ops = [];
				room.masked = null;
				room.lastWord = null;
				room.lastGains = null;
				for (const p of room.players) {
					p.guessedThisTurn = false;
				}
				this.choices = null;
				this.word = null;
				this.voteCounts = { likes: 0, dislikes: 0 };
				this.myVote = null;
				break;
			}

			case 'wordChoices': {
				this.choices = { words: msg.choices, endsAt: msg.endsAt };
				break;
			}

			case 'drawingStarted': {
				const { room } = this;
				if (!room) {
					break;
				}
				room.phase = 'drawing';
				room.masked = msg.masked;
				room.endsAt = msg.endsAt;
				this.choices = null;
				break;
			}

			case 'yourWord': {
				this.word = msg.word;
				break;
			}

			case 'draw': {
				this.applyDraw(msg.op);
				break;
			}

			case 'clearCanvas': {
				if (this.room) {
					this.room.ops = [];
				}
				break;
			}

			case 'canvasState': {
				if (this.room) {
					this.room.ops = toMutable(msg.ops);
				}
				break;
			}

			case 'letterRevealed': {
				if (this.room) {
					this.room.masked = msg.masked;
				}
				break;
			}

			case 'guessResult': {
				if (!msg.correct && msg.close === true) {
					this.closeFlash = true;
					if (this.closeFlashTimer !== null) {
						clearTimeout(this.closeFlashTimer);
					}
					this.closeFlashTimer = setTimeout(() => {
						this.closeFlash = false;
						this.closeFlashTimer = null;
					}, CLOSE_FLASH_MS);
				}
				break;
			}

			case 'playerGuessed': {
				const player = this.room?.players.find((p) => p.id === msg.id);
				if (player) {
					player.guessedThisTurn = true;
				}
				break;
			}

			case 'chat': {
				this.chat.push(msg.entry);
				if (this.chat.length > CHAT_CAP) {
					this.chat.splice(0, this.chat.length - CHAT_CAP);
				}
				break;
			}

			case 'timeSync': {
				if (this.room) {
					this.room.endsAt = msg.endsAt;
				}
				break;
			}

			case 'voteUpdate': {
				this.voteCounts = { likes: msg.likes, dislikes: msg.dislikes };
				break;
			}

			case 'turnEnded': {
				const { room } = this;
				if (!room) {
					break;
				}
				this.voteCounts = { likes: 0, dislikes: 0 };
				this.myVote = null;
				room.phase = 'reveal';
				room.lastWord = msg.word;
				room.lastGains = msg.gains;
				room.endsAt = msg.endsAt;
				for (const p of room.players) {
					const total = scoreFor(msg.totals, p.id);
					if (total !== undefined) {
						p.score = total;
					}
				}
				this.choices = null;
				this.word = null;
				break;
			}

			case 'gameEnded': {
				const { room } = this;
				if (!room) {
					break;
				}
				room.phase = 'finished';
				room.winnerId = msg.winnerId;
				room.endsAt = null;
				for (const p of room.players) {
					const total = scoreFor(msg.totals, p.id);
					if (total !== undefined) {
						p.score = total;
					}
				}
				this.choices = null;
				this.word = null;
				break;
			}

			case 'error': {
				if (JOIN_ERRORS.has(msg.code)) {
					this.fatalError = { code: msg.code, message: msg.message };
				} else {
					// Non-fatal rejection (rate limit etc.) — surface it in chat.
					this.chat.push({ id: null, name: '', text: msg.message, scope: 'system' });
				}
				break;
			}
		}
	}

	private rememberIdentities(players: readonly ClientPlayer[]): void {
		for (const p of players) {
			this.identities[p.id] = { avatar: p.avatar, color: p.nameColor };
		}
	}

	/**
	 * Append-or-merge a draw op into room.ops. Used both for incoming server
	 * `draw` messages and for the drawer's own outgoing ops (the server does
	 * not echo draw ops back to their author).
	 */
	applyDraw(op: DrawOp): void {
		const { room } = this;
		if (!room) {
			return;
		}
		const last = room.ops.at(-1);
		if (op.kind === 'stroke' && last?.kind === 'stroke' && last.id === op.id) {
			last.points.push(...op.points.map((p): [number, number] => [p[0], p[1]]));
		} else {
			room.ops.push(toMutable(op));
		}
	}
}
