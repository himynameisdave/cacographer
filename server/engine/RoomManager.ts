import { Room, defaultDeps, type RoomDeps } from './Room';
import type { PlayerId, ServerMessage } from '../../src/lib/protocol';

export const TEARDOWN_MS = 60_000;

/** Unambiguous room-code alphabet: no 0/O, 1/I/l. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export class RoomManager {
	rooms = new Map<string, Room>();

	constructor(
		private send: (roomCode: string, playerId: PlayerId, msg: ServerMessage) => void,
		private makeDeps: (send: RoomDeps['send']) => RoomDeps = defaultDeps
	) {}

	create(): Room {
		let code = this.generateCode();
		while (this.rooms.has(code)) code = this.generateCode();
		const room = new Room(
			code,
			this.makeDeps((playerId, msg) => this.send(code, playerId, msg)),
			() => this.scheduleTeardown(code)
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
		setTimeout(() => {
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
			code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
		}
		return code;
	}
}
