# Mind Chess 2.0 — Voice Playbook

> ## ✅ Phase A is built and shipped — 2026-08-20
>
> **A complete game of blindfold chess played entirely by voice, ending in `Qh5#`.**
>
> Live at **https://sportbega.github.io/mind-chess/v2/** (branch `v2`, build `v2-r5`, `?debug=1` for diagnostics). v1.0 untouched at `/`, frozen at `/v1/`. Linear: [OUR-63](https://linear.app/bega-workspace/issue/OUR-63). **Next session: A5 — [OUR-64](https://linear.app/bega-workspace/issue/OUR-64).**
>
> **Done:** A1 continuous recognition · A2 phonetic matching + piece-word scoring · A3 ask-back instead of rejecting · A4 hard speaking gate. **Remaining in Phase A: A5** (board questions) and A6 (self-host chess.js).
>
> ### What the build actually taught us
>
> **The plan's diagnosis was half wrong, and measuring beat theorising.** A1 was pitched as the biggest win and delivered nothing the user could feel — between moves you pause while the computer replies, so the cold-start gap was rarely hit. Its real value turned out to be *enabling A3*: speaking a question aloud is only safe because the mic is muted while talking. Everything that followed came from a `?debug=1` panel built after A1 failed, replaying real captured speech.
>
> **Three wrong-move bugs were hiding behind "it mishears".** Saying "knight to d4" played the *pawn*; so did "knight to f4"; and an open question swallowed an unrelated move. None were recognition failures — all three were scoring/flow defects that only showed up in logs of real games. In blindfold play this is the worst class of bug, because the player cannot see it happen.
>
> **The constrained matcher was dead code for piece moves.** Every single one tied with the bare pawn move to the same square (margin 0, rejected every time); they only ever worked because a separate exact parser rescued them. That's why anything the recognizer mangled failed twice over.
>
> **The generalisable rule:** fixes that *widen the candidate set and let the legal-move scorer decide* pay off repeatedly — phonetic distance, rescoring every alternative, digit-as-file expansion. Vocabulary entries fix exactly one transcription each; scoring changes fix a whole class. **Corollary, now enforced:** widening is only safe while the scorer can still discriminate — where two readings are equally legal, refuse rather than pick. A rejection costs one repeat; a wrong move costs the game.
>
> **Aggressive homophones need a length guard.** `nice`/`light`/`like` are what Chrome returns for a spoken "knight" in most real utterances — but the same words are filler in a sentence. Spoken moves are short; that's the cheapest reliable separator.
>
> **Half the input surface was missed at first.** A2 gave *moves* phonetic matching; commands stayed exact-regex, so "hide board" ("hi board", "Highboy") was rejected for a whole session. Worth remembering for A5, where question phrasing will vary at least as much.

**Status:** Phase A shipped (see above). Phases B–D not yet built. v1.0 is tagged and frozen (`git tag v1.0`).
**Goal:** make the voice layer good enough that you can play a whole blindfold game without touching the keyboard — and talk to the board while you do it.

---

## The three asks, restated

1. **It doesn't understand well.** Recognition accuracy on moves is the #1 problem.
2. **Continuous loop audio**, like an always-on voice assistant — not tap-mic-per-move.
3. **Natural, chatty voice** with an AI layer that can *answer questions about the board*, because in blindfold play you forget where things are.

These are three different engineering problems with three different risk profiles. The plan below keeps them separate on purpose.

---

## Hard constraint: it has to be free

**No per-use costs. No API subscriptions. No metered anything.** Mind Chess stays a link you can hand to anyone without it costing you money when they use it.

Everything in this plan runs on: the browser's own APIs, open-source models loaded from a free CDN, the Stockfish engine you already ship, GitHub Pages, and the Supabase free tier you're already on. Total marginal cost per game: **zero**.

Two consequences worth stating plainly:

