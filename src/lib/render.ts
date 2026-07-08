/**
 * Canvas painting for draw-op logs, shared by the live game canvas and the
 * end-of-game gallery thumbnails. Everything paints at the fixed logical
 * resolution (CANVAS_WIDTH × CANVAS_HEIGHT) — callers scale via CSS.
 */
/* Painting works by mutating the passed 2d context in place; there is no readonly
   CanvasRenderingContext2D that could satisfy prefer-readonly-parameter-types. */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- see comment above */
import { CANVAS_HEIGHT, CANVAS_WIDTH, type DrawOp } from '$lib/protocol';

const W = CANVAS_WIDTH;
const H = CANVAS_HEIGHT;
const FILL_TOLERANCE = 32;

/** Paint one op onto the context. */
export function paintOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
	if (op.kind === 'stroke') {
		paintStroke(ctx, op, 0);
	} else {
		paintFill(ctx, op.x, op.y, op.color);
	}
}

/** Repaint a whole op log from scratch: white canvas, then every op in order. */
export function replayOps(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]): void {
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, W, H);
	for (const op of ops) {
		paintOp(ctx, op);
	}
}

/** Paint a stroke's points from index `from` onward (0 = whole stroke). */
export function paintStroke(
	ctx: CanvasRenderingContext2D,
	op: Extract<DrawOp, { kind: 'stroke' }>,
	from: number
): void {
	const pts = op.points;
	if (pts.length === 0) {
		return;
	}
	ctx.strokeStyle = op.color;
	ctx.fillStyle = op.color;
	ctx.lineWidth = op.size;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	if (pts.length === 1) {
		ctx.beginPath();
		ctx.arc(pts[0][0] * W, pts[0][1] * H, op.size / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	const start = Math.max(1, from);
	if (start >= pts.length) {
		return;
	}
	ctx.beginPath();
	ctx.moveTo(pts[start - 1][0] * W, pts[start - 1][1] * H);
	for (let i = start; i < pts.length; i++) {
		ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
	}
	ctx.stroke();
}

function hexToRgb(hex: string): [number, number, number] {
	let h = hex.replace('#', '');
	if (h.length === 3 || h.length === 4) {
		h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
	}
	const n = Number.parseInt(h.slice(0, 6), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Scanline flood fill at normalized (nx, ny), tolerance per channel. */
function paintFill(ctx: CanvasRenderingContext2D, nx: number, ny: number, fillColor: string): void {
	const sx = Math.min(W - 1, Math.max(0, Math.round(nx * W)));
	const sy = Math.min(H - 1, Math.max(0, Math.round(ny * H)));
	const img = ctx.getImageData(0, 0, W, H);
	const { data } = img;
	const [fr, fg, fb] = hexToRgb(fillColor);
	const si = (sy * W + sx) * 4;
	const tr = data[si];
	const tg = data[si + 1];
	const tb = data[si + 2];
	// Filling with (roughly) the color already there would loop forever.
	if (
		Math.abs(tr - fr) <= FILL_TOLERANCE &&
		Math.abs(tg - fg) <= FILL_TOLERANCE &&
		Math.abs(tb - fb) <= FILL_TOLERANCE
	) {
		return;
	}
	const match = (i: number) =>
		Math.abs(data[i] - tr) <= FILL_TOLERANCE &&
		Math.abs(data[i + 1] - tg) <= FILL_TOLERANCE &&
		Math.abs(data[i + 2] - tb) <= FILL_TOLERANCE;

	const stack: number[] = [sx, sy];
	// Track a span-neighbor row: push a seed only once per contiguous run.
	const trackSpan = (matches: boolean, active: boolean, px: number, py: number): boolean => {
		if (!matches) {
			return false;
		}
		if (!active) {
			stack.push(px, py);
		}
		return true;
	};
	let guard = W * H * 4; // safety cap on iterations
	while (stack.length > 0 && guard-- > 0) {
		const y = stack.pop()!;
		let x = stack.pop()!;
		let i = (y * W + x) * 4;
		if (!match(i)) {
			continue;
		}
		while (x > 0 && match(i - 4)) {
			x--;
			i -= 4;
		}
		let spanUp = false;
		let spanDown = false;
		while (x < W && match(i)) {
			data[i] = fr;
			data[i + 1] = fg;
			data[i + 2] = fb;
			data[i + 3] = 255;
			if (y > 0) {
				spanUp = trackSpan(match(i - W * 4), spanUp, x, y - 1);
			}
			if (y < H - 1) {
				spanDown = trackSpan(match(i + W * 4), spanDown, x, y + 1);
			}
			x++;
			i += 4;
		}
	}
	ctx.putImageData(img, 0, 0);
}
