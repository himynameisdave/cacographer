import type { PlayerId, ServerMessage } from '$lib/protocol';

const MUTE_KEY = 'cacographer:muted';

/** A single square-wave blip: frequency in Hz, start offset and duration in seconds. */
type Note = { freq: number; at: number; dur: number };

/**
 * Which blips a server message earns, if any. Pure so the mapping is testable
 * without an AudioContext — `play()` owns all the audio side effects.
 */
export function notesFor(msg: ServerMessage, you: PlayerId | null): readonly Note[] {
	switch (msg.type) {
		case 'playerJoined':
			return [{ freq: 660, at: 0, dur: 0.07 }, { freq: 880, at: 0.07, dur: 0.09 }];
		case 'playerLeft':
			return [{ freq: 440, at: 0, dur: 0.07 }, { freq: 330, at: 0.07, dur: 0.09 }];
		case 'wordChoices':
			return [{ freq: 784, at: 0, dur: 0.1 }, { freq: 1047, at: 0.12, dur: 0.14 }];
		case 'drawingStarted':
			return [{ freq: 523, at: 0, dur: 0.09 }, { freq: 784, at: 0.1, dur: 0.13 }];
		case 'letterRevealed':
			return [{ freq: 1319, at: 0, dur: 0.04 }];
		case 'guessResult':
			if (msg.correct) {
				return [
					{ freq: 659, at: 0, dur: 0.08 },
					{ freq: 831, at: 0.08, dur: 0.08 },
					{ freq: 988, at: 0.16, dur: 0.18 }
				];
			}
			return msg.close === true ? [{ freq: 233, at: 0, dur: 0.16 }] : [];
		case 'playerGuessed':
			// The guesser already heard their own fanfare from `guessResult`.
			return msg.id === you ? [] : [{ freq: 988, at: 0, dur: 0.07 }];
		case 'turnEnded':
			return [{ freq: 587, at: 0, dur: 0.1 }, { freq: 392, at: 0.11, dur: 0.2 }];
		case 'gameEnded':
			return [
				{ freq: 523, at: 0, dur: 0.1 },
				{ freq: 659, at: 0.11, dur: 0.1 },
				{ freq: 784, at: 0.22, dur: 0.1 },
				{ freq: 1047, at: 0.33, dur: 0.3 }
			];
		case 'error':
			return [{ freq: 196, at: 0, dur: 0.2 }];
		default:
			return [];
	}
}

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
	if (ctx === null && typeof AudioContext !== 'undefined') {
		ctx = new AudioContext();
	}
	// Browsers suspend the context until a gesture; every play attempt is a cheap retry.
	void ctx?.resume();
	return ctx;
}

/** Whether sound is off, as persisted across sessions. */
export function isMuted(): boolean {
	return localStorage.getItem(MUTE_KEY) === '1';
}

/** Flip mute and persist it; returns the new muted state. */
export function toggleMute(): boolean {
	const next = !isMuted();
	localStorage.setItem(MUTE_KEY, next ? '1' : '0');
	return next;
}

/** Sound the blips this message earns. No-op when muted or without Web Audio. */
export function play(msg: ServerMessage, you: PlayerId | null): void {
	const notes = notesFor(msg, you);
	if (notes.length === 0 || isMuted()) {
		return;
	}
	const audio = context();
	if (audio === null) {
		return;
	}
	for (const note of notes) {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		osc.type = 'square';
		osc.frequency.value = note.freq;
		const start = audio.currentTime + note.at;
		// Ramp to zero rather than stopping flat, which clicks.
		gain.gain.setValueAtTime(0.06, start);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
		osc.connect(gain).connect(audio.destination);
		osc.start(start);
		osc.stop(start + note.dur);
	}
}