- **No hosted LLM, not even a "free tier."** Free tiers are one shared quota tied to your key. On a public link, testers burn it, and you're still protecting a key and watching a dashboard. That isn't free in the way you mean, so it's out.
- **"Free" still costs download size.** Kokoro is ~80 MB, Moonshine ~150 MB, a local LLM 0.5–2 GB. That's a real cost to your users even though it's not a cost to you. Every one of these ships as **opt-in progressive enhancement** — the app must be fully playable before any of them download.

One thing this constraint *removes*: with no paid API to hide, there's **no need for a Supabase Edge Function proxy at all**. No key to protect, no rate limiting, no spend alerts. That's a whole component deleted from the plan.

---

## The one rule everything else follows

> **Deterministic core, AI only at the edges.**

Blindfold chess is the worst possible place for a hallucination. If the assistant says *"your knight is on f6"* and it's actually on d7, you can't see the board to catch it — the error silently poisons the rest of your game. A wrong *move* is even worse: it's unrecoverable without a take-back.

So:

| Job | Who does it | Why |
|---|---|---|
| Deciding which move to play | `chess.js` legal move list + constrained matcher | Must be exact. Never let a language model pick a move freely. |
| Board facts ("where are my rooks?") | `chess.js` queries, computed | Must be exact. Never let a language model recall board state from memory. |
| Position judgement ("how am I doing?") | **Stockfish** — which you already ship | An engine *computes* an evaluation. A language model would guess at one and sound equally confident. |
| Understanding messy phrasing | Optional local model, last resort only | Fuzzy by nature. Constrained to choosing *from the legal list*. |
| Wording the answer nicely | Templates, or an optional local model | Wrong here is clumsy, not fatal. |

Anything model-shaped in 2.0 is either **picking from a list we generated** or **wording facts we computed**. It is never the source of truth.

### Two channels, not one

Split the voice pipeline in two, because the requirements conflict:

- **Command channel** — moves and controls. Must be *fast, offline-capable, high-precision*. Never routed through the network or an LLM when the local matcher is confident.
- **Conversation channel** — questions and chat. Can be slower, cloud-backed, chatty.

A happy consequence: the constrained matcher **is the wake-word filter**. Random room speech won't confidently match a legal move, so always-on listening doesn't need "Hey Mind Chess" — unmatched audio is simply ignored. (Silently ignored: see the OUR-58 lesson below.)

---

## Diagnosis — why v1.0 mishears

Grounded in the actual code, not guesses. The foundations are better than they feel in use; most of the loss is in three specific places.

**What's already right** (don't rebuild these):
- `constrainedMove()` ([index.html:935](index.html)) already scores the transcript against *only legal moves* — the single most important idea, already present.
- `route()` ([index.html:1131](index.html)) already scores **every** recognizer alternative and takes the best.
- `matchSan()` gives exact SAN a hard win over fuzzy scoring.
- A pending-question mechanism already exists (`resolvePending`, ~[index.html:1060](index.html)) — 2.0 can reuse it for confirmations.

**What's actually costing accuracy:**

1. **Restart churn eats your first word.** `recognition.continuous=false` ([index.html:1201](index.html)) with a restart on `onend` ([index.html:1234](index.html)) means *every utterance is a cold session*. Chrome clips the leading audio of a fresh session, and the 250 ms gap is a dead window where you are simply not being recorded. "Knight to f3" arrives as "to f3" — and the piece name is exactly the word the matcher needs most. **This is the cheapest big win available.**

2. **Matching is graphemic, not phonetic.** `tokenDistance()` ([index.html:908](index.html)) does edit distance on letters, with a crude "same first two characters" nudge. But speech errors are *sound* errors: knight/night, be/bee/b, see/c/sea, ate/eight, for/four/fore. The hand-built alias tables (`SPOKEN_FILE`, `FILE_WORDS`, [index.html:869](index.html)) patch these one at a time and will never be complete. A phonetic encoder generalizes instead of enumerating.

