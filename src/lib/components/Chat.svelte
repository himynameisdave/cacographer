<script lang="ts">
	import { type PlayerIdentity } from '$lib/game.svelte';
	import { playerColor } from '$lib/identity';
	import { LIMITS, type ChatEntry, type PlayerId } from '$lib/protocol';

	type Props = {
		entries: ChatEntry[];
		/** Per-player avatar + picked name color, looked up by chat entry sender id. */
		identities: Readonly<Record<PlayerId, PlayerIdentity>>;
		placeholder?: string;
		disabled?: boolean;
		onsend: (text: string) => void;
	};

	const {
		entries,
		identities,
		placeholder = 'Say something…',
		disabled = false,
		onsend
	}: Props = $props();

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
		return playerColor(id, identities[id]?.color ?? null);
	}

	function avatarFor(id: string | null): string | null {
		return id === null ? null : (identities[id]?.avatar ?? null);
	}
</script>

<div class="chat">
	<div class="messages" bind:this={listEl}>
		{#each entries as entry, i (i)}
			{#if entry.scope === 'system'}
				<div class="msg system">{entry.text}</div>
			{:else}
				{@const avatar = avatarFor(entry.id)}
				<div class="msg" class:guessed={entry.scope === 'guessed'}>
					{#if entry.scope === 'guessed'}<span class="tag">🔒</span>{/if}
					{#if avatar !== null}
						<img class="avatar" src={avatar} alt="" />
					{:else}
						<span class="avatar placeholder" style="background: {nameColor(entry.id)}">
							{entry.name.slice(0, 1).toUpperCase()}
						</span>
					{/if}
					<span class="name" style="color: {nameColor(entry.id)}">{entry.name}</span>
					<span class="text" class:filtered={entry.filtered === true}>{entry.text}</span>
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
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.45rem;
		border-radius: 6px;
		font-size: 0.88rem;
		overflow-wrap: anywhere;
	}

	.msg .avatar {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		background: #ffffff;
		border: 1px solid var(--border-soft);
		flex-shrink: 0;
	}

	/* Background is the sender's name color, set inline. */
	.msg .avatar.placeholder {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgb(20 20 28 / 0.85);
		font-weight: 800;
		font-size: 0.7rem;
	}

	.msg .name {
		font-weight: 700;
	}

	.msg .text {
		min-width: 0;
	}

	/* The server swapped a profane message for a potty-mouth phrase. */
	.msg .text.filtered {
		font-style: italic;
		color: var(--text-muted);
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
