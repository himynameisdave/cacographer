<script lang="ts">
	import { LIMITS, type ChatEntry } from '$lib/protocol';

	interface Props {
		entries: ChatEntry[];
		placeholder?: string;
		disabled?: boolean;
		onsend: (text: string) => void;
	}

	const { entries, placeholder = 'Say something…', disabled = false, onsend }: Props = $props();

	let listEl = $state<HTMLDivElement>();
	let draft = $state('');

	// Autoscroll — but only when the reader is already near the bottom, so
	// scrolling back through history isn't yanked away by new messages.
	$effect.pre(() => {
		void entries.length;
		const el = listEl;
		if (!el) {return;}
		const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
		if (nearBottom) {
			requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
		}
	});

	function submit(e: SubmitEvent): void {
		e.preventDefault();
		const text = draft.trim();
		if (!text) {return;}
		onsend(text);
		draft = '';
	}

	function nameColor(id: string | null): string {
		if (!id) {
			return 'var(--text-muted)';
		}
		let h = 0;
		for (let i = 0; i < id.length; i++) {
			h = (h * 31 + (id.codePointAt(i) ?? 0)) % 4_294_967_296;
		}
		return `hsl(${h % 360}, 65%, 72%)`;
	}
</script>

<div class="chat">
	<div class="messages" bind:this={listEl}>
		{#each entries as entry, i (i)}
			{#if entry.scope === 'system'}
				<div class="msg system">{entry.text}</div>
			{:else if entry.scope === 'guessed'}
				<div class="msg guessed">
					<span class="tag">🔒</span>
					<span class="name" style="color: {nameColor(entry.id)}">{entry.name}</span>
					<span class="text">{entry.text}</span>
				</div>
			{:else}
				<div class="msg">
					<span class="name" style="color: {nameColor(entry.id)}">{entry.name}</span>
					<span class="text">{entry.text}</span>
				</div>
			{/if}
		{/each}
	</div>
	<form class="composer" onsubmit={submit}>
		<input
			type="text"
			bind:value={draft}
			{placeholder}
			{disabled}
			maxlength={LIMITS.chat}
			autocomplete="off"
		/>
		<button type="submit" class="btn send" disabled={disabled || !draft.trim()}>➤</button>
	</form>
</div>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem;
		scrollbar-width: thin;
	}

	.msg {
		padding: 0.25rem 0.45rem;
		border-radius: 6px;
		font-size: 0.88rem;
		overflow-wrap: anywhere;
	}

	.msg .name {
		font-weight: 700;
		margin-right: 0.4rem;
	}

	.msg .name::after {
		content: ':';
		color: var(--text-faint);
	}

	.msg.system {
		color: var(--text-muted);
		font-style: italic;
		font-size: 0.8rem;
	}

	.msg.guessed {
		background: var(--success-soft);
	}

	.msg.guessed .tag {
		font-size: 0.7rem;
		margin-right: 0.3rem;
	}

	.composer {
		display: flex;
		gap: 0.4rem;
		padding: 0.5rem;
		border-top: 1px solid var(--border-soft);
	}

	.composer input {
		flex: 1;
		min-width: 0;
	}

	.send {
		padding: 0.55rem 0.8rem;
	}
</style>
