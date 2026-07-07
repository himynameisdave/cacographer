<script lang="ts">
	const { endsAt }: { endsAt: number | null } = $props();

	let now = $state(Date.now());
	let total = $state(1);

	$effect(() => {
		if (endsAt === null) {return;}
		// Capture the phase duration when the deadline changes so the bar has
		// a stable 100% reference (late joiners just see the remainder).
		total = Math.max(endsAt - Date.now(), 1);
		now = Date.now();
		const iv = setInterval(() => (now = Date.now()), 200);
		return () => clearInterval(iv);
	});

	const remainingMs = $derived(endsAt === null ? 0 : Math.max(0, endsAt - now));
	const seconds = $derived(Math.ceil(remainingMs / 1000));
	const frac = $derived(Math.min(1, remainingMs / total));
	const urgent = $derived(endsAt !== null && seconds <= 10);

	function fmt(s: number): string {
		if (s < 60) {return String(s);}
		const m = Math.floor(s / 60);
		return `${m}:${String(s % 60).padStart(2, '0')}`;
	}
</script>

{#if endsAt !== null}
	<div class="timer" class:urgent>
		<span class="num">{fmt(seconds)}</span>
		<div class="bar">
			<div class="fill" style="width: {frac * 100}%"></div>
		</div>
	</div>
{/if}

<style>
	.timer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 7rem;
	}

	.num {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 1.05rem;
		min-width: 2.2rem;
		text-align: right;
	}

	.bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--bg-inset);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		border-radius: 3px;
		background: var(--accent);
		transition: width 200ms linear;
	}

	.urgent .num {
		color: var(--danger);
	}

	.urgent .fill {
		background: var(--danger);
	}
</style>