3. **Ambiguity is a rejection, not a question.** The gate at [index.html:953](index.html) (`best.score>=1.05 && margin>=0.7`) fails closed — you get *"I didn't catch a move"* and have to repeat the whole thing. But a near-miss usually still has the right move ranked #1. Asking *"Knight f3?"* and hearing *"yes"* converts a failure into a one-word confirmation. Most of the felt unreliability is here.

4. **The recognizer doesn't know it's doing chess.** Web Speech uses a general English model. This is the root cause we can't fix directly in the browser — only compensate for (items 1–3) or replace (Phase D).

---

## Phases

Ordered by value per unit of effort and risk. **Phase A alone should fix most of "it doesn't understand well"** — no downloads, no API keys, no cost, no new infrastructure. Do not skip ahead to the exciting parts.

---

### Phase A — Fix recognition with what we already have
*No new dependencies. No network. No cost. Works offline. Biggest accuracy-per-effort ratio in the whole plan.*

**A1. Keep one recognition session alive.**
Set `continuous=true`, stop tearing down between utterances. Add a watchdog that restarts only on real end/error (Chrome still kills sessions after ~60 s of silence), plus a periodic hard restart to dodge Chrome's long-session degradation.
*Recovers the dropped leading word. Expect the single largest accuracy jump here.*

**A2. Add a phonetic layer.**
Encode both the transcript and each candidate move phrase with Double Metaphone (or a small chess-tuned encoder — the vocabulary is tiny: 8 files, 8 ranks, 6 pieces, ~10 verbs) and run the distance on phoneme strings. Keep the existing letter distance as a secondary signal.
*Replaces the alias tables with something that generalizes.*

**A3. Confirm instead of reject.**
Three bands instead of two:
- **confident** → play it
- **plausible** → *"Knight f3?"* → "yes"/"no"/"next" (reuse the existing pending-question machinery; "next" walks down the ranked list)
- **nothing close** → ask to repeat

*Turns the most common failure into one syllable of recovery.*

**A4. Formalize the mic state machine.**
Explicit `IDLE → LISTENING → THINKING → SPEAKING → LISTENING`, with the mic **hard-muted** during `SPEAKING`. This replaces the 120 ms timing hack in `say()` ([index.html:404](index.html)) and makes the OUR-58 class of bug structurally impossible rather than patched case-by-case.

**A5. Widen the deterministic question set.** *(This is most of the "answer questions about the board" ask — and the trustworthy part of it.)*
`matchCommand()` ([index.html:1001](index.html)) currently handles ~8 things, and `announceBoard()` dumps *every piece on the board* — unusable mid-game. Add exact, computed answers for:
- "where are my knights?" / "where's my queen?"
- "what's on e4?" / "is d5 empty?"
- "what's attacking my queen?" / "is my knight defended?"
- "am I in check?" / "can I still castle?"
- "what were the last three moves?" / "what did I just play?"
- "how many pieces do I have left?"

⚠️ **Note:** the project pins **chess.js 0.10.3** (CDN, [index.html:10](index.html)), which has no `attackers()`. Attack/defence queries need a helper (enumerate opponent moves targeting the square) — or upgrade to chess.js 1.x, which is a breaking API change. Decide before writing A5.

**A6. Self-host chess.js.**
Stockfish is self-hosted but chess.js still comes from a CDN. If 2.0 is meant to work offline, fix the inconsistency.

**Done when:** you can play a full game against the computer, hands-free, and the recogniser handles a normal speaking voice without you consciously over-enunciating.

---

### Phase B — The continuous loop, done safely
*This is the OpenClaw-style always-on behaviour. It's mostly a discipline problem, not a technology problem.*

Always-on listening while the app is also *speaking* is exactly the setup that produced **OUR-58** (the app heard its own voice, failed to parse it, spoke a suggestion, and looped). Going always-on multiplies that risk, so the safety pieces are prerequisites, not polish:

