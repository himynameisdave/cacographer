<script lang="ts">
	import { CANVAS_HEIGHT, CANVAS_WIDTH, type DrawOp } from '$lib/protocol';
	import { paintOp, paintStroke, replayOps } from '$lib/render';

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
		replayOps(ctx, ops);
		syncPainted();
	}

	function paintForward(): void {
		if (!ctx) {return;}
		if (paintedOps > 0) {
			const tail = ops[paintedOps - 1];
			if (tail?.kind === 'stroke' && tail.points.length > paintedLastPoints) {
				paintStroke(ctx, tail, paintedLastPoints);
			}
		}
		for (let i = paintedOps; i < ops.length; i++) {paintOp(ctx, ops[i]);}
		syncPainted();
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
	class:eraser-tool={canDraw && tool === 'eraser'}
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
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M17 3L7.5 12.5 5 17l2-1 4.5-2.5L21 4z' fill='none' stroke='%23333' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M5 17c-1 2 0 4 0 4s2 1 4 0' fill='none' stroke='%2369f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")
				4 22,
			crosshair;
	}

	canvas.eraser-tool {
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='10' fill='none' stroke='%23666' stroke-width='2'/%3E%3C/svg%3E")
				12 12,
			crosshair;
	}
</style>
