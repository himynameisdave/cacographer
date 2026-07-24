<script lang="ts">
	import LegalDoc from '$lib/components/LegalDoc.svelte';
</script>

<svelte:head>
	<title>Privacy Policy - Cacographer</title>
</svelte:head>

<LegalDoc title="Privacy Policy" updated="July 24, 2026">
	<p>
		Cacographer is a small, real-time drawing-and-guessing game built for playing with friends
		and coworkers. There are no accounts, nothing is sold, and there's no advertising or
		tracking. Here's exactly what happens with your information.
	</p>

	<h2>What we collect</h2>
	<ul>
		<li>
			<strong>Your display name, avatar, and name color</strong>: chosen when you join a room,
			sent to the game server so other players in that room can see who's drawing and guessing.
		</li>
		<li>
			<strong>Chat messages and guesses</strong> you type during a game, relayed live to the other
			players in your room.
		</li>
		<li>
			<strong>Drawing strokes and votes</strong> (likes/dislikes on drawings) made during a game,
			relayed live to the other players in your room.
		</li>
		<li>
			<strong>Room codes</strong>: a random short code generated when a game is created, not tied
			to any personal information.
		</li>
	</ul>

	<h2>What we don't collect</h2>
	<ul>
		<li>No accounts, no sign-up, no passwords.</li>
		<li>No email addresses, no payment information.</li>
		<li>No analytics, no advertising trackers, no third-party scripts.</li>
		<li>No cookies are set by this app (see "Local storage" below for the one exception).</li>
	</ul>

	<h2>How long we keep it</h2>
	<p>
		Game state (players, chat, drawings, votes, and scores) lives only in the server's memory for
		as long as a room is active. There is no database. When a room empties out or the server
		restarts, that data is gone for good; we don't keep logs or backups of what you draw or type.
	</p>

	<h2>Local storage</h2>
	<p>
		So you don't have to retype your name and avatar every time, they're saved in your browser's
		<code>localStorage</code>. That data stays on your device. It's never sent anywhere except
		back to this app when you rejoin a game, and you can clear it any time through your browser
		settings.
	</p>

	<h2>Hosting</h2>
	<p>
		Cacographer runs on standard cloud hosting. Like most infrastructure providers, the host may
		generate routine connection logs (such as IP addresses) as part of normal operation.
		Cacographer's own application code doesn't read, store, or make use of that information.
	</p>

	<h2>Children's privacy</h2>
	<p>
		Cacographer isn't directed at children, and we don't knowingly collect information from anyone
		under 13.
	</p>

	<h2>Changes</h2>
	<p>If this policy changes, the "last updated" date above will change with it.</p>

	<h2>Questions</h2>
	<p>
		Cacographer is an open-source side project. Questions or concerns are welcome as
		<a
			href="https://github.com/himynameisdave/cacographer/issues/new"
			target="_blank"
			rel="noopener noreferrer">a new issue on GitHub</a
		>.
	</p>

	<p class="disclaimer">
		This is a plain-language policy written for a small side project, not a substitute for legal
		advice.
	</p>
</LegalDoc>
