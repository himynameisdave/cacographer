<script lang="ts">
	import { type Snippet } from 'svelte';

	type Props = {
		title: string;
		updated: string;
		children: Snippet;
	};

	const { title, updated, children }: Props = $props();
</script>

<article class="doc">
	<h1>{title}</h1>
	<p class="updated">Last updated {updated}</p>
	{@render children()}
</article>

<style>
	.doc {
		--serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: var(--bg-soft);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 1.75rem 2rem 2rem;
	}

	h1 {
		font-family: var(--serif);
		font-weight: 700;
		font-size: clamp(1.7rem, 6vw, 2.3rem);
	}

	.updated {
		color: var(--text-faint);
		font-size: 0.85rem;
	}

	.doc :global(h2) {
		margin-top: 0.5rem;
		font-size: 1.05rem;
		color: var(--text);
	}

	.doc :global(p),
	.doc :global(li) {
		color: var(--text-muted);
		line-height: 1.6;
	}

	.doc :global(ul) {
		margin: 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.doc :global(strong) {
		color: var(--text);
	}

	.doc :global(code) {
		font-family: var(--mono);
		background: var(--bg-inset);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.9em;
	}

	.doc :global(.disclaimer) {
		color: var(--text-faint);
		font-size: 0.8rem;
		font-style: italic;
		margin-top: 0.5rem;
	}
</style>
