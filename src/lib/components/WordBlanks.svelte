<script lang="ts">
	import  { type Phase } from '$lib/protocol';

	type Props = {
		masked: string | null;
		word: string | null; // drawer only
		phase: Phase;
	};

	const { masked, word, phase }: Props = $props();

	const display = $derived(phase === 'drawing' ? (word ?? masked) : null);
	const isDrawer = $derived(word !== null);
	const counts = $derived(
		display
			? display
					.split(' ')
					.filter(Boolean)
					.map((w) => w.length)
					.join(' · ')
			: ''
	);
</script>

{#if display}
	<div class="wordblanks">
		{#if isDrawer}
			<span class="label">draw:</span>
		{/if}
		<span class="blanks">
			{#each display.split('') as ch, i (i)}
				{#if ch === ' '}
					<span class="gap"></span>
				{:else if ch === '_'}
					<span class="slot"></span>
				{:else}
					<span class="slot revealed">{ch}</span>
				{/if}
			{/each}
		</span>
		<span class="count">{counts}</span>
	</div>
{/if}

<style>
	.wordblanks {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		font-family: var(--mono);
	}

	.label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.blanks {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.slot {
		display: inline-block;
		min-width: 1ch;
		text-align: center;
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.2;
		border-bottom: 2px solid var(--text-muted);
		text-transform: uppercase;
	}

	.slot.revealed {
		border-bottom-color: var(--accent);
	}

	.gap {
		display: inline-block;
		width: 1rem;
	}

	.count {
		font-size: 0.7rem;
		color: var(--text-faint);
	}
</style>
