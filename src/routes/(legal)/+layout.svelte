<script lang="ts">
	import type { Snippet } from 'svelte';

	const { children }: { children: Snippet } = $props();
</script>

<main class="legal">
	<div class="legal-inner">
		<a class="back" href="/">← Cacographer</a>
		{@render children()}
	</div>
</main>

<style>
	.legal {
		min-height: 100dvh;
		display: flex;
		justify-content: center;
		padding: 2.5rem 1rem 4rem;
	}

	.legal-inner {
		width: min(44rem, 100%);
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.back {
		align-self: flex-start;
		color: var(--text-muted);
		font-size: 0.9rem;
		text-decoration: none;
	}

	.back:hover {
		color: var(--accent);
	}
</style>
