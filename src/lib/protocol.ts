/**
 * Shared client ⇄ server message protocol.
 * Imported by BOTH the SvelteKit client and the Bun game server — keep dependency-free.
 */

export type PlayerId = string;

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'finished';

export type Settings = {
	readonly rounds: number; // 1–10
	readonly drawTimeSeconds: number; // 30–180
	readonly wordChoiceCount: number; // 2–5
	readonly hintCount: number; // 0+ (capped per-word at length − 1)
	readonly maxPlayers: number; // 2–12
	readonly wordSource: 'builtin' | 'custom' | 'both';
	readonly customWords: readonly string[];
};

export const DEFAULT_SETTINGS: Settings = {
	rounds: 3,
	drawTimeSeconds: 80,
	wordChoiceCount: 3,
	hintCount: 2,
	maxPlayers: 12,
	wordSource: 'builtin',
	customWords: []
};

/** Fixed logical canvas size. All clients render at this resolution and scale via CSS,
 * so flood fills and stroke joins replay identically everywhere. */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 450;

export type DrawOp =
	| {
			readonly kind: 'stroke';
			readonly id: string;
			readonly points: readonly (readonly [number, number])[];
			readonly color: string;
			readonly size: number;
	  }
	| {
			readonly kind: 'fill';
			readonly id: string;
			readonly x: number;
			readonly y: number;
			readonly color: string;
	  };

export type VoteKind = 'like' | 'dislike';

/** A finished turn's drawing, kept in memory only — it dies with the room. */
export type GalleryEntry = {
	readonly drawerId: PlayerId;
	readonly drawerName: string; // snapshotted — the drawer may have left by game end
	readonly word: string;
	readonly ops: readonly DrawOp[];
	readonly likes: number;
	readonly dislikes: number;
};

/** The finished game's standout drawings, picked by like/dislike votes. */
export type Gallery = {
	readonly best: GalleryEntry | null; // most liked (needs ≥1 like)
	readonly worst: GalleryEntry | null; // most disliked among the rest (needs ≥1 dislike)
};

export type ClientPlayer = {
	readonly id: PlayerId;
	readonly name: string;
	readonly score: number;
	readonly isHost: boolean;
	readonly connected: boolean;
	readonly guessedThisTurn: boolean;
};

/** Recipient-safe projection of a Room. Never contains the secret word or the
 * drawer's choices — those travel only via `yourWord` / `wordChoices`. */
export type ClientRoom = {
	readonly code: string;
	readonly phase: Phase;
	readonly players: readonly ClientPlayer[];
	readonly settings: Settings;
	readonly round: number;
	readonly turnOrder: readonly PlayerId[];
	readonly turnIndex: number;
	readonly drawerId: PlayerId | null;
	readonly masked: string | null;
	readonly endsAt: number | null;
	readonly ops: readonly DrawOp[];
	readonly lastWord: string | null;
	readonly lastGains: Readonly<Record<PlayerId, number>> | null;
	readonly winnerId: PlayerId | null;
	readonly gallery: Gallery | null; // non-null only in 'finished'
};

export type ChatScope = 'all' | 'guessed' | 'system';

export type ChatEntry = {
	readonly id: PlayerId | null; // null for system
	readonly name: string;
	readonly text: string;
	readonly scope: ChatScope;
};

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
	| { readonly type: 'join'; readonly code: string; readonly name: string }
	| { readonly type: 'updateSettings'; readonly settings: Partial<Settings> }
	| { readonly type: 'startGame' }
	| { readonly type: 'chooseWord'; readonly word: string }
	| { readonly type: 'draw'; readonly op: DrawOp } // stroke batches share op.id; server appends
	| { readonly type: 'clearCanvas' }
	| { readonly type: 'undo' }
	| { readonly type: 'redo' }
	| { readonly type: 'guess'; readonly text: string }
	| { readonly type: 'chat'; readonly text: string }
	| { readonly type: 'vote'; readonly vote: VoteKind } // applies to the drawing being revealed
	| { readonly type: 'playAgain' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
	| { readonly type: 'joined'; readonly you: PlayerId; readonly room: ClientRoom }
	| { readonly type: 'roomState'; readonly room: ClientRoom }
	| { readonly type: 'playerJoined'; readonly player: ClientPlayer }
	| { readonly type: 'playerLeft'; readonly id: PlayerId }
	| { readonly type: 'playerConnection'; readonly id: PlayerId; readonly connected: boolean }
	| { readonly type: 'hostChanged'; readonly hostId: PlayerId }
	| {
			readonly type: 'turnStarted';
			readonly drawerId: PlayerId;
			readonly round: number;
			readonly turnIndex: number;
			readonly endsAt: number;
	  }
	| { readonly type: 'wordChoices'; readonly choices: readonly string[]; readonly endsAt: number } // drawer only
	| { readonly type: 'drawingStarted'; readonly masked: string; readonly endsAt: number }
	| { readonly type: 'yourWord'; readonly word: string } // drawer only
	| { readonly type: 'draw'; readonly op: DrawOp }
	| { readonly type: 'clearCanvas' }
	| { readonly type: 'canvasState'; readonly ops: readonly DrawOp[] } // full resync (undo, reconnect)
	| { readonly type: 'letterRevealed'; readonly masked: string }
	| { readonly type: 'guessResult'; readonly correct: boolean; readonly close?: boolean } // to the guesser only
	| { readonly type: 'playerGuessed'; readonly id: PlayerId }
	| { readonly type: 'chat'; readonly entry: ChatEntry }
	| { readonly type: 'timeSync'; readonly endsAt: number }
	| {
			readonly type: 'turnEnded';
			readonly word: string;
			readonly gains: Readonly<Record<PlayerId, number>>;
			readonly totals: Readonly<Record<PlayerId, number>>;
			readonly endsAt: number;
	  }
	| { readonly type: 'voteUpdate'; readonly likes: number; readonly dislikes: number } // reveal only
	| {
			readonly type: 'gameEnded';
			readonly totals: Readonly<Record<PlayerId, number>>;
			readonly winnerId: PlayerId;
	  }
	| { readonly type: 'error'; readonly code: ErrorCode; readonly message: string };

export type ErrorCode =
	| 'room_not_found'
	| 'room_full'
	| 'name_taken'
	| 'bad_message'
	| 'not_allowed'
	| 'rate_limited';

// Validation bounds shared by server (enforce) and client (form limits).
export const LIMITS = {
	name: 24,
	chat: 200,
	customWordsTotal: 200,
	customWordLength: 32,
	pointsPerOp: 512,
	opsPerTurn: 3000
} as const;

export const SETTINGS_BOUNDS = {
	rounds: [1, 10],
	drawTimeSeconds: [30, 180],
	wordChoiceCount: [2, 5],
	hintCount: [0, 10],
	maxPlayers: [2, 12]
} as const;
