<script lang="ts">
	import  { type ClientPlayer, type PlayerId } from '$lib/protocol';

	type Props = {
		players: ClientPlayer[];
		you: PlayerId | null;
		drawerId: PlayerId | null;
	};

	const { players, you, drawerId }: Props = $props();

	const sorted = $derived([...players].toSorted((a, b) => b.score - a.score));
</script>

<ul class="players">
	{#each sorted as p, i (p.id)}
		<li class="player" class:disconnected={!p.connected} class:guessed={p.guessedThisTurn}>
			<span class="rank">#{i + 1}</span>
			{#if p.avatar !== null}
				<img class="avatar" src={p.avatar} alt="" />
			{:else}
				<span class="avatar placeholder">{p.name.slice(0, 1).toUpperCase()}</span>
			{/if}
			<span class="who">
				<span class="name">
					{p.name}{#if p.id === you}<span class="you-tag"> (you)</span>{/if}{#if !p.connected}…{/if}
				</span>
				<span class="score">{p.score} pts</span>
			</span>
			<span class="badges">
				{#if p.isHost}<span class="crown" title="Host">♛</span>{/if}
				{#if p.id === drawerId}<span title="Drawing">✏️</span>{/if}
				{#if p.guessedThisTurn}<span class="check" title="Guessed it">✓</span>{/if}
			</span>
		</li>
	{/each}
</ul>

<style>
	.players {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.player {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-sm);
		background: var(--bg-soft);
		border: 1px solid transparent;
	}

	.player.guessed {
		background: var(--success-soft);
		border-color: rgb(74 222 128 / 0.25);
	}

	.player.disconnected {
		opacity: 0.45;
	}

	.rank {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-faint);
		min-width: 1.6rem;
	}

	.avatar {
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background: #ffffff;
		border: 1px solid var(--border-soft);
		flex-shrink: 0;
	}

	.avatar.placeholder {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-inset);
		color: var(--text-faint);
		font-weight: 700;
		font-size: 0.8rem;
	}

	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.name {
		font-weight: 600;
		font-size: 0.9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.you-tag {
		color: var(--text-muted);
		font-weight: 400;
		font-size: 0.8rem;
	}

	.score {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.badges {
		display: flex;
		gap: 0.25rem;
		font-size: 0.85rem;
	}

	.crown {
		color: var(--accent);
	}

	.check {
		color: var(--success);
		font-weight: 700;
	}
</style>
