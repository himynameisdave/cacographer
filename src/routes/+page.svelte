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
		'Nobody knows what that squiggle is. Not even you.',
		'Draw like nobody from HR is watching.',
		'Your art degree finally pays off. In points.',
		"That's not a cat. That was never a cat.",
		'The stick figure renaissance starts now.',
		'Gaslight. Gatekeep. Guess the word.',
		"It's giving abstract expressionism.",
		'Mother is drawing. Take notes.',
		'Your coworkers lie. The timer does not.',
		'Picasso had a blue period. You have 80 seconds.',
		'We saw what you drew. Not mad, just disappointed.',
		'Somebody in this room cannot draw hands. It is you.',
		'Confidence is drawing a circle and calling it done.',
		'The mouse was never meant for this.',
		'Zero artistic talent required. Clearly.',
		'This meeting could have been a doodle.',
		'Performance review: your triangle was mid.',
		"Draw like it's Q4 and your bonus depends on it.",
		'The real deliverable was the scribbles we made along the way.',
		'She is beauty, she is grace, she guessed it in your face.',
		'Category is: unrecognizable shapes.',
		'Less slack, more scribble.',
		'Take a break from pretending to work.',
		'Your KPIs cannot save you here.',
		'Bold of you to pick the hard word.',
		'Undo is a crutch. Use it anyway.',
		'Guess fast, apologize never.',
		'The drawing is bad on purpose. Sure it is.',
		'Ate that word. Left no crumbs.',
		'No thoughts, just squiggles.',
		'Corporate needs you to find the difference between your drawing and the word.',
		'Serving lines, dots, and delusion.',
		'Slay the timer before it slays you.',
		'Not you drawing the whole ocean for "boat".',
		'The audacity of that last guess? Iconic.',
		'Real artists ship. Cacographers submit.',
		'Circle. Circle. Smaller circle. "It\'s our CEO."',
		'Sketchy behavior, encouraged for once.',
		'Put the "art" in "quarterly targets". Somehow.',
		'You miss 100% of the guesses you spend typing "hmm".',
		'Werk of art. Emphasis on werk.',
		'Dazzle them. Or at least confuse them on purpose.',
		'The pen tool fears you. It should.',
		'Paint them a picture. A terrible, terrible picture.',
		"Dave can't spell too good, so don't lose to him.",
		'Close only counts in horseshoes and "restarant".',
		'You typed "girrafe" three times. The word was on screen.',
		'Spelling counts. Unfortunately.',
		'Its. It\'s. Whatever. Just guess faster.',
		'Autocorrect cannot reach you here. Godspeed.',
		'The word is "necessary". Good luck.',
		'One C, two S’s, zero chance.',
		'You spelled it wrong with the answer half-revealed.',
		'Whom among us can spell "bureaucracy" under pressure?',
		'Silent letters are the real opps.'
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
			<p class="sense"><span class="sense-num">2.</span> someone who can draw funny pictures</p>
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
			transform: scale(1) rotate(-1.2deg);
			opacity: 0.75;
		}
		50% {
			transform: scale(1.045) rotate(1.2deg);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.foot {
			animation: none;
		}
	}
</style>
