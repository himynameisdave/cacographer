<script lang="ts">
	import { goto } from '$app/navigation';
	import { serverBase } from '$lib/realtime/urls';

	let codeInput = $state('');
	let creating = $state(false);
	let joining = $state(false);
	let createError = $state('');
	let joinError = $state('');

	async function createGame(): Promise<void> {
		creating = true;
		createError = '';
		try {
			const res = await fetch(`${serverBase()}/api/rooms`, { method: 'POST' });
			if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
			const { code } = (await res.json()) as { code: string };
			await goto(`/game/${code}`);
		} catch {
			createError = 'Could not create a game — is the server running?';
		} finally {
			creating = false;
		}
	}

	async function joinGame(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		joinError = '';
		const code = codeInput.trim().toUpperCase();
		if (code.length !== 5) {
			joinError = 'Room codes are 5 characters.';
			return;
		}
		joining = true;
		try {
			const res = await fetch(`${serverBase()}/api/rooms/${code}`);
			const info = res.ok ? ((await res.json()) as { exists: boolean }) : { exists: false };
			if (info.exists) {
				await goto(`/game/${code}`);
			} else {
				joinError = 'No game found with that code.';
			}
		} catch {
			joinError = 'Could not reach the server.';
		} finally {
			joining = false;
		}
	}

	function onCodeInput(e: Event): void {
		const el = e.currentTarget as HTMLInputElement;
		codeInput = el.value.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '').slice(0, 5);
		el.value = codeInput;
	}
</script>

<svelte:head>
	<title>Cacographer</title>
</svelte:head>

<main class="home">
	<header class="hero">
		<h1>Cacographer</h1>
		<p class="tagline">
			<span class="pron">/kəˈkɒɡ.rə.fər/</span>
			<span class="pos">noun</span>
			<span class="def">someone who is bad at spelling or handwriting</span>
		</p>
	</header>

	<div class="cards">
		<section class="card panel">
			<h2>New game</h2>
			<p class="hint">Start a room and invite your friends with a link.</p>
			<button class="btn btn-primary btn-lg" onclick={createGame} disabled={creating}>
				{creating ? 'Creating…' : 'Create game'}
			</button>
			{#if createError}<p class="error-text">{createError}</p>{/if}
		</section>

		<section class="card panel">
			<h2>Join a game</h2>
			<p class="hint">Got a 5-character room code? Enter it here.</p>
			<form class="join-form" onsubmit={joinGame}>
				<input
					type="text"
					class="code-input"
					placeholder="ABCDE"
					maxlength="5"
					value={codeInput}
					oninput={onCodeInput}
					autocomplete="off"
					spellcheck="false"
					aria-label="Room code"
				/>
				<button type="submit" class="btn btn-lg" disabled={joining || codeInput.length !== 5}>
					{joining ? 'Checking…' : 'Join'}
				</button>
			</form>
			{#if joinError}<p class="error-text">{joinError}</p>{/if}
		</section>
	</div>

	<footer class="foot">One player at a time is the artist, the rest are simple cacographers.</footer>
</main>

<style>
	.home {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2.5rem;
		padding: 2rem 1rem;
	}

	.hero {
		text-align: center;
	}

	h1 {
		font-size: clamp(2.6rem, 8vw, 4.2rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		background: linear-gradient(120deg, var(--accent) 30%, #f97316 100%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	/* Dictionary-entry tagline: pronunciation, part of speech, then the definition. */
	.tagline {
		margin-top: 0.4rem;
		color: var(--text-muted);
		font-size: 1rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: baseline;
		column-gap: 0.5rem;
	}

	.pron {
		font-family: var(--mono);
		font-size: 0.9rem;
		color: var(--text-faint);
	}

	.pos {
		font-style: italic;
		color: var(--text-faint);
	}

	.def {
		font-style: italic;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 320px));
		justify-content: center;
		gap: 1.25rem;
		width: 100%;
		max-width: 720px;
	}

	.panel {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		align-items: stretch;
		text-align: center;
	}

	.panel h2 {
		font-size: 1.15rem;
	}

	.join-form {
		display: flex;
		gap: 0.5rem;
	}

	.code-input {
		flex: 1;
		min-width: 0;
		text-align: center;
		font-family: var(--mono);
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: 0.35em;
		text-transform: uppercase;
	}

	.foot {
		color: var(--text-faint);
		font-size: 0.85rem;
	}
</style>
