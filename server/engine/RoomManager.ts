import { Room, defaultDeps, type RoomDeps } from './Room';
import { type PlayerId, type ServerMessage } from '../../src/lib/protocol';

export const TEARDOWN_MS = 60_000;

/** Unambiguous room-code alphabet: no 0/O, 1/I/l. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/**
 * Time and randomness for the manager itself, injected for the same reason `Room` injects its
 * own (CLAUDE.md): teardown scheduling and room-code generation stay deterministic under test.
 * `schedule` is fire-and-forget — teardown re-checks `connectedCount` when it fires, so there's
 * nothing to cancel — hence no handle and no `cancel`.
 */
export type ManagerDeps = {
	readonly schedule: (fn: () => void, ms: number) => void;
	readonly random: () => number;
	readonly makeRoomDeps: (send: RoomDeps['send']) => RoomDeps;
};

export function defaultManagerDeps(): ManagerDeps {
	return {
		schedule: (fn, ms) => {
			setTimeout(fn, ms);
		},
		random: Math.random,
		makeRoomDeps: defaultDeps
	};
}

export class RoomManager {
	rooms = new Map<string, Room>();

	constructor(
		private readonly send: (roomCode: string, playerId: PlayerId, msg: ServerMessage) => void,
		private readonly deps: ManagerDeps = defaultManagerDeps()
	) {}

	create(): Room {
		let code = this.generateCode();
		while (this.rooms.has(code)) {
			code = this.generateCode();
		}
		const room = new Room(
			code,
			this.deps.makeRoomDeps((playerId, msg) => {
				this.send(code, playerId, msg);
			}),
			() => {
				this.scheduleTeardown(code);
			}
		);
		this.rooms.set(code, room);
		// A freshly created room has no players yet; if nobody ever joins, GC it.
		this.scheduleTeardown(code);
		return room;
	}

	get(code: string): Room | undefined {
		return this.rooms.get(code.toUpperCase());
	}

	private scheduleTeardown(code: string): void {
		this.deps.schedule(() => {
			const room = this.rooms.get(code);
			if (room && room.connectedCount === 0) {
				room.dispose();
				this.rooms.delete(code);
			}
		}, TEARDOWN_MS);
	}

	private generateCode(): string {
		let code = '';
		for (let i = 0; i < CODE_LENGTH; i++) {
			code += ALPHABET[Math.floor(this.deps.random() * ALPHABET.length)];
		}
		return code;
	}
}
