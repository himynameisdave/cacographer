# Product Requirements Document — Drawing Game (Skribbl Clone)

**Status:** Draft v1
**Owner:** Dave
**Audience:** Small private groups (you + coworkers)

---

## 1. Overview

A real-time multiplayer drawing-and-guessing game modeled on [skribbl.io](https://skribbl.io/). One player draws a secret word while everyone else races to guess it by typing into a chat. Points are awarded for guessing quickly and for drawing something people can actually guess. Play rotates so everyone draws.

This is a private, low-friction tool for a trusted group. It is **not** a public product. No accounts, no persistence beyond a live session, no scale requirements beyond a single room of coworkers.

## 2. Goals

- Let anyone spin up a game and share a link in seconds — no signup.
- Recreate the core skribbl loop faithfully: pick-a-word → draw → guess → score → rotate.
- Feel responsive: drawing and guesses appear in near-real-time.
- Be cheap and near-zero-ops to host.

## 3. Non-Goals (v1)

- User accounts, profiles, or authentication.
- Persistent history, stats, or global leaderboards across sessions.
- Public matchmaking / discovery / lobbies-of-strangers.
- Moderation tooling, reporting, or abuse handling beyond basic input limits.
- Mobile-native apps (responsive web is a nice-to-have, not required).
- Voice/video.

## 4. Target Users & Assumptions

- Groups of ~2–12 people who already know and trust each other.
- Everyone joins from a desktop browser (primary); mouse or trackpad for drawing.
- Sessions are short and social (a few rounds over a break/call).
- Because the group is trusted, we optimize for **fun and low friction over anti-abuse hardening.**

## 5. Core User Flows

### 5.1 Create a game
1. User lands on the home page and clicks **Create Game**.
2. A room is created with a short code; the user lands in the **lobby** as the host.
3. The user copies the shareable link (`/game/<CODE>`) and sends it to coworkers.

### 5.2 Join a game
1. User opens a shared link (or enters a code on the home page).
2. User is prompted to **enter a display name** (once, on entry).
3. User lands in the lobby and sees the current roster and settings.

### 5.3 Configure & start (host)
1. Host adjusts **game settings** (see §7) in the lobby.
2. Host clicks **Start Game** once at least 2 players are present.

### 5.4 A turn (the core loop)
1. One player is designated the **drawer** for the turn.
2. The drawer is shown **3 random word choices** and picks one (with a short timer; auto-picks if they don't).
3. The chosen word is hidden from everyone else, who see a row of blanks (one blank per letter, spaces between words preserved).
4. A **countdown** begins. The drawer draws on a shared canvas; strokes appear live for all guessers.
5. Guessers type guesses into chat. Correct guesses are detected automatically and **not shown** to players who haven't guessed yet.
6. As time runs down, **letters are progressively revealed** in the blanks to help stragglers.
7. The turn ends when time runs out **or** everyone has guessed.
8. The word is revealed and **points are awarded** (see §6). A short scoreboard/interstitial shows before the next turn.

### 5.5 Round & game progression
- A **round** = every player has drawn once. The game runs a configurable number of rounds.
- After the final turn of the final round, a **final scoreboard** is shown with the winner highlighted.
- From the final screen the host can **play again** (returns everyone to the lobby with the same room and settings).

## 6. Scoring (Product Rules)

Concrete formulas live in the TRD; the product-level rules are:

- **Guessers earn more for guessing faster.** A guess made early in the timer is worth substantially more than one made near the end. There is a floor so that any correct guess earns something.
- **The drawer earns based on how well the drawing landed** — roughly, the more people who guess and the faster they do, the more the drawer earns.
- **Bonus for a clean sweep:** if *every* eligible guesser gets the word, the drawer receives a bonus.
- Players who never guess the word that turn earn 0 for that turn.
- Scores accumulate across all turns; highest total at the end wins.

## 7. Game Settings (host-configurable, in lobby)

| Setting | Description | Default | Range |
|---|---|---|---|
| **Rounds** | How many times the turn order cycles | 3 | 1–10 |
| **Draw time** | Seconds per drawing turn | 80s | 30–180s |
| **Word choices** | How many words the drawer picks from | 3 | 2–5 |
| **Hints** | How many letters get revealed over the timer | 2 | 0–(word length − 1) |
| **Max players** | Cap on room size | 12 | 2–12 |
| **Word source** | Built-in list and/or custom words | Built-in | Built-in / Custom / Both |
| **Custom words** | Optional user-supplied words (one per line) | — | — |

> Settings are locked once the game starts and unlock again when everyone returns to the lobby.

## 8. Feature Requirements

### 8.1 Rooms & Joining
- **Create room** generates a short, shareable, human-friendly code and link.
- **Join via link or code**; prompt for a display name on entry.
- Roster shows every connected player, their score, and who is host / drawing.
- The **host** is the room creator; host controls settings and start. (Nice-to-have: host role transfers if the host leaves.)

### 8.2 Lobby
- Live roster that updates as people join/leave.
- Editable settings (host only); read-only preview for others.
- **Start Game** enabled only with ≥2 players.
- Copy-link affordance always visible.

### 8.3 Word Selection
- Drawer sees N random words (per settings) and picks one.
- A selection timer; on expiry a word is auto-selected.
- Words never appear to non-drawers.

### 8.4 Drawing Canvas
- Freehand drawing with **pen color** and **brush size** options.
- **Clear canvas** and (nice-to-have) **undo**.
- (Nice-to-have) fill/bucket tool.
- Only the drawer can draw; guessers see a live, read-only view.
- New/returning viewers see the current drawing (strokes replay), not a blank canvas.

### 8.5 Guessing & Chat
- A single chat input doubles as the guess box during a turn.
- Correct guesses are auto-detected (case-insensitive, whitespace-tolerant).
- A correct guess is hidden from players who haven't guessed yet (no leaking the answer); the guesser gets a "you got it!" confirmation.
- (Nice-to-have) "You're close!" hint when a guess is off by a single character.
- After guessing correctly, a player can still chat, but only with the drawer and other correct-guessers (a "post-guess" channel), so they can't hint the answer.
- The drawer cannot leak the word via chat (their messages are withheld from guessers during the turn, or chat is disabled for them).
- System messages announce joins, leaves, correct guesses ("Alex guessed the word!"), and turn results.

### 8.6 Timer & Reveals
- A visible countdown for the current turn, in sync for all players.
- Blanks reflect word length with word breaks visible.
- Letters are revealed progressively as the timer drains, up to the **Hints** setting, never revealing the entire word.
- Turn ends early if all eligible guessers have guessed.

### 8.7 Scoreboard
- Per-turn: reveal the word and show points gained that turn plus running totals.
- End-of-game: final ranking with the winner emphasized, plus **Play Again**.

## 9. Screens / States (UX inventory)

- **Home:** Create Game / Join by code.
- **Name entry:** shown on first entry to a room.
- **Lobby:** roster, settings, share link, Start.
- **Turn — choosing:** drawer sees word choices; others see "Alex is choosing a word…".
- **Turn — drawing (drawer):** canvas tools + timer + masked word (drawer sees the real word).
- **Turn — guessing (others):** read-only canvas + blanks + timer + guess/chat box.
- **Turn — you guessed:** confirmation + post-guess chat.
- **Turn — interstitial:** word reveal + points gained + totals.
- **Game over:** final scoreboard + Play Again.
- **Edge states:** connection lost / reconnecting; room not found / full; drawer left mid-turn (turn skipped).

## 10. Success Criteria

- A host can go from landing page to an in-progress game with 3 coworkers in **under a minute**.
- Drawing strokes and guesses appear to others with no perceptible lag on a normal connection.
- A full game (default settings, ~4 players) completes without desync between clients (everyone sees the same timer, blanks, and scores).
- The group wants to play a second round. (The real metric.)

## 11. Future / Out-of-Scope Ideas

- Persistent stats & a group leaderboard (would introduce SQLite — see TRD §12).
- Custom word packs saved per group.
- Themed rooms, avatars, reactions/emotes.
- Reconnect-and-resume with grace periods and score retention.
- Touch/stylus support and mobile-optimized canvas.
- Spectator mode; larger rooms (would require the scaling work called out in the TRD).
