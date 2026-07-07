/**
 * Shared client ⇄ server message protocol.
 * Imported by BOTH the SvelteKit client and the Bun game server — keep dependency-free.
 */

export type PlayerId = string;

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'finished';

export interface Settings {
	rounds: number; // 1–10
	drawTimeSeconds: number; // 30–180
	wordChoiceCount: number; // 2–5
	hintCount: number; // 0+ (capped per-word at length − 1)
	maxPlayers: number; // 2–12
	wordSource: 'builtin' | 'custom' | 'both';
	customWords: string[];
}

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
	| { kind: 'stroke'; id: string; points: [number, number][]; color: string; size: number }
	| { kind: 'fill'; id: string; x: number; y: number; color: string };

export interface ClientPlayer {
	id: PlayerId;
	name: string;
	score: number;
	isHost: boolean;
	connected: boolean;
	guessedThisTurn: boolean;
}

/** Recipient-safe projection of a Room. Never contains the secret word or the
 * drawer's choices — those travel only via `yourWord` / `wordChoices`. */
export interface ClientRoom {
	code: string;
	phase: Phase;
	players: ClientPlayer[];
	settings: Settings;
	round: number;
	turnOrder: PlayerId[];
	turnIndex: number;
	drawerId: PlayerId | null;
	masked: string | null;
	endsAt: number | null;
	ops: DrawOp[];
	lastWord: string | null;
	lastGains: Record<PlayerId, number> | null;
	winnerId: PlayerId | null;
}

export type ChatScope = 'all' | 'guessed' | 'system';

export interface ChatEntry {
	id: PlayerId | null; // null for system
	name: string;
	text: string;
	scope: ChatScope;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
	| { type: 'join'; code: string; name: string }
	| { type: 'updateSettings'; settings: Partial<Settings> }
	| { type: 'startGame' }
	| { type: 'chooseWord'; word: string }
	| { type: 'draw'; op: DrawOp } // stroke batches share op.id; server appends
	| { type: 'clearCanvas' }
	| { type: 'undo' }
	| { type: 'guess'; text: string }
	| { type: 'chat'; text: string }
	| { type: 'playAgain' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
	| { type: 'joined'; you: PlayerId; room: ClientRoom }
	| { type: 'roomState'; room: ClientRoom }
	| { type: 'playerJoined'; player: ClientPlayer }
	| { type: 'playerLeft'; id: PlayerId }
	| { type: 'playerConnection'; id: PlayerId; connected: boolean }
	| { type: 'hostChanged'; hostId: PlayerId }
	| { type: 'turnStarted'; drawerId: PlayerId; round: number; turnIndex: number; endsAt: number }
	| { type: 'wordChoices'; choices: string[]; endsAt: number } // drawer only
	| { type: 'drawingStarted'; masked: string; endsAt: number }
	| { type: 'yourWord'; word: string } // drawer only
	| { type: 'draw'; op: DrawOp }
	| { type: 'clearCanvas' }
	| { type: 'canvasState'; ops: DrawOp[] } // full resync (undo, reconnect)
	| { type: 'letterRevealed'; masked: string }
	| { type: 'guessResult'; correct: boolean; close?: boolean } // to the guesser only
	| { type: 'playerGuessed'; id: PlayerId }
	| { type: 'chat'; entry: ChatEntry }
	| { type: 'timeSync'; endsAt: number }
	| {
			type: 'turnEnded';
			word: string;
			gains: Record<PlayerId, number>;
			totals: Record<PlayerId, number>;
			endsAt: number;
	  }
	| { type: 'gameEnded'; totals: Record<PlayerId, number>; winnerId: PlayerId }
	| { type: 'error'; code: ErrorCode; message: string };

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