1. **AEC on** — `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }})`. Note Web Speech owns the mic itself, so this may require moving to a raw-audio pipeline (see Phase D) to control properly.
2. **VAD** — [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) (Silero, ~85–100 ms) to segment speech instead of relying on the recognizer's endpointing. This is what makes it feel like a conversation rather than a walkie-talkie.
3. **Hard mute while speaking** (A4) — the non-negotiable one.
4. **Barge-in** — VAD fires during `SPEAKING` → cancel TTS immediately, switch to `LISTENING`. Target <200 ms. Essential once responses get chatty and long; you must be able to talk over it.
5. **Never speak a suggestion of what to say.** The `warnSilent()` rule from OUR-58 becomes a permanent design rule, not a bug fix.

**Done when:** you can leave the mic on for a 30-minute game, the app never talks to itself, and you can interrupt it mid-sentence.

---

### Phase C — The board assistant, with no API at all
*Free, offline, and more accurate than a hosted model would be.*

**The key realization: you already ship the smartest chess entity you could ask for.** Stockfish 18 is sitting in the repo, self-hosted, running in a Worker. It answers *"how am I doing?"*, *"what should I be worried about?"*, *"is my king safe?"*, *"am I hanging anything?"* — exactly, offline, for free.

And it answers them **better than a language model would.** An LLM asked to evaluate a position produces a plausible-sounding guess. Stockfish produces a number it actually computed. For the one question type where being wrong is most damaging to a blindfold player, the free option is also the correct one.

So Phase C isn't "add an AI." It's **connect the engine you already have to the conversation, and word its answers well.**

#### C1. Engine-backed position questions
Run a short, shallow analysis (a few hundred milliseconds — not full playing strength) on demand, and translate the result:

| You ask | Comes from | Answer |
|---|---|---|
| "How am I doing?" | eval score | "You're a bit better — about half a pawn." |
| "What should I worry about?" | engine's best line for the opponent | "Their knight is eyeing f7." |
| "Am I hanging anything?" | opponent captures, scored | "Your bishop on b5 is undefended." |
| "Is my king safe?" | eval delta + checks in the top lines | "No immediate threats to your king." |

⚠️ **Design care:** this is powerful enough to become cheating-by-accident. Analysis-backed answers should be **coarse and opt-in** — "slightly better," not "+0.43," and never the actual best move unless explicitly asked. Recommendation: a **Coach setting** with off / hints / full, defaulting to off, so blindfold training stays training.

#### C2. Natural phrasing without a model
"Chatty" is mostly a writing problem, not a model problem. A well-built response layer gets you most of the way:

- **Vary the wording.** Several phrasings per answer type, chosen at random, so it doesn't sound like a vending machine. This alone is most of the difference between "robotic" and "friendly."
- **Use the existing verbosity setting** so it can be a terse move-caller or a talkative sparring partner.
- **Be conversational about state:** "you've castled, rooks are connected" reads as chat but is pure computation.
- **Track what you keep forgetting** — ask twice about the same square and it can bring that piece up unprompted later. Free, memorable, and genuinely useful in blindfold play.

Combined with A5's exact answers and C1's engine answers, this covers essentially every question you'd actually ask mid-game.

