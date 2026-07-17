<script module lang="ts">
	/** Logical avatar resolution — drawn here at a few rem, rendered ~1rem in chat. */
	const SIZE = 96;
	const BRUSH = 6;
</script>

<script lang="ts">
	import ColorPicker from '$lib/components/ColorPicker.svelte';

	type Props = {
		/** Previously saved avatar (PNG data URL) to start from, if any. Read once. */
		initial: string | null;
		/** Fires with a fresh PNG data URL after every stroke, or null when cleared. */
		onchange: (dataUrl: string | null) => void;
	};

	const { initial, onchange }: Props = $props();

	let canvasEl = $state<HTMLCanvasElement>();
	let ctx: CanvasRenderingContext2D | null = null;
	let color = $state('#000000');
	let drawing = false;
	let last: [number, number] | null = null;
	/** A never-drawn-on (or cleared) canvas means "no avatar", not a white square. */
	let hasInk = false;

	$effect(() => {
		if (!canvasEl || ctx) {
			return;
		}
		ctx = canvasEl.getContext('2d');
		if (!ctx) {
			return;
		}
		blank();
		if (initial !== null) {
			const img = new Image();
			img.addEventListener('load', () => {
				ctx?.drawImage(img, 0, 0, SIZE, SIZE);
				hasInk = true;
			});
			img.src = initial;
		}
	});

	function blank(): void {
		if (!ctx) {
			return;
		}
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, SIZE, SIZE);
	}

	function toLocal(e: PointerEvent): [number, number] {
		const rect = canvasEl!.getBoundingClientRect();
		const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
		return [x * SIZE, y * SIZE];
	}

	function onPointerDown(e: PointerEvent): void {
		if (!canvasEl || !ctx || e.button !== 0) {
			return;
		}
		e.preventDefault();
		canvasEl.setPointerCapture(e.pointerId);
		drawing = true;
		last = toLocal(e);
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(last[0], last[1], BRUSH / 2, 0, Math.PI * 2);
		ctx.fill();
		hasInk = true;
	}

	function onPointerMove(e: PointerEvent): void {
		if (!drawing || !ctx || last === null) {
			return;
		}
		const p = toLocal(e);
		ctx.strokeStyle = color;
		ctx.lineWidth = BRUSH;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(last[0], last[1]);
		ctx.lineTo(p[0], p[1]);
		ctx.stroke();
		last = p;
	}

	function endStroke(): void {
		if (!drawing) {
			return;
		}
		drawing = false;
		last = null;
		emit();
	}

	function clear(): void {
		blank();
		hasInk = false;
		emit();
	}

	function emit(): void {
		if (!canvasEl) {
			return;
		}
		onchange(hasInk ? canvasEl.toDataURL('image/png') : null);
	}
</script>

<div class="editor">
	<canvas
		bind:this={canvasEl}
		width={SIZE}
		height={SIZE}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={endStroke}
		onpointercancel={endStroke}
	></canvas>
	<div class="tools">
		<ColorPicker {color} active={true} onselect={(hex) => (color = hex)} />
		<button type="button" class="btn" onclick={clear}>Clear</button>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
	}

	canvas {
		width: 8rem;
		height: 8rem;
		border-radius: var(--radius-sm);
		background: #ffffff;
		border: 1px solid var(--border);
		cursor: crosshair;
		touch-action: none;
		user-select: none;
	}

	.tools {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
</style>
