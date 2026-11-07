# dsh-waifu 🐾

English | [简体中文](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/lof6yo/dsh-waifu)](https://github.com/lof6yo/dsh-waifu/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

A Live2D mascot for DeepSeek Harness: she tilts her head while you think, reacts when you finish, and talks back when you poke her.

**No fixed lines, no hand-written mapping tables** — every line, motion and expression is improvised by an LLM from the persona, the current scene and the conversation history (ADR-037). Touch zones are boxes you draw on the character yourself, and each zone can carry several named *interactions* (pinch / kiss / pet …) bound to single click, double click or hover.

<p align="center">
  <img src="docs/media/hero.jpg" alt="dsh-waifu hero" width="920" />
</p>

> The UI and configuration are currently Chinese-only; this document mirrors the Chinese README.

## Features

- **Built-in model "Jian"** — shipped with the package (moc3 / textures / physics / cdi3), works right after install. Model selection and importing your own model are **not** supported in this version.
- **Fully AI-driven (ADR-037)** — input: persona + scene (touch zone and interaction name, 16 kinds of DSH events, chat input, idle timeout) + timestamped history + memory; output: `[expression][motion] text`, plus an optional `[记] …` line appended to memory. When the model is unavailable the character stays **silent** (no canned fallback), while physics keeps running.
- **8 motions + 10 expressions** — motions: Nod, ShakeHead, Tilt, Sway, Glance, Perk, Shift, Sigh (plus the `Idle` breathing loop), generated idempotently by `scripts/gen-jian-motions.mjs`; expressions: blush, angry, star, whites, tear, heart, cry, dark, blood, dim.
- **Custom touch zones (touchboxes)** — a zone is a name plus one or more normalized rectangles (0–100 % of the model bounding box, origin at the bottom-left) and a layer, so overlapping zones resolve top-down. Each zone can define several **interactions**: a name (passed to the model verbatim) and a trigger (single click / double click / hover N ms). The ten built-in zones are already named by feel (face = pinch / kiss / pet, chest = knead / lick / pet, …).
- **Preview while editing** — turn on "preview boxes" to see every box drawn on the character and click it to test-fire (without touching saved data).
- **Speech (ADR-033)** — the model streams text, the text is split at punctuation, each clause is synthesized, and **the bubble for a clause appears exactly when that clause's audio starts**. Lip-sync is driven by the audio energy, so text, voice and mouth stay in sync. Two Qwen TTS models with female voices, called through OpenRouter with the DSH credentials.
- **Status mirroring** — agent state is pushed over SSE; tool runs, approvals, session open/close and subagent traffic make the character glance up (each scene has its own toggle).
- **Interaction bar** — a small pill above the model: type and press Enter to talk to her; the round button on the left mutes the voice.
- **Unobtrusive** — small, bottom-right by default, draggable and hideable; transparent canvas areas are **click-through** (only touchboxes receive clicks, so the DSH UI stays usable); rendering pauses when the tab is hidden, and there is a static-avatar fallback on weak machines.
- **Debug panel** — on by default. Drag it by the title bar, resize from the four corner grips (geometry persisted in localStorage), with scene demos, native motion/expression previews, and a console that records the whole chain **in the order it actually happened** (`trigger → llm.request → llm.reply → tts.request → tts.reply → play.*`) with one-click copy.
- **Diagnosable** — browser boot milestones and errors go to `$DSH_HOME/waifu/client.log`.

## Requirements

- DeepSeek Harness (DSH) **0.2.x** (Desktop or Web)
- Network access to GitHub and the npm registry to install / update
- The package ships prebuilt `lib/`, so **no local build** is needed to install
- For AI lines and speech: an LLM provider configured in DSH (default `openrouter` + `google/gemma-4-31b-it`) and an `OPENROUTER_API_KEY` (also used by TTS)

## Install

### From GitHub (recommended)

```sh
dsh plugin --profile <profile> add github:lof6yo/dsh-waifu
```

Replace `<profile>` with your DSH profile (`desktop` / `web` / …). Equivalent forms: the full URL `https://github.com/lof6yo/dsh-waifu.git`, or a pinned ref `github:lof6yo/dsh-waifu#main` / `github:lof6yo/dsh-waifu#<commit>`.

`lib/index.js` and `lib/client.js` in the repo are already-built artifacts, so a git install runs out of the box.

Verify:

```sh
dsh plugin --profile <profile> list
```

**dsh-waifu** should appear. Refresh the page and the character shows up in the bottom-right corner; it can also be enabled/disabled from DSH Settings → Plugins.

> Updated the code but see no change? The **client** half (`client.js`) is re-read from disk on every page load, so it updates immediately; the **host** half (`lib/index.js`) is cached in the running process and needs a DSH restart.

### Local development install

```sh
git clone https://github.com/lof6yo/dsh-waifu.git
cd dsh-waifu
bun install                 # this repo uses bun
bun run build               # produces lib/ (rebuild and commit it after editing src/)
dsh plugin --profile <profile> add /absolute/path/to/dsh-waifu
```

### Uninstall

```sh
dsh plugin --profile <profile> remove dsh-waifu
```

Private data stays in `$DSH_HOME/waifu/`; delete it manually if you no longer need it.

## Usage

Open DSH **Settings → "dsh-waifu"**. One page, five groups top to bottom: **Display / Touch zones / AI / Speech / Developer**.

### Display

- **Basics** — visibility, size (40–400 px, default **280**), render frame rate (30 / 60 / unlimited), idle micro-motions (a random head tilt / brow raise / weight shift / sigh every 7–16 s when idle)
- **Gaze range** — the head and eyes follow the pointer only when it is inside "model + x %" (default **100 %**, 0 = only inside the model box); otherwise she looks straight ahead
- **Canvas and position** — horizontal / vertical padding (percent of size per side, default **125 / 50**, so motion overshoot is not clipped); default position (centre distance from the window's right / bottom, in percent of window size, default **10 / 0**), with "home" (back to default) and "capture" (make the current spot the default) buttons
- **Bubble** — offset from the top-centre of the model box (default **0 / 24**, positive is upward), background colour (`#ffffff`), opacity (92), text colour (`#222222`), max display seconds (default **10**, 0 = unlimited)
- **Interaction bar** — above / below the model or hidden (default above), with a pixel offset (default **-30**)

### Touch zones (current model)

1. Turn on "preview boxes" — every box is drawn live, and clicking the character fires the matching interaction (editing data is untouched)
2. "+ New zone" → name it
3. "+ Add box" → enter **left / top / right / bottom** as 0–100 % of the model bounding box (**origin bottom-left**: raising "top" grows the box upward, lowering "bottom" grows it downward); several boxes can form an irregular area
4. Use "+ Add interaction" to add **interactions**: a name (sent to the model verbatim, e.g. "pinch", "lick") and a trigger (single click / double click / hover for N ms, 300–10000, default 3000). The name must not be empty. Hover means "pointer rests inside the box long enough"; leaving or pressing resets it, and it fires once per entry. **A zone with no interactions does nothing when clicked**
5. Zones have a **layer order**: the list runs top layer → bottom layer, overlaps resolve to the upper zone, use ↑ / ↓ to reorder; a new zone goes on top
6. Saving is per zone (a "save" button on the card header; structural changes are announced at the top of the group); data lives in `$DSH_HOME/waifu/touch-parts.jsonc`

### AI

- Master switch — when on, everything she says and does is generated live by the model, reusing the provider and key already configured in DSH; when off she is completely silent
- **Provider / model** are dropdowns fed by `GET /api/dsh-waifu/ai-options` (the LLM catalogue registered in DSH); the "test" button runs a self-check and prints the result in the "self-check" row
- **Inject history** (default 20 rounds; 0 = off) — recent successful exchanges are sent along so she can pick up the thread. History entries are one-line snippets like `[16:22] 主人「捏」了「脸」`; only the current round uses the full scene sentence, so 20 rounds no longer repeat the same template 20 times
- **Inject memory** (default 20 entries) — the last N lines of `memory.md` go into the prompt
- **Motions and expressions** card — lists the motions (8) and expressions (10) the model may choose from, each with a checkbox deciding whether it is offered (off = it leaves the prompt catalogue and is filtered out even if written); each row's "meaning" text can be edited (≤80 chars, empty = built-in) and previewed on the character. The "blood" expression is **not** offered by default
- **Trigger mode** — `queue` (wait until the previous line finishes, default) or preempt (cut it off)
- **Minimum interval** (default 1 s, 0 = unlimited), **idle timeout** (default 600 s = speak up after 10 quiet minutes, 0 = off), **same-kind window** (default 10 s — same-kind events collapse into one), **tap gap** (default 1200 ms — only the last tap of a burst survives) and **merge limit** (default 6 entries) — all five windows live in the client scheduler; the host never rejects by rate (ADR-047)
- **Scenes** — 16 event kinds, each with a switch and a text box that can override "how this is described to the model" (empty = built-in, truncated to 60 chars). Only 8 are on by default: thinking / error / done / delivered / waiting / approval granted / approval denied / session open; the five tool kinds, session close and subagent traffic are off by default (too chatty during real sessions)
- **Persona** — edit directly in the text box; "save persona" writes `$DSH_HOME/waifu/persona.md`. The plugin only places that text verbatim at the top of the system prompt — it never parses it or assumes what is inside (think of it as a game cartridge). Without the file the built-in generic persona is used; "restore default" brings it back
- **Memory** — view / edit / save `$DSH_HOME/waifu/memory.md` on the same page

Activity events play a short motion (no bubble, no state change): `tool-read → Glance`, `tool-write → Perk`, `tool-run → Shift`, `tool-agent → Nod`, `tool-other → Tilt`, `approval-granted → Nod`, `approval-denied → ShakeHead`, `session-open → Perk`, `session-close → Sigh`, `subagent-start → Glance`, `subagent-end → Nod`.

### Speech

- Master switch plus **TTS model** (two Qwen models):
  - `qwen/qwen-audio-3.0-tts-plus` (flagship, instruction-controllable): Longan Lingxin (25, warm)
  - `qwen/qwen-audio-3.0-tts-flash` (most female voices, cheaper, **default**): Longan Yuanfei / Fengyue / **Lingxi (default voice)** / Xiaoxin / Huan / Longpaopao / loongmary / loongeva
- Only female voices are listed; see the [Qwen TTS voice list](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts). Voices are model-specific — using one with another model gets a 400 from the provider
- Synthesis goes through OpenRouter `/api/v1/audio/speech` (OpenAI-compatible) using the `OPENROUTER_API_KEY` from the DSH credentials
- **Sync** — text is split at punctuation; the bubble for a clause appears when that clause's audio starts, so text and voice never drift apart
- **Lip-sync** — `ParamMouthOpenY` is driven by the playing audio's energy (opens fast, closes slowly), strength 0–300 % (default 130 %), can be disabled on its own
- **Preview** — a button synthesizes one line with the current model and voice
- Failure handling — with speech off (or a reply with no text) it falls back to a plain text reply; a clause that fails to synthesize just has no audio, its text still shows
- Cost — identical text and parameters hit a local cache (`$DSH_HOME/waifu/tts-cache`, at most 200 clips); a line is usually 2–4 clips
- Browsers only allow audio after a user gesture, so the first poke unlocks playback

### Developer

- Master switch (on by default) → separate toggles for the **debug panel** and **show touch-zone overlays**
- **Debug panel** — top to bottom: **scene demos** (pick any scene and play it through the real trigger path — line, motion, expression and voice are all improvised, scene switches and minimum intervals are bypassed, and it does not consume the real event budget; with the AI master switch off it only logs), **motion preview**, **expression preview**, the **console**, and a final status line (agent state / pet state / version / zone count / current expressions / position and size / model and canvas size)
- **Panel placement** — auto-follows by default (centred above the character, snapping to the top when space is tight; the speech bubble then stacks above the panel). Drag the title bar to move, drag the four corner grips to resize (min 180×140, always kept inside the viewport); on release the geometry is stored in localStorage (key `dsh-waifu.debug-panel:v1`) and the panel stops following the character. Click "↺" on the title bar or double-click it to go back to auto-follow
- **Console** — after "start recording", entries appear in the order they actually happened: `trigger` (what started this round) → `llm.request` (full request JSON including the system prompt, every message and the sampling parameters) → `llm.reply` (the model's complete raw output) → `tts.request` (full request body) → `tts.reply` (bytes / mime / cached / ms) → `play.expression` / `play.motion` / `play.audio` (what was actually applied and each clip's duration). Audio is logged as byte counts only and token deltas are skipped; a single line can hold up to 20000 chars. The viewport is fixed at 20 lines and scrolls; "stop" only pauses (it does not clear), and there are separate "clear" and "copy" buttons

## Defaults

| Setting | Default | Notes |
|---|---|---|
| Size | 280 px | 40–400 |
| Frame rate | 30 | 30 / 60 / unlimited |
| Canvas padding | 125 / 50 | percent of size per side |
| Default position | right 10 / bottom 0 | percent of window size |
| Bubble offset | 0 / 24 | positive = upward |
| Bubble max | 10 s | 0 = unlimited |
| Gaze range | 100 % | 0 = model box only |
| Idle micro-motions | on | every 7–16 s when idle |
| Interaction bar | above model, -30 px | can be hidden |
| AI | on | `openrouter` / `google/gemma-4-31b-it` |
| History / memory | 20 rounds / 20 entries | 0 = off |
| Trigger mode | queue | or preempt |
| Minimum interval | 1 s | 0 = unlimited |
| Idle timeout | 600 s | 0 = off |
| Same-kind window | 10 s | same-kind merged |
| Tap gap | 1200 ms | last tap of a burst |
| Merge limit | 6 entries | oldest dropped |
| Scene switches | 8 of 16 on | see above |
| Speech | on | Flash + Longan Lingxi |
| Lip-sync strength | 130 % | 0–300 |
| Developer / debug panel | on | |

## Configuration files

| File | Contents |
|---|---|
| `$DSH_HOME/waifu/settings.jsonc` | display / rendering / position / bubble / AI / speech scalars |
| `$DSH_HOME/waifu/touch-parts.jsonc` | touch zones (parts: layer, boxes, interactions) |
| `$DSH_HOME/waifu/persona.md` | persona prompt (ADR-025) |
| `$DSH_HOME/waifu/memory.md` | character memory (written by the model, editable, ADR-037) |
| `$DSH_HOME/waifu/tts-cache/` | speech cache (up to 200 clips, safe to clear) |
| `$DSH_HOME/waifu/client.log` | browser-side diagnostics (boot milestones, error stacks) |
| `$DSH_HOME/waifu.json` | displayed position (persisted after dragging / homing) |

All of them are plugin-private JSONC (comments allowed) and can be edited by hand; a broken file falls back to the last good state and is reported in settings.

## Project layout

```text
dsh-waifu/
├── assets/
│   ├── icons/                 # settings navigation icons
│   ├── models/jian/           # the built-in "Jian" model (moc3 / textures / physics3 / cdi3 / model3.json / motions)
│   └── vendor/                # bundled runtime: pixi, Cubism Core, live2d-display
├── src/
│   ├── index.ts               # host entry: plugin row, settings, routes
│   ├── defaults.ts            # every default value (settings, scene texts, motion/expression meanings, TTS catalogue)
│   ├── service.ts             # state machine, activity classification, config snapshot
│   ├── routes.ts              # same-origin API / SSE / asset routes / diagnostics
│   ├── models.ts              # shared types: AI_MOTIONS, expressions, TouchPart, hitTest
│   ├── models-host.ts         # built-in preset loading
│   ├── presets/presets.jsonc  # built-in model and default touch zones (with interactions)
│   ├── settings-store.ts      # settings.jsonc I/O
│   ├── touch-parts.ts         # touch-parts.jsonc I/O (parts / interactions)
│   ├── ai.ts                  # LLM performance: scene text, tag parsing, streaming, persona
│   ├── trace.ts               # trace steps (console debug frames)
│   ├── memory.ts              # memory.md I/O
│   ├── speak.ts               # clause-streaming pipeline (LLM stream → TTS clips → SSE)
│   ├── tts.ts                 # TTS engine (OpenRouter /audio/speech)
│   ├── persist.ts             # displayed-position persistence
│   ├── client-log.ts          # browser diagnostics writer
│   └── client/                # browser half: rendering, settings page, event wiring
├── scripts/gen-jian-motions.mjs  # idempotent motion generation / validation
├── docs/                      # intent / spec / ADRs
├── lib/                       # build output (committed; git installs use it directly)
├── cordis.patch.yml           # DSH bundle patch (inserts the dsh-waifu plugin row)
├── package.json
└── tsdown.config.ts
```

## Development

```sh
bun install
bun run build        # tsdown: lib/index.js (host) + lib/client.js (browser)
bun run typecheck    # tsc --noEmit
bun run test         # vitest (fixed to --pool=threads)
```

- **Always rebuild and commit `lib/`** — git installs consume the committed artifacts, otherwise they get stale code
- After changing motions run `bun scripts/gen-jian-motions.mjs`; it rebuilds `assets/models/jian/motions/` and validates Meta / parameters / references
- If the machine has no global node/bun, use the runtime bundled with the DSH desktop app; see [AGENTS.md](AGENTS.md)
- Docs first: user-visible behaviour changes go to `docs/spec/`; architecture trade-offs get an ADR

## Documentation

| What | Where |
|---|---|
| Product intent | [`docs/intent/dsh-waifu.md`](docs/intent/dsh-waifu.md) |
| Behaviour spec | [`docs/spec/dsh-waifu-v01.md`](docs/spec/dsh-waifu-v01.md) |
| Architecture decisions | [`docs/adr/`](docs/adr/) (index in [`docs/adr/index.md`](docs/adr/index.md)) |
| Contribution rules | [AGENTS.md](AGENTS.md) |

## License

- **Plugin code**: MIT, see [LICENSE](LICENSE); forked from [cyanfish-x/dsh-live2d-pets](https://github.com/cyanfish-x/dsh-live2d-pets)
- **Built-in model "Jian"**: provided by the maintainer (VTube Studio export) and bundled; **confirm the model author's permission before redistributing** (licence note in [`src/presets/presets.jsonc`](src/presets/presets.jsonc))
- **Live2D SDK / Cubism Core**: used under the [Live2D terms](https://www.live2d.com/eula/)

## FAQ

- **No character after installing**: check `dsh plugin --profile <profile> list`, refresh the page, and look for load errors in `$DSH_HOME/waifu/client.log` (a failed model load degrades to a static avatar)
- **Clicking does nothing**: the zone needs at least one **interaction**, and the box must cover the click point — a zone without interactions fires nothing. "Preview boxes" is the quickest way to check
- **No lines at all**: the AI switch is off, or DSH has no provider / key. With a failing model the character deliberately stays silent (no canned fallback). Run "AI → test"
- **No sound**: check the speech switch and that the voice belongs to the selected model (a mismatched voice gets rejected), and click the page once to unlock audio
- **Updated but nothing changed**: the client half updates on refresh, the host half needs a DSH restart
- **Can I use my own model?** Not in this version — it is built around the bundled "Jian"
