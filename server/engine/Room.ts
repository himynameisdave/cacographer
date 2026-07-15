/**
 * Per-room game state + turn loop. Transport-agnostic: it receives intents via
 * `join`/`disconnect`/`handleMessage` and emits `ServerMessage`s through
 * `deps.send`. Time and randomness are injected so tests can drive the loop
 * deterministically.
 */
import {
	DEFAULT_SETTINGS,
	LIMITS,
	SETTINGS_BOUNDS,
	type ChatEntry,
	type ClientMessage,
	type ClientPlayer,
	type ClientRoom,
	type DrawOp,
	type ErrorCode,
	type Phase,
	type PlayerId,
	type ServerMessage,
	type Settings
} from '../../src/lib/protocol';
import { levenshtein, normalize } from './text';
import { maskWord, maxHints, pickRevealIndex, revealSchedule } from './mask';
import { drawerPoints, guesserTimePoints, ordinalBonus } from './scoring';
import { buildWordPool, sampleChoices } from './words';

export const REDO_LIMIT = 3;
export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 6000;
export const SKIP_REVEAL_MS = 2500; // shorter interstitial when a turn is skipped
export const GRACE_MS = 60_000; // disconnected player keeps slot/score this long
export const SYNC_MS = 5000;

/**
 * Opaque timer handle from `deps.schedule` — `unknown` because Node/Bun's `setTimeout`
 * return different shapes and the engine must stay transport-agnostic. `deps.cancel`'s own
 * implementation is the one place that knows the real shape and narrows it back; that's a
 * deliberate, deep-readonly-safe narrowing, not a real `any` leak.
 */
export type TimerHandle = unknown;

export type RoomDeps = {
	readonly send: (playerId: PlayerId, msg: ServerMessage) => void;
	readonly now: () => number;
	readonly schedule: (fn: () => void, ms: number) => TimerHandle;
	readonly cancel: (handle: TimerHandle) => void;
	readonly random: () => number;
};

