<script lang="ts">
	import LegalDoc from '$lib/components/LegalDoc.svelte';
</script>

<svelte:head>
	<title>Terms &amp; Conditions — Cacographer</title>
</svelte:head>

<LegalDoc title="Terms & Conditions" updated="July 24, 2026">
	<p>
		By using Cacographer, you agree to the following. It's kept short on purpose — this is a free
		hobby project, not a commercial product.
	</p>

	<h2>What this is</h2>
	<p>
		Cacographer is a free, real-time drawing-and-guessing game meant for casual play with people
		you know — coworkers, friends, that kind of thing. It's provided as-is, for fun.
	</p>

	<h2>Using it</h2>
	<ul>
		<li>
			Anyone with a room's link or code can join it — there's no access control beyond that, so
			don't share a link with people you don't want in your game.
		</li>
		<li>
			Don't use Cacographer to draw, type, or share anything illegal, harassing, or intended to
			harm someone.
		</li>
		<li>
			Chat has a light profanity filter, but it's a nudge for a trusted group, not a moderation
			system — you're responsible for what you draw and type, and hosts are responsible for who
			they invite.
		</li>
		<li>
			Don't try to disrupt the service for other players (flooding messages, abusing the API, and
			so on).
		</li>
	</ul>

	<h2>No guarantees</h2>
	<p>
		Cacographer is provided "as is," without warranty of any kind. There's no guarantee it'll be
		available, bug-free, or uninterrupted — game state lives only in memory and can be lost at any
		time, for example if the server restarts or redeploys.
	</p>

	<h2>Liability</h2>
	<p>
		To the fullest extent permitted by law, Cacographer's creator and contributors aren't liable
		for any damages arising from your use of the app.
	</p>

	<h2>Governing law</h2>
	<p>
		These terms are governed by the laws of Canada, without regard to conflict-of-law principles
		— regardless of where you access Cacographer from or where it happens to be hosted.
	</p>

	<h2>Changes to the service</h2>
	<p>
		Cacographer may be changed, paused, or shut down at any time without notice — it's maintained
		on a best-effort basis as a side project.
	</p>

	<h2>Open source</h2>
	<p>
		Cacographer's source is available on
		<a href="https://github.com/himynameisdave/cacographer">GitHub</a>
		under the MIT License. Anything you draw or type is relayed live to the other players in your
		room to make the game work, and isn't stored beyond that — see the
		<a href="/privacy">Privacy Policy</a> for details.
	</p>

	<h2>Changes to these terms</h2>
	<p>If these terms change, the "last updated" date above will change with it.</p>

	<h2>Questions</h2>
	<p>
		Questions or concerns are welcome as
		<a href="https://github.com/himynameisdave/cacographer/issues/new">a new issue on GitHub</a>.
	</p>

	<p class="disclaimer">
		This is a plain-language policy written for a small side project — not a substitute for legal
		advice.
	</p>
</LegalDoc>
