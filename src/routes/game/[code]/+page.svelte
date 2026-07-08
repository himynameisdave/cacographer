<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { LIMITS, type DrawOp, type Settings, type VoteKind } from '$lib/protocol';
	import { GameSocket } from '$lib/realtime/client';
	import { wsUrl } from '$lib/realtime/urls';
	import { GameState } from '$lib/game.svelte';
	import Canvas from '$lib/components/Canvas.svelte';
	import Chat from '$lib/components/Chat.svelte';
	import GalleryCard from '$lib/components/GalleryCard.svelte';
	import PlayerList from '$lib/components/PlayerList.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import Timer from '$lib/components/Timer.svelte';
	import WordBlanks from '$lib/components/WordBlanks.svelte';

	const NAME_KEY = 'cacographer:name';
	const COLORS = [
		'#000000',
		'#4d4d4d',
		'#9c9c9c',
		'#ffffff',
		'#e53935',
		'#f57c00',
		'#fdd835',
		'#43a047',
		'#00acc1',
		'#1e88e5',
		'#8e24aa',
		'#ec407a',
		'#795548'
	];
	const SIZES = [4, 8, 14, 24];

	const code = $derived((page.params.code ?? '').toUpperCase());

	const gs = new GameState();
	let socket: GameSocket | null = null;
	let joinName = ''; // the name we (re)join with; not reactive on purpose

	let nameInput = $state(localStorage.getItem(NAME_KEY) ?? '');
	let submittedName = $state(false);
	let copied = $state(false);

	// Drawer tool state
	let color = $state('#000000');
	let size = $state(8);
	let tool = $state<'pen' | 'fill' | 'eraser'>('pen');

	const room = $derived(gs.room);
	const fatal = $derived(gs.fatalError);
	const deadEnd = $derived(
		fatal !== null && (fatal.code === 'room_not_found' || fatal.code === 'room_full')
	);
	const showNameGate = $derived(!deadEnd && (!submittedName || fatal?.code === 'name_taken'));
	const connectedCount = $derived(room?.players.filter((p) => p.connected).length ?? 0);
	const hostName = $derived(room?.players.find((p) => p.isHost)?.name ?? 'the host');
	const canDraw = $derived(room?.phase === 'drawing' && gs.isDrawer);

	const chatPlaceholder = $derived.by(() => {
		if (room?.phase !== 'drawing') {return 'Say something…';}
		if (gs.isDrawer) {return 'Chat (only guessers who got it will see)…';}
		if (gs.me?.guessedThisTurn) {return 'You got it! Chat with the others…';}
		return 'Type your guess…';
	});

	const revealGains = $derived.by(() => {
		if (!room?.lastGains) {return [];}
		const gains = room.lastGains;
		return room.players
			.map((p) => ({ player: p, gain: gains[p.id] ?? 0 }))
			.toSorted((a, b) => b.gain - a.gain);
	});

	function joinRoom(): void {
		const name = nameInput.trim().slice(0, LIMITS.name);
		if (!name) {return;}
		joinName = name;
		localStorage.setItem(NAME_KEY, name);
		submittedName = true;
		gs.fatalError = null;

		socket?.close();
		const ws = new GameSocket(wsUrl(), {
			onMessage: (msg) => {
				gs.apply(msg);
				// Join failures make the server close the socket — don't fight it
				// with reconnect attempts that would just fail the same way.
				if (gs.fatalError) {ws.close();}
			},
			onStatus: (s) => {
				gs.status = s;
				// Covers both first connect and every auto-reconnect: the first
				// message on a fresh socket must be the join.
				if (s === 'open') {ws.send({ type: 'join', code, name: joinName });}
			}
		});
		socket = ws;
		ws.connect();
	}

	function onGateSubmit(e: SubmitEvent): void {
		e.preventDefault();
		joinRoom();
	}

	onDestroy(() => socket?.close());

	// ---- Actions ----

	function sendChat(text: string): void {
		if (!socket || !room) {return;}
		if (room.phase === 'drawing' && !gs.isDrawer) {socket.send({ type: 'guess', text });}
		else {socket.send({ type: 'chat', text });}
	}

	function handleOp(op: DrawOp): void {
		socket?.send({ type: 'draw', op });
		// The server doesn't echo our own ops — mirror them locally so the
		// canvas renders everything through the one shared path.
		gs.applyDraw(op);
	}

	function updateSettings(partial: Partial<Settings>): void {
		socket?.send({ type: 'updateSettings', settings: partial });
	}

	function isTextInput(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (!canDraw || !socket || isTextInput(e.target)) {
			return;
		}
		if ((e.metaKey || e.ctrlKey) && !e.altKey) {
			// Shift+Z reports as uppercase 'Z' — compare case-insensitively or
			// the redo chord never matches.
			const key = e.key.toLowerCase();
			if (key === 'z' && !e.shiftKey) {
				e.preventDefault();
				socket.send({ type: 'undo' });
			} else if ((key === 'z' && e.shiftKey) || key === 'y') {
				e.preventDefault();
				socket.send({ type: 'redo' });
			}
		}
	}

	function vote(kind: VoteKind): void {
		gs.myVote = kind;
		socket?.send({ type: 'vote', vote: kind });
	}

	async function copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(location.href);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard unavailable (permissions/http) — nothing sensible to do.
		}
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<svelte:head>
	<title>{code ? `${code} · ` : ''}Cacographer</title>