function clampSetting(v: unknown, [min, max]: readonly [number, number], fallback: number): number {
	const n = Math.round(Number(v));
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clamp01(n: unknown): number | null {
	return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

export function defaultDeps(send: RoomDeps['send']): RoomDeps {
	return {
		send,
		now: () => Date.now(),
		schedule: (fn, ms) => setTimeout(fn, ms),
		cancel: (h) => {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see TimerHandle's doc comment
			clearTimeout(h as ReturnType<typeof setTimeout>);
		},
		random: Math.random
	};
}

type ServerPlayer = {
	id: PlayerId;
	name: string;
	score: number;
	connected: boolean;
	guessedThisTurn: boolean;
	guessedAtMs: number | null;
	guessOrder: number | null;
	// oxlint-disable-next-line typescript/no-redundant-type-constituents -- see TimerHandle's doc comment
	graceTimer: TimerHandle | null;
};

type TurnState = {
	drawerId: PlayerId;
	choices: string[];
	word: string | null;
	revealed: Set<number>;
	masked: string;
	endsAt: number; // deadline of the *current* phase (choosing/drawing/reveal)
	drawMs: number;
};

type JoinResult =
	| { ok: true; playerId: PlayerId }
	| { ok: false; code: ErrorCode; message: string };

export class Room {
	readonly code: string;
	phase: Phase = 'lobby';
	hostId: PlayerId | null = null;
	settings: Settings = structuredClone(DEFAULT_SETTINGS);
	players = new Map<PlayerId, ServerPlayer>();
	round = 0;
	turnOrder: PlayerId[] = [];
	turnIndex = 0;
	turn: TurnState | null = null;
	ops: DrawOp[] = [];
	redoStack: DrawOp[] = [];
	usedWords = new Set<string>();
	lastWord: string | null = null;
	lastGains: Record<PlayerId, number> | null = null;
	winnerId: PlayerId | null = null;

	private wordPool: string[] = [];
	// oxlint-disable-next-line typescript/no-redundant-type-constituents -- see TimerHandle's doc comment
	private phaseTimer: TimerHandle | null = null;
	private hintTimers: TimerHandle[] = [];
	// oxlint-disable-next-line typescript/no-redundant-type-constituents -- see TimerHandle's doc comment
	private syncTimer: TimerHandle | null = null;
	private playerSeq = 0;
	private disposed = false;

	constructor(
		code: string,
		private readonly deps: RoomDeps,
		private readonly onEmpty: () => void = () => {}
	) {
		this.code = code;
	}

	get connectedCount(): number {
		let n = 0;
		for (const p of this.players.values()) {
			if (p.connected) {
				n++;
			}
		}
		return n;
	}

	// -------------------------------------------------------------------------
	// Joining / leaving
	// -------------------------------------------------------------------------

	/**
	 * `register` is called with the assigned player id after state is updated
	 * but before any messages are sent, so the transport can map the socket.
	 */
	join(rawName: string, register: (id: PlayerId) => void): JoinResult {
		const name = rawName.trim().slice(0, LIMITS.name);
		if (!name) {
			return { ok: false, code: 'bad_message', message: 'Name required' };
		}

		// Same-name rejoin while the slot is in its grace period reattaches the
		// old player (score retained).
		const existing = [...this.players.values()].find(
			(p: Readonly<ServerPlayer>) => !p.connected && normalize(p.name) === normalize(name)
		);
		if (existing) {
			existing.connected = true;
			if (existing.graceTimer !== null) {
				this.deps.cancel(existing.graceTimer);
			}
			existing.graceTimer = null;
			if (this.midGame() && !this.turnOrder.includes(existing.id)) {
				this.turnOrder.push(existing.id);
			}
			register(existing.id);
			this.deps.send(existing.id, { type: 'joined', you: existing.id, room: this.toClientRoom() });
			this.broadcastExcept(existing.id, {
				type: 'playerConnection',
				id: existing.id,
				connected: true
			});
			this.systemChat(`${existing.name} reconnected`);
			return { ok: true, playerId: existing.id };
		}

		if (this.players.size >= this.settings.maxPlayers) {
			return { ok: false, code: 'room_full', message: 'Room is full' };
		}
		if (
			[...this.players.values()].some(
				(p: Readonly<ServerPlayer>) => normalize(p.name) === normalize(name)
			)
		) {
			return { ok: false, code: 'name_taken', message: 'Name already taken' };
		}

		const id = `p${++this.playerSeq}`;
		const player: ServerPlayer = {
			id,
			name,
			score: 0,
			connected: true,
			guessedThisTurn: false,
			guessedAtMs: null,
			guessOrder: null,
			graceTimer: null
		};
		this.players.set(id, player);
		this.hostId ??= id;
		if (this.midGame()) {
			this.turnOrder.push(id);
		}

		register(id);
		this.deps.send(id, { type: 'joined', you: id, room: this.toClientRoom() });
		this.broadcastExcept(id, { type: 'playerJoined', player: this.toClientPlayer(player) });
		this.systemChat(`${player.name} joined`);
		return { ok: true, playerId: id };
	}

	disconnect(playerId: PlayerId): void {
		const player = this.players.get(playerId);
		if (!player || !player.connected) {
			return;
		}
		player.connected = false;
		this.broadcast({ type: 'playerConnection', id: playerId, connected: false });
		this.systemChat(`${player.name} disconnected`);

		if (this.hostId === playerId) {
			this.transferHost();
		}

		if (
			this.turn?.drawerId === playerId &&
			(this.phase === 'choosing' || this.phase === 'drawing')
		) {
			this.endTurn('drawer_left');
		} else if (this.phase === 'drawing') {
			this.checkAllGuessed();
		}

		player.graceTimer = this.deps.schedule(() => {
			this.removePlayer(playerId);
		}, GRACE_MS);
		if (this.connectedCount === 0) {
			this.onEmpty();
		}
	}

	private removePlayer(playerId: PlayerId): void {
		const player = this.players.get(playerId);
		if (!player || player.connected) {
			return;
		}
		this.players.delete(playerId);

		const idx = this.turnOrder.indexOf(playerId);
		if (idx !== -1) {
			this.turnOrder.splice(idx, 1);
			// Keep the pointer aimed at the same upcoming drawer.
			if (idx <= this.turnIndex) {
				this.turnIndex--;
			}
		}

		this.broadcast({ type: 'playerLeft', id: playerId });
		this.systemChat(`${player.name} left`);

		if (this.midGame() && this.connectedCount < 2) {
			this.abortGame('Not enough players — back to the lobby');
		} else if (this.phase === 'drawing') {
			this.checkAllGuessed();
		}
	}

	private transferHost(): void {
		for (const p of this.players.values()) {
			if (p.connected) {
				this.hostId = p.id;
				this.broadcast({ type: 'hostChanged', hostId: p.id });
				this.systemChat(`${p.name} is now the host`);
				return;
			}
		}
	}

	// -------------------------------------------------------------------------
	// Message routing
	// -------------------------------------------------------------------------

	handleMessage(playerId: PlayerId, msg: ClientMessage): void {
		if (this.disposed || !this.players.has(playerId)) {
			return;
		}
		switch (msg.type) {
			case 'updateSettings': {
				this.updateSettings(playerId, msg.settings);
				return;
			}
			case 'startGame': {
				this.startGame(playerId);
				return;
			}
			case 'chooseWord': {
				this.chooseWord(playerId, msg.word);
				return;
			}
			case 'draw': {
				this.draw(playerId, msg.op);
				return;
			}
			case 'clearCanvas': {
				this.clearCanvas(playerId);
				return;
			}
			case 'undo': {
				this.undo(playerId);
				return;
			}
			case 'redo': {
				this.redo(playerId);
				return;
			}
			case 'guess': {
				this.guess(playerId, msg.text);
				return;
			}
			case 'chat': {
				this.chat(playerId, msg.text);
				return;
			}
			case 'playAgain': {
				this.playAgain(playerId);
				return;
			}
			case 'join': {
				// The transport (server/index.ts) routes 'join' separately, before a player is
				// registered, and never forwards it here — this only fires on a resent 'join'.
				this.sendError(playerId, 'bad_message', 'Already joined');
				return;
			}
			default: {
				// Reachable at runtime despite exhaustive typing: `msg` is deserialized from an
				// untyped wire payload, so an unrecognized `type` can still arrive here.
				this.sendError(playerId, 'bad_message', 'Unknown message type');
			}
		}
	}

	// -------------------------------------------------------------------------
	// Lobby
	// -------------------------------------------------------------------------

	private updateSettings(playerId: PlayerId, partial: Partial<Settings>): void {
		if (playerId !== this.hostId) {
			this.sendError(playerId, 'not_allowed', 'Host only');
			return;
		}
		if (this.phase !== 'lobby') {
			this.sendError(playerId, 'not_allowed', 'Settings are locked during the game');
			return;
		}

		// `Settings` is deeply readonly (it's also the wire type) — build a mutable draft and
		// swap it in at the end rather than mutating `this.settings` in place.
		const s = { ...this.settings };
		if ('rounds' in partial) {
			s.rounds = clampSetting(partial.rounds, SETTINGS_BOUNDS.rounds, s.rounds);
		}
		if ('drawTimeSeconds' in partial) {
			s.drawTimeSeconds = clampSetting(
				partial.drawTimeSeconds,
				SETTINGS_BOUNDS.drawTimeSeconds,
				s.drawTimeSeconds
			);
		}
		if ('wordChoiceCount' in partial) {
			s.wordChoiceCount = clampSetting(
				partial.wordChoiceCount,
				SETTINGS_BOUNDS.wordChoiceCount,
				s.wordChoiceCount
			);
		}
		if ('hintCount' in partial) {
			s.hintCount = clampSetting(partial.hintCount, SETTINGS_BOUNDS.hintCount, s.hintCount);
		}
		if ('maxPlayers' in partial) {
			s.maxPlayers = clampSetting(partial.maxPlayers, SETTINGS_BOUNDS.maxPlayers, s.maxPlayers);
		}
		if (
			'wordSource' in partial &&
			(partial.wordSource === 'builtin' ||
				partial.wordSource === 'custom' ||
				partial.wordSource === 'both')
		) {
			s.wordSource = partial.wordSource;
		}
		if ('customWords' in partial && Array.isArray(partial.customWords)) {
			s.customWords = partial.customWords
				.filter((w): w is string => typeof w === 'string')
				.map((w) => w.trim().slice(0, LIMITS.customWordLength))
				.filter(Boolean)
				.slice(0, LIMITS.customWordsTotal);
		}
		this.settings = s;
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });
	}

	private startGame(playerId: PlayerId): void {
		if (playerId !== this.hostId) {
			this.sendError(playerId, 'not_allowed', 'Host only');
			return;
		}
		if (this.phase !== 'lobby') {
			this.sendError(playerId, 'not_allowed', 'Game already running');
			return;
		}
		if (this.connectedCount < 2) {
			this.sendError(playerId, 'not_allowed', 'Need at least 2 players');
			return;
		}

		this.wordPool = buildWordPool(this.settings);
		if (this.wordPool.length === 0) {
			this.sendError(playerId, 'not_allowed', 'Word list is empty — add custom words');
			return;
		}

		for (const p of this.players.values()) {
			p.score = 0;
			p.guessedThisTurn = false;
			p.guessedAtMs = null;
			p.guessOrder = null;
		}
		this.usedWords.clear();
		this.lastWord = null;
		this.lastGains = null;
		this.winnerId = null;
		this.turnOrder = [...this.players.values()]
			.filter((p: Readonly<ServerPlayer>) => p.connected)
			.map((p: Readonly<ServerPlayer>) => p.id);
		this.round = 1;
		this.turnIndex = 0;
		this.systemChat('Game started!');
		this.startTurn();
	}

	private playAgain(playerId: PlayerId): void {
		if (playerId !== this.hostId) {
			this.sendError(playerId, 'not_allowed', 'Host only');
			return;
		}
		if (this.phase !== 'finished') {
			return;
		}
		this.phase = 'lobby';
		this.turn = null;
		this.clearOps();
		this.round = 0;
		this.turnIndex = 0;
		this.turnOrder = [];
		this.lastWord = null;
		this.lastGains = null;
		this.winnerId = null;
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });
		this.systemChat('Back to the lobby');
	}

	// -------------------------------------------------------------------------
	// Turn loop
	// -------------------------------------------------------------------------

	private midGame(): boolean {
		return this.phase === 'choosing' || this.phase === 'drawing' || this.phase === 'reveal';
	}

	private startTurn(): void {
		if (this.disposed) {
			return;
		}
		if (this.connectedCount < 2) {
			this.abortGame('Not enough players — back to the lobby');
			return;
		}

		// Skip drawers who are disconnected (grace slots) or gone.
		let guard = this.turnOrder.length * this.settings.rounds + 1;
		while (guard-- > 0) {
			const drawer = this.players.get(this.turnOrder[this.turnIndex]);
			if (drawer?.connected === true) {
				break;
			}
			if (this.advanceTurnPointer()) {
				this.endGame();
				return;
			}
		}
		const drawer = this.players.get(this.turnOrder[this.turnIndex]);
		if (drawer === undefined || !drawer.connected) {
			this.abortGame('No available drawer — back to the lobby');
			return;
		}

		this.clearTurnTimers();
		this.clearOps();
		for (const p of this.players.values()) {
			p.guessedThisTurn = false;
			p.guessedAtMs = null;
			p.guessOrder = null;
		}

		const choices = sampleChoices(
			this.wordPool,
			this.usedWords,
			this.settings.wordChoiceCount,
			this.deps.random
		);
		const endsAt = this.deps.now() + CHOOSE_MS;
		this.turn = {
			drawerId: drawer.id,
			choices,
			word: null,
			revealed: new Set(),
			masked: '',
			endsAt,
			drawMs: this.settings.drawTimeSeconds * 1000
		};
		this.phase = 'choosing';
		this.broadcast({
			type: 'turnStarted',
			drawerId: drawer.id,
			round: this.round,
			turnIndex: this.turnIndex,
			endsAt
		});
		this.deps.send(drawer.id, { type: 'wordChoices', choices, endsAt });
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });
		this.phaseTimer = this.deps.schedule(() => {
			this.autoChoose();
		}, CHOOSE_MS);
	}

	/** @returns true when the game is over (past the last round). */
	private advanceTurnPointer(): boolean {
		this.turnIndex++;
		if (this.turnIndex >= this.turnOrder.length) {
			this.turnIndex = 0;
			this.round++;
		}
		return this.round > this.settings.rounds;
	}

	private autoChoose(): void {
		if (this.phase !== 'choosing' || !this.turn) {
			return;
		}
		const { choices } = this.turn;
		this.beginDrawing(choices[Math.floor(this.deps.random() * choices.length)]);
	}

	private chooseWord(playerId: PlayerId, word: string): void {
		if (this.phase !== 'choosing' || !this.turn || this.turn.drawerId !== playerId) {
			this.sendError(playerId, 'not_allowed', 'Not your word to choose');
			return;
		}
		const chosen = this.turn.choices.find((c) => c === normalize(word));
		if (chosen === undefined) {
			this.sendError(playerId, 'not_allowed', 'Pick one of the offered words');
			return;
		}
		if (this.phaseTimer !== null) {
			this.deps.cancel(this.phaseTimer);
		}
		this.beginDrawing(chosen);
	}

	private beginDrawing(word: string): void {
		if (!this.turn) {
			return;
		}
		this.usedWords.add(word);
		this.turn.word = word;
		this.turn.revealed = new Set();
		this.turn.masked = maskWord(word, this.turn.revealed);
		this.turn.endsAt = this.deps.now() + this.turn.drawMs;
		this.phase = 'drawing';

		this.broadcast({ type: 'drawingStarted', masked: this.turn.masked, endsAt: this.turn.endsAt });
		this.deps.send(this.turn.drawerId, { type: 'yourWord', word });
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });

		const hints = maxHints(word, this.settings.hintCount);
		this.hintTimers = revealSchedule(this.turn.drawMs, hints).map((offset) =>
			this.deps.schedule(() => {
				this.revealLetter();
			}, offset)
		);
		this.phaseTimer = this.deps.schedule(() => {
			this.endTurn('time');
		}, this.turn.drawMs);
		const tick = () => {
			if (this.phase !== 'drawing' || !this.turn) {
				return;
			}
			this.broadcast({ type: 'timeSync', endsAt: this.turn.endsAt });
			this.syncTimer = this.deps.schedule(tick, SYNC_MS);
		};
		this.syncTimer = this.deps.schedule(tick, SYNC_MS);
	}

	private revealLetter(): void {
		if (this.phase !== 'drawing' || this.turn === null || this.turn.word === null) {
			return;
		}
		const idx = pickRevealIndex(this.turn.word, this.turn.revealed, this.deps.random);
		if (idx === null) {
			return;
		}
		this.turn.revealed.add(idx);
		this.turn.masked = maskWord(this.turn.word, this.turn.revealed);
		this.broadcast({ type: 'letterRevealed', masked: this.turn.masked });
	}

	// -------------------------------------------------------------------------
	// Guessing & chat
	// -------------------------------------------------------------------------

	private guess(playerId: PlayerId, rawText: string): void {
		const player = this.players.get(playerId)!;
		const text = rawText.trim().slice(0, LIMITS.chat);
		if (!text) {
			return;
		}

		if (this.phase !== 'drawing' || this.turn === null || this.turn.word === null) {
			this.chat(playerId, text);
			return;
		}
		if (playerId === this.turn.drawerId || player.guessedThisTurn) {
			this.sendChat({ id: playerId, name: player.name, text, scope: 'guessed' });
			return;
		}

		const guess = normalize(text);
		const { word } = this.turn;

		if (guess === word) {
			player.guessedThisTurn = true;
			player.guessedAtMs = this.deps.now();
			player.guessOrder = [...this.players.values()].filter(
				(p: Readonly<ServerPlayer>) => p.guessOrder !== null
			).length;
			this.deps.send(playerId, { type: 'guessResult', correct: true });
			this.broadcast({ type: 'playerGuessed', id: playerId });
			this.systemChat(`${player.name} guessed the word!`);
			this.checkAllGuessed();
			return;
		}

		// A wrong guess that *contains* the answer would spoil it — keep it in
		// the post-guess channel instead of broadcasting.
		if (guess.includes(word)) {
			this.sendChat({ id: playerId, name: player.name, text, scope: 'guessed' });
			return;
		}

		if (levenshtein(guess, word) === 1) {
			this.deps.send(playerId, { type: 'guessResult', correct: false, close: true });
		}
		this.sendChat({ id: playerId, name: player.name, text, scope: 'all' });
	}

	private chat(playerId: PlayerId, rawText: string): void {
		const player = this.players.get(playerId)!;
		const text = rawText.trim().slice(0, LIMITS.chat);
		if (!text) {
			return;
		}

		if (this.phase === 'drawing' && this.turn) {
			if (playerId === this.turn.drawerId || player.guessedThisTurn) {
				this.sendChat({ id: playerId, name: player.name, text, scope: 'guessed' });
				return;
			}
			// A not-yet-guessed player's message during drawing is always a guess.
			this.guess(playerId, text);
			return;
		}
		this.sendChat({ id: playerId, name: player.name, text, scope: 'all' });
	}

	private checkAllGuessed(): void {
		if (this.phase !== 'drawing' || !this.turn) {
			return;
		}
		const eligible = [...this.players.values()].filter(
			(p: Readonly<ServerPlayer>) => p.id !== this.turn!.drawerId && p.connected
		);
		if (eligible.every((p: Readonly<ServerPlayer>) => p.guessedThisTurn)) {
			this.endTurn('all_guessed');
		}
	}

	// -------------------------------------------------------------------------
	// Canvas
	// -------------------------------------------------------------------------

	private draw(playerId: PlayerId, op: DrawOp): void {
		if (this.phase !== 'drawing' || this.turn?.drawerId !== playerId) {
			return;
		}
		const valid = this.validateOp(op);
		if (!valid) {
			return;
		}
		if (this.ops.length >= LIMITS.opsPerTurn) {
			return;
		}

		this.redoStack = [];

		const lastIndex = this.ops.length - 1;
		const last = this.ops.at(-1);
		if (valid.kind === 'stroke' && last?.kind === 'stroke' && last.id === valid.id) {
			if (last.points.length < 5000) {
				this.ops[lastIndex] = { ...last, points: [...last.points, ...valid.points] };
			}
		} else {
			this.ops.push(valid);
		}
		this.broadcastExcept(playerId, { type: 'draw', op: valid });
	}

	private validateOp(op: DrawOp): DrawOp | null {
		// op's static type is optimistic: it's really an unvalidated client-controlled payload
		// (routed through `handleMessage`'s `msg: ClientMessage`), so despite `DrawOp` claiming
		// these can't fail, they're the actual runtime shape check.
		// oxlint-disable-next-line typescript/no-unnecessary-condition, typescript/strict-boolean-expressions
		if (!op || typeof op !== 'object' || typeof op.id !== 'string' || op.id.length > 32) {
			return null;
		}
		const color =
			typeof op.color === 'string' && /^#[0-9a-f]{3,8}$/iu.test(op.color) ? op.color : null;
		if (color === null) {
			return null;
		}

		if (op.kind === 'stroke') {
			if (
				!Array.isArray(op.points) ||
				op.points.length === 0 ||
				op.points.length > LIMITS.pointsPerOp
			) {
				return null;
			}
			const points: [number, number][] = [];
			for (const pt of op.points) {
				if (!Array.isArray(pt)) {
					return null;
				}
				const x = clamp01(pt[0]);
				const y = clamp01(pt[1]);
				if (x === null || y === null) {
					return null;
				}
				points.push([x, y]);
			}
			const size =
				typeof op.size === 'number' && Number.isFinite(op.size)
					? Math.min(64, Math.max(1, op.size))
					: null;
			if (size === null) {
				return null;
			}
			return { kind: 'stroke', id: op.id, points, color, size };
		}
		// Only 'stroke' | 'fill' exist on DrawOp, and 'stroke' returned unconditionally above —
		// this is 'fill' by elimination for well-formed input, and clamp01 below rejects anything
		// else (a malformed `op.kind`) by returning null for the missing/non-numeric x/y.
		const x = clamp01(op.x);
		const y = clamp01(op.y);
		if (x === null || y === null) {
			return null;
		}
		return { kind: 'fill', id: op.id, x, y, color };
	}

	private clearCanvas(playerId: PlayerId): void {
		if (this.phase !== 'drawing' || this.turn?.drawerId !== playerId) {
			return;
		}
		this.clearOps();
		this.broadcast({ type: 'clearCanvas' });
	}

	private clearOps(): void {
		this.ops = [];
		this.redoStack = [];
	}

	private undo(playerId: PlayerId): void {
		if (this.phase !== 'drawing' || this.turn?.drawerId !== playerId) {
			return;
		}
		if (this.ops.length === 0) {
			return;
		}
		const op = this.ops.pop()!;
		if (this.redoStack.length >= REDO_LIMIT) {
			this.redoStack.shift();
		}
		this.redoStack.push(op);
		this.broadcast({ type: 'canvasState', ops: this.ops });
	}

	private redo(playerId: PlayerId): void {
		if (this.phase !== 'drawing' || this.turn?.drawerId !== playerId) {
			return;
		}
		if (this.redoStack.length === 0) {
			return;
		}
		this.ops.push(this.redoStack.pop()!);
		this.broadcast({ type: 'canvasState', ops: this.ops });
	}

	// -------------------------------------------------------------------------
	// Turn end / game end
	// -------------------------------------------------------------------------

	private endTurn(reason: 'time' | 'all_guessed' | 'drawer_left'): void {
		if (!this.turn || (this.phase !== 'choosing' && this.phase !== 'drawing')) {
			return;
		}
		this.clearTurnTimers();

		const gains: Record<PlayerId, number> = {};
		if (reason !== 'drawer_left' && this.turn.word !== null) {
			const timePoints: number[] = [];
			for (const p of this.players.values()) {
				if (!p.guessedThisTurn || p.guessedAtMs === null || p.guessOrder === null) {
					continue;
				}
				const time = guesserTimePoints(this.turn.endsAt, this.turn.drawMs, p.guessedAtMs);
				timePoints.push(time);
				gains[p.id] = time + ordinalBonus(p.guessOrder);
			}
			const eligible = [...this.players.values()].filter(
				(p: Readonly<ServerPlayer>) =>
					p.id !== this.turn!.drawerId && (p.connected || p.guessedThisTurn)
			);
			const drawerGain = drawerPoints(timePoints, eligible.length);
			if (drawerGain > 0) {
				gains[this.turn.drawerId] = drawerGain;
			}
			for (const [id, gain] of Object.entries(gains)) {
				const p = this.players.get(id);
				if (p) {
					p.score += gain;
				}
			}
		}

		this.phase = 'reveal';
		this.lastWord = this.turn.word ?? '';
		this.lastGains = gains;
		const revealMs = reason === 'drawer_left' ? SKIP_REVEAL_MS : REVEAL_MS;
		this.turn.endsAt = this.deps.now() + revealMs;
		if (reason === 'drawer_left') {
			this.systemChat('The drawer left — turn skipped');
		}

		this.broadcast({
			type: 'turnEnded',
			word: this.lastWord,
			gains,
			totals: this.totals(),
			endsAt: this.turn.endsAt
		});
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });
		this.phaseTimer = this.deps.schedule(() => {
			this.nextTurn();
		}, revealMs);
	}

	private nextTurn(): void {
		if (this.disposed || this.phase !== 'reveal') {
			return;
		}
		if (this.advanceTurnPointer()) {
			this.endGame();
			return;
		}
		this.startTurn();
	}

	private endGame(): void {
		this.clearTurnTimers();
		this.phase = 'finished';
		this.turn = null;
		let winner: ServerPlayer | null = null;
		for (const p of this.players.values()) {
			if (!winner || p.score > winner.score) {
				winner = p;
			}
		}
		this.winnerId = winner?.id ?? null;
		this.broadcast({
			type: 'gameEnded',
			totals: this.totals(),
			winnerId: this.winnerId ?? ''
		});
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });
	}

	private abortGame(message: string): void {
		this.clearTurnTimers();
		this.phase = 'lobby';
		this.turn = null;
		this.clearOps();
		this.systemChat(message);
		this.broadcast({ type: 'roomState', room: this.toClientRoom() });
	}

	// -------------------------------------------------------------------------
	// Plumbing
	// -------------------------------------------------------------------------

	dispose(): void {
		this.disposed = true;
		this.clearTurnTimers();
		for (const p of this.players.values()) {
			if (p.graceTimer !== null) {
				this.deps.cancel(p.graceTimer);
			}
		}
	}

	private clearTurnTimers(): void {
		if (this.phaseTimer !== null) {
			this.deps.cancel(this.phaseTimer);
		}
		this.phaseTimer = null;
		for (const t of this.hintTimers) {
			this.deps.cancel(t);
		}
		this.hintTimers = [];
		if (this.syncTimer !== null) {
			this.deps.cancel(this.syncTimer);
		}
		this.syncTimer = null;
	}

	private totals(): Record<PlayerId, number> {
		const out: Record<PlayerId, number> = {};
		for (const p of this.players.values()) {
			out[p.id] = p.score;
		}
		return out;
	}

	private sendChat(entry: ChatEntry): void {
		const msg: ServerMessage = { type: 'chat', entry };
		if (entry.scope === 'guessed' && this.turn) {
			for (const p of this.players.values()) {
				if (!p.connected) {
					continue;
				}
				if (p.id === this.turn.drawerId || p.guessedThisTurn) {
					this.deps.send(p.id, msg);
				}
			}
			return;
		}
		this.broadcast(msg);
	}

	private systemChat(text: string): void {
		this.sendChat({ id: null, name: '', text, scope: 'system' });
	}

	private sendError(playerId: PlayerId, code: ErrorCode, message: string): void {
		this.deps.send(playerId, { type: 'error', code, message });
	}

	private broadcast(msg: ServerMessage): void {
		for (const p of this.players.values()) {
			if (p.connected) {
				this.deps.send(p.id, msg);
			}
		}
	}

	private broadcastExcept(exceptId: PlayerId, msg: ServerMessage): void {
		for (const p of this.players.values()) {
			if (p.connected && p.id !== exceptId) {
				this.deps.send(p.id, msg);
			}
		}
	}

	private toClientPlayer(p: Readonly<ServerPlayer>): ClientPlayer {
		return {
			id: p.id,
			name: p.name,
			score: p.score,
			isHost: p.id === this.hostId,
			connected: p.connected,
			guessedThisTurn: p.guessedThisTurn
		};
	}

	/** Recipient-safe projection: never includes the secret word or choices. */
	toClientRoom(): ClientRoom {
		return {
			code: this.code,
			phase: this.phase,
			players: [...this.players.values()].map((p: Readonly<ServerPlayer>) =>
				this.toClientPlayer(p)
			),
			settings: this.settings,
			round: this.round,
			turnOrder: [...this.turnOrder],
			turnIndex: this.turnIndex,
			drawerId: this.turn?.drawerId ?? null,
			masked: this.phase === 'drawing' ? (this.turn?.masked ?? null) : null,
			endsAt: this.turn?.endsAt ?? null,
			ops: this.ops,
			lastWord: this.phase === 'reveal' || this.phase === 'finished' ? this.lastWord : null,
			lastGains: this.phase === 'reveal' ? this.lastGains : null,
			winnerId: this.winnerId
		};
	}
}