#### C3. Optional: a local model for phrasing only
If C2 still feels mechanical, run a small model **in the browser** — [WebLLM](https://github.com/mlc-ai/web-llm) with a 0.5–3B model (Qwen, Llama 3.2, Gemma). No key, no server, no quota, no data leaving the device, cached after first download.

Its job is strictly **wording facts we hand it** — never recalling the board, never judging the position, never choosing a move. A 1B model is perfectly good at rephrasing and hopeless at chess; this split plays exactly to that.

**Cost to you: zero. Cost to the user: 0.5–2 GB and a WebGPU-capable browser.** So: opt-in, off by default, behind a "make it chattier" toggle that explains the download. The app must be complete without it.

**Done when:** you can ask "where are my rooks, is my king safe, and how am I doing?" mid-game and trust every part of the answer.

---

### Phase D — Better ears and a better voice
*Do this after A–C prove out. Each is independently shippable.*

#### D1. Natural TTS
`speechSynthesis` at `rate=0.7` ([index.html:407](index.html)) is the robotic voice you're hearing — the slow rate is itself a legibility workaround.

| Option | Quality | Cost | Notes |
|---|---|---|---|
| **Kokoro** via [`kokoro-js`](https://www.npmjs.com/package/kokoro-js) | Very good | **Free** | 82M params, open source, runs in-browser on WebGPU (WASM fallback). ~80 MB, loaded from a free CDN and cached. **This is the pick.** |
| Keep `speechSynthesis` | Poor–OK | Free | Stays as the zero-download fallback tier. |
| ~~Cloud TTS~~ | Excellent | Per character | **Ruled out** — metered. |

Kokoro is the whole answer here: it's the one place where free and best-quality are the same option. Keep `speechSynthesis` as the fallback for machines that can't run it, and **stream sentence by sentence** so speech starts before the full response is ready.

#### D2. Local STT — and the iOS unlock
Replacing Web Speech with an in-browser model buys three things: no Google round-trip, offline operation, and — the big one — **voice on iPhone**. iOS WebKit has no `SpeechRecognition` *at all* ([index.html:1191](index.html) currently just apologises for this). A local model is the *only* path to voice on iOS.

- [**Moonshine**](https://huggingface.co/posts/Xenova/486935205804807) via Transformers.js — purpose-built for real-time, ~150 MB (WebGPU) / ~120 MB (WASM). Best fit.
- **Whisper tiny/base** via Transformers.js — better known, slower for streaming.

⚠️ **Two real constraints:**
- **Don't commit models to the repo** — GitHub has a hard **100 MB per-file** limit and Pages has repo-size limits. Load from the Hugging Face CDN at runtime (Transformers.js default) and cache. This makes it a *progressive enhancement*, not a hard dependency.
- These models are **also** general-purpose — they don't know chess either. Phase A's constrained matcher stays essential regardless. Swapping the STT is not a substitute for A1–A3.

**Done when:** voice works on your iPhone.

---

### ~~Phase E — Full realtime speech-to-speech~~ *(ruled out)*
Native speech-to-speech APIs collapse recognition, reasoning and synthesis into one connection with real barge-in built in. Genuinely impressive — and **metered per minute**, which puts it outside the constraint. A 30-minute game would run roughly $0.60–$4.50.

It also fought the core rule anyway: a speech-to-speech model wants to *be* the assistant, board reasoning included, which is exactly what we don't want. Dropped, not deferred.

**What replaces it:** Phase B's VAD and barge-in deliver the continuous-conversation *feel*, and Phase D1's Kokoro delivers the natural *voice*. The gap between that and a realtime API is much smaller than the price difference.

---

## On OpenClaw specifically

Honest answer: **we can copy the architecture, but we can't drop it in.**

[OpenClaw](https://github.com/Purple-Horizons/openclaw-voice) is open source (MIT for the browser voice client) and its voice design is exactly the shape described above — *STT → agent → TTS*, Silero VAD for noise filtering, continuous mode that auto-listens after each response, with a fully local Whisper + Kokoro option for privacy. But it's a **self-hosted server**: the browser client talks over WebSocket to a local Python process running faster-whisper (default port 8765). Mind Chess is a static page on GitHub Pages with no backend, and testers just open a URL.

What that means practically:
- **Steal the pipeline design** (VAD → STT → agent → streaming TTS, continuous mode, sentence-buffered playback for perceived speed) — that's Phases B–D.
- **Use the same components, browser-native**: Whisper/Moonshine via Transformers.js instead of faster-whisper, `kokoro-js` instead of server Kokoro, `vad-web` instead of server Silero.
- **Skip its gateway entirely.** OpenClaw needs a server because it holds API keys and orchestrates providers. With the free constraint there are no keys, so there's nothing to put server-side — the whole gateway tier disappears. Its *local* pipeline (Whisper + Kokoro, no cloud) is exactly the configuration we're copying anyway.

If you ever *do* want the full OpenClaw experience, that's a different product: a local assistant that happens to play chess, not a link you send to a friend.

---

## Living alongside v1.0

v1.0 is frozen and permanently online at **`/v1/`** (byte-identical to the `v1.0` tag), while `/` tracks the latest version. Both stay up. Two same-origin hazards this creates, both verified live:

1. **Namespace every `localStorage` key.** v1.0 writes `mind-chess-save-v1`, `mind-chess-board-theme`, and `mind-chess-piece-theme` — and `/v1/` shares an origin with `/`, so they're the *same* storage. 2.0 must prefix all of its keys (e.g. `mind-chess-v2-*`). Reusing any of the three means playing 2.0 corrupts v1.0's saved game and themes, and vice versa. This is the same shared-origin trap that cost a session during Day 2.4 testing.
2. **Keep the `mind_chess_games` schema backward-compatible.** Both versions talk to the same Supabase table. Add columns; never repurpose or remove one, or v1.0's online mode breaks.

**Small wart worth fixing in 2.0, spotted while verifying v1:** the *spoken* form of a move leaks into the on-screen transcript — the log reads "Pawn to ee 4" and "Knight to see 6" because letters are spelled phonetically for the synthesizer. Speech text and display text should be generated separately: say "ee 4", write "e4".

---

## Guardrails (carry these into every 2.0 session)

1. **Nothing metered, ever.** No API keys, no subscriptions, no free tiers that meter. If a feature needs a paid service, it doesn't go in.
2. **Never let a model choose a move outside the legal list.** Validate every proposed move against `game.moves()` before applying it.
3. **Never let a model recall board state or judge a position.** chess.js computes facts; Stockfish computes judgement; a model only words them.
4. **Never speak a message that suggests a phrase to say back.** (OUR-58, permanently.)
5. **Mic is hard-muted while speaking.** No exceptions, no timing hacks.
6. **Every enhancement degrades gracefully.** No WebGPU → WASM. No model → Web Speech. No download → templates. No mic → text box. v1.0's feature set must keep working when everything fancy fails — and the app must be fully playable before a single byte of optional model downloads.
7. **Test in a real browser, not just the preview pane.** The Day 2.3 finding still stands: cross-origin Worker construction is blocked in the Claude Browser tool, and Transformers.js, Kokoro and WebLLM are all Worker-based. A failure there may be the tool, not the code.
8. **Chrome is the primary target.** (Day 2.8 decision — Edge/Windows polish deprioritized.)

---

## Suggested order

**A1 → A3 → A2 → A4** (a session or two; fixes most of the complaint, zero downloads)
**→ A5** (exact board answers)
**→ B** (the continuous loop, safely)
**→ C1 + C2** (engine-backed answers, well worded — still zero downloads)
**→ D1** (Kokoro: the natural voice)
**→ D2** (local recognition — and voice on iPhone)
**→ C3** (optional local model, only if C2 still feels mechanical)

Note what that ordering means: **everything through C2 requires no downloads at all.** That's better recognition, always-on listening, exact board answers, and engine-backed position judgement — the whole substance of your three asks — with nothing bigger shipped than the Stockfish you already have.

Ship A before C. A working matcher makes everything above it optional rather than load-bearing.

---

## Open decisions

- [ ] **chess.js 0.10.3 → 1.x?** Needed for clean `attackers()` in A5. Breaking API change; decide before A5.
- [ ] **Coach setting default.** Recommendation: off. Engine-backed answers are strong enough to become accidental cheating, and unsolicited hints undermine blindfold training.
- [ ] **How coarse should evaluations be?** "Slightly better" vs "+0.43" — recommendation: words, not numbers, unless you ask for precision.
- [ ] **Is C3 worth it at all?** Try C2 first. A 0.5–2 GB download to make phrasing nicer may not earn its place.
