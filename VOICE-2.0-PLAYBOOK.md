# Mind Chess 2.0 — Voice Playbook

**Status:** plan, not yet built. v1.0 is tagged and frozen (`git tag v1.0`).
**Goal:** make the voice layer good enough that you can play a whole blindfold game without touching the keyboard — and talk to the board while you do it.

---

## The three asks, restated

1. **It doesn't understand well.** Recognition accuracy on moves is the #1 problem.
2. **Continuous loop audio**, like an always-on voice assistant — not tap-mic-per-move.
3. **Natural, chatty voice** with an AI layer that can *answer questions about the board*, because in blindfold play you forget where things are.

These are three different engineering problems with three different risk profiles. The plan below keeps them separate on purpose.

---

## The one rule everything else follows

> **Deterministic core, AI only at the edges.**

Blindfold chess is the worst possible place for a hallucination. If the assistant says *"your knight is on f6"* and it's actually on d7, you can't see the board to catch it — the error silently poisons the rest of your game. A wrong *move* is even worse: it's unrecoverable without a take-back.

So:

| Job | Who does it | Why |
|---|---|---|
| Deciding which move to play | `chess.js` legal move list + constrained matcher | Must be exact. Never let a language model pick a move freely. |
| Board facts ("where are my rooks?") | `chess.js` queries, computed | Must be exact. Never let a language model recall board state from memory. |
| Understanding messy phrasing | AI (optional fallback) | Fuzzy by nature. Constrained to choosing *from the legal list*. |
| Chat, encouragement, coaching, "how am I doing?" | AI | Wrong = annoying, not fatal. |

Every AI call in 2.0 is either **picking from a list we generated** or **narrating facts we computed**. It is never the source of truth.

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

### Phase C — The AI layer (chatty assistant + smarter parsing)
*Needs a key, which needs a proxy. Highest product upside.*

#### The hosting problem, and the answer
Mind Chess is a **public** static site on GitHub Pages. An API key in the client is a key you've published. So:

> **Put a Supabase Edge Function in front of the model.** You already have the project (`lqwssctnvgpxnerahnkc`) and anonymous auth working from the online-play feature. Zero new accounts, zero new infrastructure — currently **0 edge functions deployed**, so this is greenfield.

Non-negotiable on that function, because anyone can read the repo and find the endpoint:
- require the Supabase anon JWT (already minted by the online-play flow)
- rate-limit per user *and* globally
- cap output tokens per call
- set a spend alert at the provider

#### C1. AI as *fallback* move parser
Only when Phase A's matcher lands in the "nothing close" band. Send the FEN, the **legal move list in SAN**, and the raw transcript(s). The model must reply with **one move from that list, or `NONE`** — validate the response against the list before touching the board. It is a chooser, never a generator.
*Cost: negligible (small text calls, only on failure).*

#### C2. AI as conversational board assistant — the actual feature you want
The flow that keeps it honest:

```
question → classify
  ├─ factual? → answer from chess.js (Phase A5), exactly, no model involved
  └─ open-ended? → send FEN + move history + precomputed facts → model phrases the answer
```

Open-ended is where it earns its keep: *"how am I doing?"*, *"what should I be worried about?"*, *"remind me what happened in the last few moves"*, *"is my king safe?"*. Give it the position **and** the computed facts in the prompt so it's narrating rather than recalling.

A nice extra for blindfold play specifically: let it **track what you seem to have forgotten** — if you ask twice about the same square, it can proactively mention that piece later.

#### C3. Personality
A short system prompt gives you the chatty tone. Keep a `verbosity` setting (one already exists) so it can be a terse move-caller or a talkative sparring partner. **Coaching should be opt-in** — unsolicited "are you sure?" would leak evaluation information and wreck the training value of blindfold play.

**Model choice:** a fast, cheap text model is right for this — the calls are small and frequent, and latency is felt directly in conversation. Don't reach for the heaviest model; the position is given, not deduced.

**Done when:** you can ask "where are my rooks and is my king safe?" mid-game and get an answer you trust enough not to peek at the board.

---

### Phase D — Better ears and a better voice
*Do this after A–C prove out. Each is independently shippable.*

#### D1. Natural TTS
`speechSynthesis` at `rate=0.7` ([index.html:407](index.html)) is the robotic voice you're hearing — the slow rate is itself a legibility workaround.

