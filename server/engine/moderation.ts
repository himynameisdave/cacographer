/**
 * Potty-mouth filtering for player chat: token-exact profanity detection plus
 * the humorous phrases broadcast in place of a filtered message. The other
 * half of chat moderation — repeat accounting — lives in Room, which owns the
 * per-player state.
 */
import { normalize } from './text';

/**
 * Token-exact blocklist, common variants listed explicitly. Substring or fuzzy
 * matching would flag honest guesses — "peacock", "class", "grape" — and a
 * trusted room needs a nudge, not armor.
 */
const PROFANITY: ReadonlySet<string> = new Set([
	'arse',
	'arsehole',
	'ass',
	'asses',
	'asshole',
	'assholes',
	'bastard',
	'bastards',
	'bitch',
	'bitches',
	'bollocks',
	'bullshit',
	'cock',
	'cocks',
	'cocksucker',
	'cocksuckers',
	'cunt',
	'cunts',
	'dick',
	'dickhead',
	'dickheads',
	'dicks',
	'dipshit',
	'douchebag',
	'douchebags',
	'dumbass',
	'dumbasses',
	'fag',
	'faggot',
	'faggots',
	'fags',
	'fuck',
	'fucked',
	'fucker',
	'fuckers',
	'fucking',
	'fucks',
	'goddamn',
	'goddammit',
	'horseshit',
	'jackass',
	'jackasses',
	'motherfucker',
	'motherfuckers',
	'motherfucking',
	'nigga',
	'niggas',
	'nigger',
	'niggers',
	'piss',
	'pissed',
	'pisses',
	'prick',
	'pricks',
	'pussies',
	'pussy',
	'retard',
	'retarded',
	'retards',
	'shit',
	'shite',
	'shithead',
	'shitheads',
	'shits',
	'shitty',
	'slut',
	'sluts',
	'twat',
	'twats',
	'wanker',
	'wankers',
	'whore',
	'whores'
]);

/** Broadcast in place of a profane message, italicized after the sender's name. */
export const POTTY_PHRASES: readonly string[] = [
	'...has a potty mouth...',
	'...kisses their mother with that mouth...',
	'...would make a sailor blush...',
	'...owes the swear jar a quarter...',
	'...is getting their mouth washed out with soap...',
	'...said a no-no word...',
	'...forgot this is a family show...',
	'...has strong feelings about this drawing...',
	'...typed something unprintable...',
	'...shall not be quoted verbatim...',
	'...curses like a longshoreman...',
	'...is very passionate right now...'
];

function tokensOf(text: string): string[] {
	return normalize(text)
		.split(/[^a-z0-9]+/u)
		.filter(Boolean);
}

/**
 * True when `text` contains profanity. Tokens of `exemptWord` never count: the
 * answer (which a custom word list is free to make profane) must stay
 * guessable, and discussable once revealed.
 */
export function hasProfanity(text: string, exemptWord: string | null): boolean {
	const exempt = new Set(exemptWord === null ? [] : tokensOf(exemptWord));
	return tokensOf(text).some((t) => PROFANITY.has(t) && !exempt.has(t));
}

/** One of POTTY_PHRASES, picked by the injected RNG. */
export function pottyPhrase(random: () => number): string {
	// random() ∈ [0, 1) and the list is a non-empty constant, so the index is valid.
	return POTTY_PHRASES[Math.floor(random() * POTTY_PHRASES.length)]!;
}
