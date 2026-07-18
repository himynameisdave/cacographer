<script lang="ts">
	import { goto } from '$app/navigation';
	import { serverBase } from '$lib/realtime/urls';

	/** Minecraft-style splash lines — one is picked at random per page load. */
	const SPLASHES = [
		'Each round, one artist. The rest of you? Cacographers.',
		'One of you draws. The rest guess like the cacographers you are.',
		'See also: your coworkers, guessing wildly at your terrible drawing.',
		'Take turns drawing badly. Guess accordingly.',
		'Warning: contains coworkers who cannot draw.',
		'The word was obvious. Your drawing was not.',
		"Is it a horse? A dog? It was 'submarine'.",
		"Art school dropout? You'll fit right in.",
		'Pictionary for people with keyboards and grudges.',
		'Nobody knows what that squiggle is. Not even you.'
	];
	const splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];

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
		<div class="entry">
			<div class="entry-head">
				<h1 class="headword">ca·cog·ra·pher</h1>
				<span class="pron">/kəˈkɒɡ.rə.fər/</span>
			</div>
			<p class="pos">noun</p>
			<p class="sense"><span class="sense-num">1.</span> someone who is bad at spelling or handwriting</p>
			<p class="sense sense-alive"><span class="sense-num">2.</span> someone who can draw funny pictures</p>
		</div>
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

	<footer class="foot">{splash}</footer>
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

	/* Same width as .cards below so the hero entry sits on the same grid lines. */
	.hero {
		width: min(44rem, 100%);
	}

	/* The hero IS the dictionary entry, set like a page out of a real dictionary:
	   serif headword with syllable dots, pronunciation, part of speech, numbered sense. */
	.entry {
		--serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
		width: 100%;
		text-align: left;
		font-family: var(--serif);
		background: var(--bg-soft);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 1.75rem 2rem 2rem;
	}

	.entry-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 1rem;
	}

	.headword {
		font-family: var(--serif);
		font-weight: 700;
		font-size: clamp(2.2rem, 7vw, 3.4rem);
		letter-spacing: 0.01em;
		background: linear-gradient(120deg, var(--accent) 30%, #f97316 100%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.pron {
		color: var(--text-faint);
		font-size: 1.25rem;
	}

	.pos {
		font-style: italic;
		color: var(--text-muted);
		font-size: 1.2rem;
		margin-top: 0.3rem;
	}

	.sense {
		margin-top: 0.6rem;
		color: var(--text-muted);
		font-size: 1.35rem;
		line-height: 1.45;
	}

	.sense-num {
		font-weight: 700;
		color: var(--text);
	}

	/* Sense 2 is the joke — let it breathe and wobble so it reads as the punchline. */
	.sense-alive {
		width: fit-content;
		transform-origin: left center;
		animation: sense-wobble 2.2s ease-in-out infinite;
	}

	@keyframes sense-wobble {
		0%,
		100% {
			transform: scale(1) rotate(-0.8deg);
		}
		50% {
			transform: scale(1.04) rotate(0.8deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sense-alive {
			animation: none;
		}
	}

	/* Same width as .entry above so the outer edges line up as one grid. */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		justify-content: center;
		gap: 1.25rem;
		width: min(44rem, 100%);
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
		color: var(--text-muted);
		font-size: 1.1rem;
		text-align: center;
		animation: splash-pulse 1.8s ease-in-out infinite;
	}

	@keyframes splash-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.75;
		}
		50% {
			transform: scale(1.045);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.foot {
			animation: none;
		}
	}
</style>