</svelte:head>

{#if deadEnd}
	<main class="center-screen">
		<div class="card gate-card">
			<h1 class="brand">Cacographer</h1>
			<p class="error-text big">
				{fatal?.code === 'room_full' ? 'That room is full.' : 'That room doesn’t exist (anymore).'}
			</p>
			<a class="btn btn-primary" href="/">Back home</a>
		</div>
	</main>
{:else if showNameGate}
	<main class="center-screen">
		<div class="card gate-card">
			<h1 class="brand">Cacographer</h1>
			<p class="hint">Joining room <b class="code-chip">{code}</b></p>
			{#if fatal?.code === 'name_taken'}
				<p class="error-text">That name is taken — try another.</p>
			{/if}
			<form class="gate-form" onsubmit={onGateSubmit}>
				<input
					type="text"
					placeholder="Your name"
					maxlength={LIMITS.name}
					bind:value={nameInput}
					autocomplete="off"
				/>
				<button type="submit" class="btn btn-primary" disabled={!nameInput.trim()}>
					Join game
				</button>
			</form>
		</div>
	</main>
{:else if !room}
	<main class="center-screen">
		<div class="card gate-card">
			<h1 class="brand">Cacographer</h1>
			<p class="hint">
				{gs.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
			</p>
		</div>
	</main>
{:else}
	{#if gs.status === 'reconnecting' || gs.status === 'connecting'}
		<div class="reconnect-banner">Connection lost — reconnecting…</div>
	{/if}

	<main class="game">
		<aside class="col left">
			<div class="card side-card">
				<div class="side-head">
					<span class="room-chip">{room.code}</span>
					{#if room.phase !== 'lobby'}
						<span class="round-chip">Round {room.round}/{room.settings.rounds}</span>
					{/if}
				</div>
				<PlayerList players={room.players} you={gs.you} drawerId={room.drawerId} />
			</div>
		</aside>

		<section class="col middle">
			{#if room.phase === 'lobby'}
				<div class="card lobby">
					<p class="lobby-label">Room code</p>
					<div class="lobby-code-row">
						<span class="lobby-code">{room.code}</span>
						<button class="btn" onclick={copyLink}>{copied ? 'Copied!' : 'Copy link'}</button>
					</div>
					<div class="lobby-settings">
						<SettingsPanel settings={room.settings} isHost={gs.isHost} onupdate={updateSettings} />
					</div>
					{#if gs.isHost}
						<button
							class="btn btn-primary btn-lg"
							disabled={connectedCount < 2}
							onclick={() => socket?.send({ type: 'startGame' })}
						>
							Start game
						</button>
						{#if connectedCount < 2}
							<p class="hint">Need at least 2 connected players to start.</p>
						{/if}
					{:else}
						<p class="hint">Waiting for {hostName} to start the game…</p>
					{/if}
				</div>
			{:else}
				<div class="topbar card">
					{#if room.phase === 'drawing'}
						<WordBlanks masked={room.masked} word={gs.word} phase={room.phase} />
					{:else if room.phase === 'choosing'}
						<span class="topbar-note">
							{gs.isDrawer ? 'Your turn to draw!' : `${gs.drawer?.name ?? 'Someone'} is up…`}
						</span>
					{:else if room.phase === 'reveal'}
						<span class="topbar-note">Round over…</span>
					{:else}
						<span class="topbar-note">Final results</span>
					{/if}
					<Timer endsAt={room.phase === 'finished' ? null : (gs.choices?.endsAt ?? room.endsAt)} />
				</div>

				<div class="board">
					<Canvas ops={room.ops} {canDraw} {color} {size} {tool} onop={handleOp} />

					{#if gs.closeFlash}
						<div class="close-flash">So close!</div>
					{/if}

					{#if room.phase === 'choosing'}
						<div class="overlay">
							{#if gs.isDrawer && gs.choices}
								<h2>Pick a word</h2>
								<div class="word-choices">
									{#each gs.choices.words as w (w)}
										<button
											class="btn btn-primary"
											onclick={() => socket?.send({ type: 'chooseWord', word: w })}
										>
											{w}
										</button>
									{/each}
								</div>
							{:else}
								<h2>{gs.drawer?.name ?? 'Someone'} is choosing a word…</h2>
							{/if}
						</div>
					{:else if room.phase === 'reveal'}
						<div class="overlay">
							{#if room.lastWord}
								<h2>The word was <b class="reveal-word">{room.lastWord}</b></h2>
							{:else}
								<h2>Turn skipped</h2>
							{/if}
							<ul class="gains">
								{#each revealGains as g (g.player.id)}
									<li class:dim={g.gain === 0}>
										<span class="g-name">{g.player.name}</span>
										<span class="g-pts">+{g.gain}</span>
									</li>
								{/each}
							</ul>
							<!-- A snapshot exists exactly when a word was revealed onto a non-blank canvas. -->
							{#if room.lastWord && room.ops.length > 0}
								<div class="vote-row">
									{#if gs.isDrawer}
										<span class="vote-pill">👍 {gs.voteCounts.likes}</span>
										<span class="vote-pill">👎 {gs.voteCounts.dislikes}</span>
									{:else}
										<button
											class="vote-pill vote-btn"
											class:active={gs.myVote === 'like'}
											onclick={() => vote('like')}
										>
											👍 {gs.voteCounts.likes}
										</button>
										<button
											class="vote-pill vote-btn"
											class:active={gs.myVote === 'dislike'}
											onclick={() => vote('dislike')}
										>
											👎 {gs.voteCounts.dislikes}
										</button>
									{/if}
								</div>
							{/if}
						</div>
					{:else if room.phase === 'finished'}
						<div class="overlay solid">
							<h2>🎉 Game over!</h2>
							<ol class="final">
								{#each gs.playersByScore as p, i (p.id)}
									<li class:winner={p.id === room.winnerId}>
										<span class="medal">
											{p.id === room.winnerId ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
										</span>
										<span class="f-name">{p.name}</span>
										<span class="f-score">{p.score}</span>
									</li>
								{/each}
							</ol>
							{#if room.gallery}
								{@const g = room.gallery}
								{#if g.best || g.worst}
									<div class="gallery-row">
										{#if g.best}
											<GalleryCard label="Most liked" entry={g.best} />
										{/if}
										{#if g.worst}
											<GalleryCard label="Most disliked" entry={g.worst} />
										{/if}
									</div>
								{/if}
							{/if}
							{#if gs.isHost}
								<button class="btn btn-primary" onclick={() => socket?.send({ type: 'playAgain' })}>
									Play again
								</button>
							{:else}
								<p class="hint">Waiting for {hostName} to start another game…</p>
							{/if}
						</div>
					{/if}
				</div>

				{#if canDraw}
					<div class="toolbar card">
						<div class="swatches">
							{#each COLORS as c (c)}
								<button
									class="swatch"
									class:active={color === c && tool !== 'eraser'}
									style="background: {c}"
									aria-label="Color {c}"
									onclick={() => {
										color = c;
										if (tool === 'eraser') tool = 'pen';
									}}
								></button>
							{/each}
						</div>
						<div class="tool-group">
							{#each SIZES as s (s)}
								<button
									class="tool-btn"
									class:active={size === s}
									aria-label="Brush size {s}"
									onclick={() => (size = s)}
								>
									<span
										class="size-dot"
										style="width: {4 + s * 0.55}px; height: {4 + s * 0.55}px"
									></span>
								</button>
							{/each}
						</div>
						<div class="tool-group">
							<button
								class="tool-btn"
								class:active={tool === 'pen'}
								title="Pen"
								onclick={() => (tool = 'pen')}>✏️</button
							>
							<button
								class="tool-btn"
								class:active={tool === 'fill'}
								title="Fill"
								onclick={() => (tool = 'fill')}>🪣</button
							>
							<button
								class="tool-btn"
								class:active={tool === 'eraser'}
								title="Eraser"
								onclick={() => (tool = 'eraser')}>🧽</button
							>
							<button class="tool-btn" title="Undo" onclick={() => socket?.send({ type: 'undo' })}
								>↩️</button
							>
							<button class="tool-btn" title="Redo" onclick={() => socket?.send({ type: 'redo' })}
								>↪️</button
							>
							<button
								class="tool-btn"
								title="Clear canvas"
								onclick={() => socket?.send({ type: 'clearCanvas' })}>🗑️</button
							>
						</div>
					</div>
				{/if}
			{/if}
		</section>

		<aside class="col right">
			<div class="card chat-card">
				<Chat entries={gs.chat} placeholder={chatPlaceholder} onsend={sendChat} />
			</div>
		</aside>
	</main>
{/if}

<style>
	/* ---- Shared full-screen states ---- */

	.center-screen {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.gate-card {
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
		text-align: center;
		width: min(24rem, 100%);
	}

	.brand {
		font-size: 1.9rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--accent);
	}

	.code-chip,
	.room-chip {
		font-family: var(--mono);
		font-weight: 700;
		letter-spacing: 0.15em;
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 6px;
		padding: 0.1rem 0.45rem;
	}

	.gate-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
	}

	.error-text.big {
		font-size: 1.05rem;
	}

	/* ---- Reconnect banner ---- */

	.reconnect-banner {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 50;
		background: var(--danger);
		color: #2a0808;
		font-weight: 700;
		font-size: 0.85rem;
		text-align: center;
		padding: 0.35rem;
	}

	/* ---- Game layout ---- */

	.game {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 300px;
		gap: 1rem;
		padding: 1rem;
		max-width: 1400px;
		margin: 0 auto;
		min-height: 100dvh;
		align-items: start;
	}

	.col {
		min-width: 0;
	}

	.middle {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.side-card {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.side-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.round-chip {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-weight: 600;
	}

	.chat-card {
		height: calc(100dvh - 2rem);
		max-height: 46rem;
		overflow: hidden;
	}

	/* ---- Lobby ---- */

	.lobby {
		padding: 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		align-items: center;
		text-align: center;
	}

	.lobby-label {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.lobby-code-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.lobby-code {
		font-family: var(--mono);
		font-size: 2.6rem;
		font-weight: 800;
		letter-spacing: 0.3em;
		color: var(--accent);
		text-shadow: 0 0 24px rgb(251 191 36 / 0.3);
	}

	.lobby-settings {
		width: min(28rem, 100%);
		background: var(--bg-soft);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 1rem;
	}

	/* ---- Top bar ---- */

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 1rem;
		min-height: 3.2rem;
	}

	.topbar-note {
		font-weight: 600;
		color: var(--text-muted);
	}

	/* ---- Board + overlays ---- */

	.board {
		position: relative;
		border-radius: var(--radius);
		padding: 8px;
		background: linear-gradient(160deg, #2c2c3a, #232330);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
	}

	.overlay {
		position: absolute;
		inset: 8px;
		border-radius: 8px;
		background: rgb(18 18 26 / 0.82);
		backdrop-filter: blur(3px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.1rem;
		padding: 1.5rem;
		text-align: center;
	}

	.overlay.solid {
		background: rgb(18 18 26 / 0.94);
		overflow-y: auto;
		justify-content: flex-start;
	}

	.overlay h2 {
		font-size: 1.35rem;
	}

	.reveal-word {
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.word-choices {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.gains,
	.final {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: min(18rem, 100%);
		max-height: 55%;
		overflow-y: auto;
	}

	.gains li,
	.final li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: var(--bg-soft);
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.75rem;
	}

	.gains li.dim {
		opacity: 0.45;
	}

	.g-name,
	.f-name {
		flex: 1;
		text-align: left;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.g-pts {
		color: var(--success);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.final li.winner {
		background: var(--accent-soft);
		border: 1px solid rgb(251 191 36 / 0.4);
	}

	.medal {
		min-width: 1.6rem;
		text-align: center;
	}

	.f-score {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	.vote-row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}

	.vote-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--bg-soft);
		border-radius: 999px;
		padding: 0.35rem 0.9rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	button.vote-pill {
		border: 1px solid transparent;
		transition: transform 80ms ease;
	}

	button.vote-pill:hover {
		transform: scale(1.08);
	}

	button.vote-pill.active {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.gallery-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.close-flash {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 5;
		background: var(--accent);
		color: var(--accent-ink);
		font-weight: 800;
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		box-shadow: var(--shadow);
		animation: pop 200ms ease-out;
	}

	@keyframes pop {
		from {
			transform: translateX(-50%) scale(0.7);
			opacity: 0;
		}
		to {
			transform: translateX(-50%) scale(1);
			opacity: 1;
		}
	}

	/* ---- Toolbar ---- */

	.toolbar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.55rem 0.8rem;
		flex-wrap: wrap;
	}

	.swatches {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
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

	.tool-group {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.tool-btn {
		width: 34px;
		height: 34px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		font-size: 1rem;
	}

	.tool-btn:hover {
		background: var(--bg-soft);
	}

	.tool-btn.active {
		background: var(--accent-soft);
		border-color: var(--accent);
	}

	.size-dot {
		display: inline-block;
		border-radius: 50%;
		background: var(--text);
	}

	/* ---- Responsive ---- */

	@media (max-width: 980px) {
		.game {
			grid-template-columns: 1fr;
		}

		.left {
			order: 2;
		}

		.middle {
			order: 1;
		}

		.right {
			order: 3;
		}

		.chat-card {
			height: 22rem;
		}
	}
</style>
