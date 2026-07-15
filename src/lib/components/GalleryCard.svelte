<script lang="ts">
	import { CANVAS_HEIGHT, CANVAS_WIDTH, type GalleryEntry } from '$lib/protocol';
	import { replayOps } from '$lib/render';

	type Props = {
		label: string;
		entry: GalleryEntry;
	};

	const { label, entry }: Props = $props();

	let canvasEl = $state<HTMLCanvasElement>();

	$effect(() => {
		const ctx = canvasEl?.getContext('2d');
		if (ctx) {replayOps(ctx, entry.ops);}
	});

	function savePng(): void {
		canvasEl?.toBlob((blob) => {
			if (!blob) {return;}
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `cacographer-${entry.word}.png`;
			a.click();
			URL.revokeObjectURL(url);
		});
	}
</script>

<figure class="gallery-card">
	<figcaption class="g-label">{label}</figcaption>
	<canvas bind:this={canvasEl} width={CANVAS_WIDTH} height={CANVAS_HEIGHT}></canvas>
	<div class="g-meta">
		<span class="g-word">“{entry.word}”</span>
		<span class="g-by">by {entry.drawerName}</span>
	</div>
	<div class="g-foot">
		<span class="g-votes">👍 {entry.likes} · 👎 {entry.dislikes}</span>
		<button class="btn" onclick={savePng}>Save PNG</button>
	</div>
</figure>

<style>
	.gallery-card {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		background: var(--bg-soft);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 0.75rem;
		width: min(16rem, 100%);
		text-align: left;
	}

	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 6px;
		background: #ffffff;
	}

	.g-label {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.g-meta {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}

	.g-word {
		font-weight: 700;
		color: var(--accent);
	}

	.g-by {
		color: var(--text-muted);
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.g-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.g-votes {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
</style>