| Option | Quality | Cost | Notes |
|---|---|---|---|
| **Kokoro** via [`kokoro-js`](https://www.npmjs.com/package/kokoro-js) | Very good | Free | 82M params, open source, runs in-browser on WebGPU (WASM fallback). ~80 MB, more with extra voices. **Recommended** — matches your existing self-hosted-Stockfish instinct. |
| Cloud TTS (ElevenLabs / OpenAI / Cartesia) | Excellent | Per-character | Lowest effort, best quality, needs the same proxy as Phase C. |
| Keep `speechSynthesis` | Poor–OK | Free | Fine as the offline fallback tier. |

Whichever you pick: keep `speechSynthesis` as a fallback, and **stream sentence-by-sentence** so speech starts before the full response is generated.

#### D2. Local STT — and the iOS unlock
Replacing Web Speech with an in-browser model buys three things: no Google round-trip, offline operation, and — the big one — **voice on iPhone**. iOS WebKit has no `SpeechRecognition` *at all* ([index.html:1191](index.html) currently just apologises for this). A local model is the *only* path to voice on iOS.

- [**Moonshine**](https://huggingface.co/posts/Xenova/486935205804807) via Transformers.js — purpose-built for real-time, ~150 MB (WebGPU) / ~120 MB (WASM). Best fit.
- **Whisper tiny/base** via Transformers.js — better known, slower for streaming.

⚠️ **Two real constraints:**
- **Don't commit models to the repo** — GitHub has a hard **100 MB per-file** limit and Pages has repo-size limits. Load from the Hugging Face CDN at runtime (Transformers.js default) and cache. This makes it a *progressive enhancement*, not a hard dependency.
- These models are **also** general-purpose — they don't know chess either. Phase A's constrained matcher stays essential regardless. Swapping the STT is not a substitute for A1–A3.

**Done when:** voice works on your iPhone.

---

### Phase E — Full realtime speech-to-speech *(optional; probably not worth it)*
Native speech-to-speech APIs (OpenAI Realtime, Gemini Live) collapse STT+LLM+TTS into one connection at 300–500 ms with real barge-in built in. Genuinely impressive.

**Why it's listed last and marked optional:**
- **Cost is per-minute, and chess games are long.** Roughly $0.02–0.15/min depending on model tier — a 30-minute game runs ~$0.60–$4.50. Phases A–D cost approximately nothing per game.
- **It fights the core rule.** A speech-to-speech model wants to *be* the assistant, including reasoning about the board — exactly what we don't want it doing. You'd wire chess.js back in as tool calls and end up re-imposing all the same constraints.
- Phases A + B + D already deliver most of the felt "continuous natural conversation."

Revisit only if A–D land and the conversation still feels mechanical.

---

## On OpenClaw specifically

Honest answer: **we can copy the architecture, but we can't drop it in.**

[OpenClaw](https://github.com/Purple-Horizons/openclaw-voice) is open source (MIT for the browser voice client) and its voice design is exactly the shape described above — *STT → agent → TTS*, Silero VAD for noise filtering, continuous mode that auto-listens after each response, with a fully local Whisper + Kokoro option for privacy. But it's a **self-hosted server**: the browser client talks over WebSocket to a local Python process running faster-whisper (default port 8765). Mind Chess is a static page on GitHub Pages with no backend, and testers just open a URL.

What that means practically:
- **Steal the pipeline design** (VAD → STT → agent → streaming TTS, continuous mode, sentence-buffered playback for perceived speed) — that's Phases B–D.
- **Use the same components, browser-native**: Whisper/Moonshine via Transformers.js instead of faster-whisper, `kokoro-js` instead of server Kokoro, `vad-web` instead of server Silero.
- **Supabase Edge Functions play the role of its gateway** — the one piece that genuinely needs to be server-side (holding the API key).

If you ever *do* want the full OpenClaw experience, that's a different product: a local assistant that happens to play chess, not a link you send to a friend.

---

## Guardrails (carry these into every 2.0 session)

1. **Never let a model choose a move outside the legal list.** Validate every AI-proposed move against `game.moves()` before applying it.
2. **Never let a model recall board state.** Compute facts, pass them in.
3. **Never speak a message that suggests a phrase to say back.** (OUR-58, permanently.)
4. **Mic is hard-muted while speaking.** No exceptions, no timing hacks.
5. **Every enhancement degrades gracefully.** No WebGPU → WASM. No model → Web Speech. No network → local matcher. No mic → text box. v1.0's feature set must keep working when everything fancy fails.
6. **Test in a real browser, not just the preview pane.** The Day 2.3 finding still stands: cross-origin Worker construction is blocked in the Claude Browser tool, and Transformers.js/Kokoro are Worker-based. A failure there may be the tool, not the code.
7. **Chrome is the primary target.** (Day 2.8 decision — Edge/Windows polish deprioritized.)

---

## Suggested order

**A1 → A3 → A2 → A4** (a session or two; fixes most of the complaint, costs nothing)
**→ A5** (the trustworthy half of the board-questions feature)
**→ B** (the continuous loop, safely)
**→ C** (the chatty layer — the part you're most excited about)
**→ D1** (natural voice) **→ D2** (iOS)
**→ E** only if still needed.

Ship A before touching C. A working matcher makes the AI layer optional rather than load-bearing — and an AI layer built on top of a broken matcher will just hallucinate more confidently.

---

## Open decisions

- [ ] **chess.js 0.10.3 → 1.x?** Needed for clean `attackers()` in A5. Breaking API change; decide before A5.
- [ ] **Which model provider** for Phase C (drives the Edge Function shape).
- [ ] **Kokoro (free, ~80 MB download) vs cloud TTS (better, per-character)** for D1.
- [ ] **Is coaching opt-in by default?** Recommendation: yes — unsolicited hints leak evaluation and undermine blindfold training.
- [ ] **Budget ceiling** for the AI layer, so the Edge Function's rate limits can be set against a real number.
