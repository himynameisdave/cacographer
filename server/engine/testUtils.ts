/**
 * Deterministic test harness for the game engine: fake clock, recorded message
 * log, and seeded randomness. Used by room.test.ts.
 */
import {
	type ClientMessage,
	type PlayerId,
	type ServerMessage,
	type Settings
} from '../../src/lib/protocol';
import { Room, type RoomDeps, type TimerHandle } from './Room';

type Task = {
	readonly id: number;
	readonly at: number;
	readonly fn: () => void;
};

export class FakeClock {
	now = 1_000_000;
	private tasks: Task[] = [];
	private seq = 0;

	schedule(fn: () => void, ms: number): number {
		const id = ++this.seq;
		this.tasks.push({ id, at: this.now + ms, fn });
		return id;
	}

	cancel(id: number): void {
		this.tasks = this.tasks.filter((t) => t.id !== id);
	}

	/**
	 * Advance the clock by `ms`, executing due tasks in fire-time order
	 * (ties break by scheduling order). Tasks scheduled while advancing also
	 * run if they land inside the window.
	 */
	advance(ms: number): void {
		const target = this.now + ms;
		for (;;) {
			let next: Task | undefined;
			for (const t of this.tasks) {
				if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) {
					next = t;
				}
			}
			if (!next) {
				break;
			}
			this.tasks.splice(this.tasks.indexOf(next), 1);
			if (next.at > this.now) {
				this.now = next.at;
			}
			next.fn();
		}
		this.now = target;
	}

	pendingCount(): number {
		return this.tasks.length;
	}
}

export type Sent = {
	readonly to: PlayerId;
	readonly msg: ServerMessage;
};

/** Deterministic custom word list; with random()=0 sampleChoices returns a
 * prefix of the unused pool in this order. */
export const WORDS = [
	'apple',
	'banana',
	'cherry',
	'grape',
	'lemon',
	'mango',
	'olive',
	'peach',
	'pear',
	'plum',
	'kiwi',
	'fig'
];

export class Harness {
	clock = new FakeClock();
	log: Sent[] = [];
	/** Values shifted off per random() call; when empty, random() returns 0. */
	randQueue: number[] = [];
	emptied = 0;
	room: Room;

	constructor(code = 'TEST1') {
		const deps: RoomDeps = {
			send: (to, msg) => {
				this.log.push({ to, msg: structuredClone(msg) });
			},
			now: () => this.clock.now,
			schedule: (fn, ms) => this.clock.schedule(fn, ms),
			cancel: (h: TimerHandle) => {
				// TimerHandle is opaque per RoomDeps; this harness knows it's always the
				// numeric id FakeClock.schedule returned, since it's the only schedule() in use.
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
				this.clock.cancel(h as number);
			},
			random: () => (this.randQueue.length > 0 ? this.randQueue.shift()! : 0)
		};
		this.room = new Room(code, deps, () => {
			this.emptied++;
		});
	}

	join(name: string): PlayerId {
		const res = this.room.join(name, () => {});
		if (!res.ok) {
			throw new Error(`join('${name}') failed: ${res.code}`);
		}
		return res.playerId;
	}

	send(id: PlayerId, msg: ClientMessage): void {
		this.room.handleMessage(id, msg);
	}

	/** All messages delivered to `id`, in order. */
	to(id: PlayerId): ServerMessage[] {
		return this.log.filter((s) => s.to === id).map((s) => s.msg);
	}

	typeTo<T extends ServerMessage['type']>(
		id: PlayerId,
		type: T
	): Extract<ServerMessage, { type: T }>[] {
		// TS can't narrow a generic discriminant from a runtime `.filter` predicate;
		// the check just above is exactly what this assertion claims.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
		return this.to(id).filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
	}

	ofType<T extends ServerMessage['type']>(
		type: T
	): { to: PlayerId; msg: Extract<ServerMessage, { type: T }> }[] {
		// Same generic-narrowing limitation as typeTo() above.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above
		return this.log.filter((s) => s.msg.type === type) as {
			to: PlayerId;
			msg: Extract<ServerMessage, { type: T }>;
		}[];
	}

	chatsTo(id: PlayerId) {
		return this.typeTo(id, 'chat').map((m) => m.entry);
	}

	clear(): void {
		this.log.length = 0;
	}
}

/**
 * Harness with `names` joined, deterministic custom words configured by the
 * host (hints off unless overridden), and the game started.
 */
export function startedGame(
	names: readonly string[],
	settings: Partial<Settings> = {}
): { h: Harness; ids: PlayerId[] } {
	const h = new Harness();
	const ids = names.map((n) => h.join(n));
	h.send(ids[0], {
		type: 'updateSettings',
		settings: { wordSource: 'custom', customWords: WORDS, hintCount: 0, ...settings }
	});
	h.send(ids[0], { type: 'startGame' });
	return { h, ids };
}

/** The most recent word choices offered to `drawer`. */
// Harness is a mutable test double (log/randQueue are pushed/shifted by its own methods), so
// it can't be typed as deeply readonly.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see comment above
export function choicesFor(h: Harness, drawer: PlayerId): readonly string[] {
	const msgs = h.typeTo(drawer, 'wordChoices');
	const last = msgs.at(-1);
	if (last === undefined) {
		throw new Error('no wordChoices sent to drawer');
	}
	return last.choices;
}

/** Choose `word` (default: the first offered choice) and return it. */
// See the note on choicesFor above; h.send() also mutates Harness's own log via deps.send.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- see comment above
export function chooseWord(h: Harness, drawer: PlayerId, word?: string): string {
	const w = word ?? choicesFor(h, drawer)[0];
	h.send(drawer, { type: 'chooseWord', word: w });
	return w;
}
