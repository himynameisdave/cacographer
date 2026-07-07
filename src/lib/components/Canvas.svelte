<script lang="ts">
	import { CANVAS_HEIGHT, CANVAS_WIDTH, type DrawOp } from '$lib/protocol';

	type Tool = 'pen' | 'fill' | 'eraser';

	type Props = {
		ops: DrawOp[];
		canDraw: boolean;
		color: string;
		size: number;
		tool: Tool;
		onop: (op: DrawOp) => void;
	};

	const { ops, canDraw, color, size, tool, onop }: Props = $props();

	const W = CANVAS_WIDTH;
	const H = CANVAS_HEIGHT;
	const FLUSH_MS = 40;
	const FILL_TOLERANCE = 32;

	let canvasEl = $state<HTMLCanvasElement>();
	let ctx: CanvasRenderingContext2D | null = null;

	// ---- Incremental render tracking -----------------------------------------
	// How much of `ops` is already on the canvas. If ops only grew (new ops, or
	// new points appended to the last stroke) we paint just the delta; anything
	// else (undo, clear, full resync) triggers a repaint from scratch.
	let paintedOps = 0;
	let paintedLastId = '';
	let paintedLastPoints = 0;

	$effect(() => {
		// Register reactive deps explicitly: op count + the tail stroke's point
		// count (the only op the server ever mutates in place).
		const count = ops.length;
		const last = count > 0 ? ops[count - 1] : null;
		if (last?.kind === 'stroke') {void last.points.length;}

		if (!canvasEl) {return;}
		if (!ctx) {
			ctx = canvasEl.getContext('2d');
			if (!ctx) {return;}
			fullRepaint();
			return;
		}

		if (needsFullRepaint()) {fullRepaint();}
		else {paintForward();}
	});

	function needsFullRepaint(): boolean {
		if (ops.length < paintedOps) {return true;}
		if (paintedOps === 0) {return false;}
		const op = ops[paintedOps - 1];
		if (!op || op.id !== paintedLastId) {return true;}
		if (op.kind === 'stroke' && op.points.length < paintedLastPoints) {return true;}
		return false;
	}

	function syncPainted(): void {
		paintedOps = ops.length;
		const last = ops.at(-1);
		paintedLastId = last?.id ?? '';
		paintedLastPoints = last?.kind === 'stroke' ? last.points.length : 0;
	}

	function fullRepaint(): void {
		if (!ctx) {return;}
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, W, H);
		for (const op of ops) {paintOp(op);}
		syncPainted();
	}

	function paintForward(): void {
		if (!ctx) {return;}
		if (paintedOps > 0) {
			const tail = ops[paintedOps - 1];
			if (tail?.kind === 'stroke' && tail.points.length > paintedLastPoints) {
				paintStroke(tail, paintedLastPoints);
			}
		}
		for (let i = paintedOps; i < ops.length; i++) {paintOp(ops[i]);}
		syncPainted();
	}

	function paintOp(op: DrawOp): void {
		if (op.kind === 'stroke') {paintStroke(op, 0);}
		else {paintFill(op.x, op.y, op.color);}
	}

	/** Paint a stroke's points from index `from` onward (0 = whole stroke). */
	function paintStroke(op: Extract<DrawOp, { kind: 'stroke' }>, from: number): void {
		if (!ctx) {return;}
		const pts = op.points;
		if (pts.length === 0) {return;}
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
		if (start >= pts.length) {return;}
		ctx.beginPath();
		ctx.moveTo(pts[start - 1][0] * W, pts[start - 1][1] * H);
		for (let i = start; i < pts.length; i++) {
			ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
		}
		ctx.stroke();
	}

	// ---- Flood fill -----------------------------------------------------------

	function hexToRgb(hex: string): [number, number, number] {
		let h = hex.replace('#', '');
		if (h.length === 3 || h.length === 4) {
			h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
		}
		const n = Number.parseInt(h.slice(0, 6), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	/** Scanline flood fill at normalized (nx, ny), tolerance per channel. */
	function paintFill(nx: number, ny: number, fillColor: string): void {
		if (!ctx) {return;}
		const sx = Math.min(W - 1, Math.max(0, Math.round(nx * W)));
		const sy = Math.min(H - 1, Math.max(0, Math.round(ny * H)));
		const img = ctx.getImageData(0, 0, W, H);
		const {data} = img;
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
			if (!match(i)) {continue;}
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

	// ---- Input ------------------------------------------------------------------

	let drawing = false;
	let currentId = '';
	let pending: [number, number][] = [];
	let lastLocal: [number, number] | null = null;
	let flushTimer: ReturnType<typeof setInterval> | null = null;

	function newId(): string {
		// randomUUID is unavailable in non-secure contexts (e.g. LAN play over http)
		return typeof crypto.randomUUID === 'function'
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10);
	}

	function strokeColor(): string {
		return tool === 'eraser' ? '#ffffff' : color;
	}

	function toNorm(e: PointerEvent): [number, number] {
		const rect = canvasEl!.getBoundingClientRect();
		const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
		return [x, y];
	}

	function flush(): void {
		if (!currentId || pending.length === 0) {return;}
		const points = pending;
		pending = [];
		onop({ kind: 'stroke', id: currentId, points, color: strokeColor(), size });
	}

	function onPointerDown(e: PointerEvent): void {
		if (!canDraw || !canvasEl || e.button !== 0) {return;}
		e.preventDefault();
		const [x, y] = toNorm(e);
		if (tool === 'fill') {
			onop({ kind: 'fill', id: newId(), x, y, color });
			return;
		}
		drawing = true;
		canvasEl.setPointerCapture(e.pointerId);
		currentId = newId();
		pending = [[x, y]];
		lastLocal = [x, y];
		// Local echo: paint the dot immediately; the same pixels get repainted
		// idempotently when the op lands in `ops`.
		if (ctx) {
			ctx.fillStyle = strokeColor();
			ctx.beginPath();
			ctx.arc(x * W, y * H, size / 2, 0, Math.PI * 2);
			ctx.fill();
		}
		flush(); // send the first point right away so peers see the stroke start
		flushTimer = setInterval(flush, FLUSH_MS);
	}

	function onPointerMove(e: PointerEvent): void {
		if (!drawing) {return;}
		if (!canDraw) {
			endStroke();
			return;
		}
		const [x, y] = toNorm(e);
		pending.push([x, y]);
		if (ctx && lastLocal) {
			ctx.strokeStyle = strokeColor();
			ctx.lineWidth = size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			ctx.moveTo(lastLocal[0] * W, lastLocal[1] * H);
			ctx.lineTo(x * W, y * H);
			ctx.stroke();
		}
		lastLocal = [x, y];
	}

	function endStroke(): void {
		if (!drawing) {return;}
		drawing = false;
		if (flushTimer !== null) {clearInterval(flushTimer);}
		flushTimer = null;
		flush();
		currentId = '';
		lastLocal = null;
	}

	// Lost the pen mid-stroke (turn ended, pointer cancelled, unmount) — flush what we have.
	$effect(() => {
		if (!canDraw) {endStroke();}
		return () => {
			if (flushTimer !== null) {clearInterval(flushTimer);}
			flushTimer = null;
		};
	});
</script>

<canvas
	bind:this={canvasEl}
	width={W}
	height={H}
	class:drawable={canDraw}
	class:fill-tool={canDraw && tool === 'fill'}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={endStroke}
	onpointercancel={endStroke}
></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 8px;
		background: #ffffff;
		touch-action: none;
		user-select: none;
	}

	canvas.drawable {
		cursor: crosshair;
	}

	canvas.fill-tool {
		cursor: cell;
	}
</style>
