<script lang="ts">
	import { LIMITS, SETTINGS_BOUNDS, type Settings } from '$lib/protocol';

	interface Props {
		settings: Settings;
		isHost: boolean;
		onupdate: (partial: Partial<Settings>) => void;
	}

	const { settings, isHost, onupdate }: Props = $props();

	// Live values while a slider is being dragged (committed on release).
	const pending = $state<Partial<Record<string, number>>>({});

	function num(e: Event): number {
		return Number((e.currentTarget as HTMLInputElement).value);
	}

	function preview(key: string, e: Event): void {
		pending[key] = num(e);
	}

	function commit(key: keyof Settings, e: Event): void {
		onupdate({ [key]: num(e) });
		delete pending[key];
	}

	function shown(key: string, fallback: number): number {
		return pending[key] ?? fallback;
	}

	function parseWords(text: string): string[] {
		return text
			.split('\n')
			.map((w) => w.trim())
			.filter(Boolean)
			.slice(0, LIMITS.customWordsTotal);
	}

	const sourceLabels: Record<Settings['wordSource'], string> = {
		builtin: 'Built-in words',
		custom: 'Custom words only',
		both: 'Built-in + custom'
	};
</script>

<div class="settings">
	<h3>Game settings</h3>
	{#if isHost}
		<label class="row">
			<span class="key">Rounds</span>
			<input
				type="range"
				min={SETTINGS_BOUNDS.rounds[0]}
				max={SETTINGS_BOUNDS.rounds[1]}
				step="1"
				value={settings.rounds}
				oninput={(e) => preview('rounds', e)}
				onchange={(e) => commit('rounds', e)}
			/>
			<span class="val">{shown('rounds', settings.rounds)}</span>
		</label>
		<label class="row">
			<span class="key">Draw time</span>
			<input
				type="range"
				min={SETTINGS_BOUNDS.drawTimeSeconds[0]}
				max={SETTINGS_BOUNDS.drawTimeSeconds[1]}
				step="10"
				value={settings.drawTimeSeconds}
				oninput={(e) => preview('drawTimeSeconds', e)}
				onchange={(e) => commit('drawTimeSeconds', e)}
			/>
			<span class="val">{shown('drawTimeSeconds', settings.drawTimeSeconds)}s</span>
		</label>
		<label class="row">
			<span class="key">Word choices</span>
			<input
				type="range"
				min={SETTINGS_BOUNDS.wordChoiceCount[0]}
				max={SETTINGS_BOUNDS.wordChoiceCount[1]}
				step="1"
				value={settings.wordChoiceCount}
				oninput={(e) => preview('wordChoiceCount', e)}
				onchange={(e) => commit('wordChoiceCount', e)}
			/>
			<span class="val">{shown('wordChoiceCount', settings.wordChoiceCount)}</span>
		</label>
		<label class="row">
			<span class="key">Letter hints</span>
			<input
				type="range"
				min="0"
				max="5"
				step="1"
				value={settings.hintCount}
				oninput={(e) => preview('hintCount', e)}
				onchange={(e) => commit('hintCount', e)}
			/>
			<span class="val">{shown('hintCount', settings.hintCount)}</span>
		</label>
		<label class="row">
			<span class="key">Max players</span>
			<input
				type="range"
				min={SETTINGS_BOUNDS.maxPlayers[0]}
				max={SETTINGS_BOUNDS.maxPlayers[1]}
				step="1"
				value={settings.maxPlayers}
				oninput={(e) => preview('maxPlayers', e)}
				onchange={(e) => commit('maxPlayers', e)}
			/>
			<span class="val">{shown('maxPlayers', settings.maxPlayers)}</span>
		</label>
		<label class="row">
			<span class="key">Words</span>
			<select
				value={settings.wordSource}
				onchange={(e) =>
					onupdate({ wordSource: e.currentTarget.value as Settings['wordSource'] })}
			>
				<option value="builtin">{sourceLabels.builtin}</option>
				<option value="custom">{sourceLabels.custom}</option>
				<option value="both">{sourceLabels.both}</option>
			</select>
		</label>
		{#if settings.wordSource !== 'builtin'}
			<label class="row stacked">
				<span class="key">Custom words <span class="sub">(one per line, max {LIMITS.customWordsTotal})</span></span>
				<textarea
					rows="5"
					placeholder={'pizza\nrobot\nsnail…'}
					value={settings.customWords.join('\n')}
					onchange={(e) => onupdate({ customWords: parseWords(e.currentTarget.value) })}
				></textarea>
				<span class="sub">{settings.customWords.length} saved</span>
			</label>
		{/if}
	{:else}
		<dl class="summary">
			<div><dt>Rounds</dt><dd>{settings.rounds}</dd></div>
			<div><dt>Draw time</dt><dd>{settings.drawTimeSeconds}s</dd></div>
			<div><dt>Word choices</dt><dd>{settings.wordChoiceCount}</dd></div>
			<div><dt>Letter hints</dt><dd>{settings.hintCount}</dd></div>
			<div><dt>Max players</dt><dd>{settings.maxPlayers}</dd></div>
			<div><dt>Words</dt><dd>{sourceLabels[settings.wordSource]}</dd></div>
			{#if settings.wordSource !== 'builtin'}
				<div><dt>Custom words</dt><dd>{settings.customWords.length}</dd></div>
			{/if}
		</dl>
		<p class="hint">Only the host can change settings.</p>
	{/if}
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		text-align: left;
	}

	h3 {
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.row {
		display: grid;
		grid-template-columns: 7rem 1fr 3rem;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
	}

	.row.stacked {
		grid-template-columns: 1fr;
		gap: 0.35rem;
	}

	.key {
		color: var(--text-muted);
	}

	.val {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		text-align: right;
	}

	.sub {
		font-size: 0.75rem;
		color: var(--text-faint);
		font-weight: 400;
	}

	select,
	textarea {
		width: 100%;
	}

	.row select {
		grid-column: 2 / 4;
	}

	textarea {
		resize: vertical;
		font-family: var(--mono);
		font-size: 0.85rem;
	}

	.summary {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.summary div {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
	}

	.summary dt {
		color: var(--text-muted);
	}

	.summary dd {
		margin: 0;
		font-weight: 600;
	}
</style>
