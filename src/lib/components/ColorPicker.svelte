<script module lang="ts">
	type PaletteColor = {
		readonly hex: string;
		readonly name: string;
	};

	const PALETTE: readonly PaletteColor[] = [
		{ hex: '#000000', name: 'Black' },
		{ hex: '#4d4d4d', name: 'Dark Gray' },
		{ hex: '#9c9c9c', name: 'Gray' },
		{ hex: '#ffffff', name: 'White' },
		{ hex: '#e53935', name: 'Red' },
		{ hex: '#f57c00', name: 'Orange' },
		{ hex: '#fdd835', name: 'Yellow' },
		{ hex: '#c0ca33', name: 'Lime' },
		{ hex: '#43a047', name: 'Green' },
		{ hex: '#00897b', name: 'Teal' },
		{ hex: '#00acc1', name: 'Cyan' },
		{ hex: '#1e88e5', name: 'Blue' },
		{ hex: '#3949ab', name: 'Indigo' },
		{ hex: '#8e24aa', name: 'Purple' },
		{ hex: '#ec407a', name: 'Pink' },
		{ hex: '#795548', name: 'Brown' }
	];
	// Doubles as the "is this hex one of the named swatches" membership check, so the active
	// swatch and the tooltip name always agree — even when a custom pick lands on a palette hex.
	const PALETTE_BY_HEX = new Map<string, string>();
	for (const c of PALETTE) {
		PALETTE_BY_HEX.set(c.hex, c.name);
	}
	const CUSTOM_NAME = 'Custom';
	const TOOLTIP_MS = 1100;
	const HEX_COLOR_RE = /^#[0-9a-f]{6}$/u;
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';

	type Props = {
		color: string;
		/** Whether `color` is the live drawing color (false while e.g. the eraser is selected). */
		active: boolean;
		onselect: (hex: string) => void;
	};

	const { color, active, onselect }: Props = $props();

	let showTooltip = $state(false);
	let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

	const isCustomActive = $derived(!PALETTE_BY_HEX.has(color));
	const tooltipName = $derived(PALETTE_BY_HEX.get(color) ?? CUSTOM_NAME);

	function clearTooltipTimer(): void {
		if (tooltipTimer !== null) {
			clearTimeout(tooltipTimer);
			tooltipTimer = null;
		}
	}

	function pick(hex: string): void {
		onselect(hex);
		showTooltip = true;
		clearTooltipTimer();
		tooltipTimer = setTimeout(() => {
			showTooltip = false;
			tooltipTimer = null;
		}, TOOLTIP_MS);
	}

	// <input type="color"> always yields a lowercase 6-digit hex — but a browser that doesn't
	// support it falls back to a plain text field, so treat the value as untrusted input.
	function onCustomInput(e: Event): void {
		const hex = (e.currentTarget as HTMLInputElement).value.toLowerCase();
		if (HEX_COLOR_RE.test(hex)) {
			pick(hex);
		}
	}

	onDestroy(clearTooltipTimer);
</script>

{#snippet tip(name: string)}
	<span class="tip" transition:fade={{ duration: 150 }}>{name}</span>
{/snippet}

<div class="swatches">
	{#each PALETTE as c (c.hex)}
		<div class="swatch-wrap">
			<button
				class="swatch"
				class:active={active && color === c.hex}
				style="background: {c.hex}"
				aria-label="Color {c.name} ({c.hex})"
				onclick={() => pick(c.hex)}
			></button>
			{#if showTooltip && active && color === c.hex}
				{@render tip(tooltipName)}
			{/if}
		</div>
	{/each}
	<div class="swatch-wrap">
		<div class="swatch custom-swatch" class:active={active && isCustomActive}>
			<input
				type="color"
				class="custom-input"
				aria-label="Custom color"
				value={color}
				oninput={onCustomInput}
			/>
		</div>
		{#if showTooltip && active && isCustomActive}
			{@render tip(tooltipName)}
		{/if}
	</div>
</div>

<style>
	.swatches {
		display: flex;
		column-gap: 0.3rem;
		row-gap: 2.25rem;
		flex-wrap: wrap;
	}

	.swatch-wrap {
		position: relative;
		display: inline-flex;
	}

	.swatch {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 2px solid var(--border);
		transition: transform 80ms ease;
	}

	.swatch:hover {
		transform: scale(1.15);
	}

	.swatch.active {
		border-color: var(--accent);
		transform: scale(1.15);
	}

	.custom-swatch {
		position: relative;
		overflow: hidden;
		padding: 0;
		cursor: pointer;
		background-color: #8e24aa;
		background: conic-gradient(#e53935, #fdd835, #43a047, #1e88e5, #8e24aa, #e53935);
	}

	.custom-swatch:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.custom-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: none;
		padding: 0;
		opacity: 0;
		cursor: pointer;
	}

	.tip {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-inset);
		border: 1px solid var(--border);
		color: var(--text);
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		pointer-events: none;
		z-index: 10;
	}

	.tip::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 4px solid transparent;
		border-top-color: var(--border);
	}
</style>
