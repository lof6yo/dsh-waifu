# dsh-waifu 🐾

English | [简体中文](README.md)

[![npm](https://img.shields.io/npm/v/dsh-waifu.svg)](https://www.npmjs.com/package/dsh-waifu)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/dsh-waifu.svg)](https://nodejs.org/)
[![GitHub release](https://img.shields.io/github/v/release/lof6yo/dsh-waifu)](https://github.com/lof6yo/dsh-waifu/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

A Live2D desk girl for **DeepSeek Harness (DSH)**: it tilts its head when you think, celebrates when you finish, and you can pet it!

<p align="center">
  <img src="docs/media/hero.jpg" alt="dsh-waifu hero" width="920" />
</p>

## Features

- **Built-in model “Jian”**: shipped with the package (Cubism 4 half-body: moc3 / textures / physics / cdi3) and ready out of the box; the plugin also authors 5 state motions (Idle / Thinking / Error / Done / Waiting) + 3 touch motions (TapHead / TapFace / TapBody), and enables eye-blink and lip-sync parameter groups
- **User-defined touch parts (touchboxes)**: parts are no longer a fixed set (head / hand / leg / body). Settings → “Pet config” → “Touch parts” → “Edit touch parts”: the pet enters preview mode and shows the current boxes live; create a part, type a name, add boxes with left/top/right/bottom percentages (0–100) — one part may own several boxes; each part can map several motion groups. Hit-testing uses the boxes only (smallest overlapping box wins), no model HitAreas needed
- **State mirroring**: the pet reflects agent thinking / idle / error / done / file-delivery celebration / waiting-for-approval (motion + bubbles, SSE push)
- **Event bindings (animation + lines)**: idle / thinking / error / done / delivery / waiting each map to motion-group candidates and a line pool (three stages for long states), editable on the single settings page with a reset-to-default action; the fixed persona system is gone (LLM persona prompts planned)
- **Companionship**: part-based tap reactions / mouse-follow (head, eyes and body look toward the pointer) / free drag docking / task-done celebration
- **Settings panel**: DSH Settings → “Pet config” — single page: display → event bindings → touch parts → developer options; settings are persisted to the plugin-owned `$DSH_HOME/waifu/settings.jsonc` (DSH 0.2.x adaptation, ADR-013); event bindings and touch parts live in `touch-parts.jsonc`, custom models in `custom-models.jsonc`; applies immediately
- **Stay out of the way**: bottom-right by default, small size, draggable, hideable, pause rendering when the tab is hidden, FPS cap, static avatar fallback on low end

## Quick start

### Option A: Paste a prompt for your agent (recommended)

Copy this into a DSH Web GUI chat and let the agent install and verify:

```text
Please install the dsh-waifu plugin (Live2D desk pet for DSH):
1. Run: dsh plugin --profile web add dsh-waifu
2. Run: dsh plugin --profile web list and confirm dsh-waifu is installed
3. Report the result; if it fails, include the error output
```

### Option B: Manual install

```sh
dsh plugin --profile web add dsh-waifu
```

The plugin is enabled by default after install. Start DSH:

```sh
dsh web
```

Open the browser — a default pet (160px) appears at the bottom-right. The default model is the built-in “Jian” (shipped with the package; no model download needed).

### Interaction

- **Mouse follow** (enabled by default): as the pointer moves anywhere on the page, the pet’s head, eyes and body smoothly look toward it; when the pointer leaves the page it resets to face front. It pauses while dragging, hidden, or when the tab/window is not focused.
- **Tap interactions**: taps follow the touch parts you define; taps outside every part trigger nothing.
- **Drag**: hold and drag the pet anywhere, then release to dock it; the position is persisted.

Custom models: Settings → “Pet config” → “My models”, add a name + `.model3.json` URL (CDN, self-hosted static, local HTTP, or an **absolute local path** such as `/Users/me/models/foo/foo.model3.json`; local paths are served by the plugin Host via `/pet-local-models/...`). Expand **Animation mapping** to parse the model’s native motion groups and bind them to the six states.

### Touch parts (touchboxes)

Settings → “Pet config” → “Touch parts”:

1. Click “Edit touch parts” — the pet enters edit mode and draws the current boxes live on the model;
2. Click “New part” and type a name (e.g. “Head”, “Hand”, “Tail”);
3. Click “Add box”, enter left / top / right / bottom as percentages of the model bounding box (0–100); boxes render live as you type;
4. One part may have several boxes (compose irregular regions); each part can define its own **lines** (one per row; empty = motion only, no bubble) and map several motion groups to pick from on touch;
5. Parts have **layers**: the list runs top layer → bottom layer; when boxes overlap the upper part wins. Reorder with “↑ / ↓” (a new part is inserted on top);
6. The “Touch parts” group also offers **state animation mapping (current model)**: multi-select motion groups per state, overriding the built-in “Jian” defaults;
7. Changes are auto-saved to `$DSH_HOME/waifu/touch-parts.jsonc` and take effect after leaving edit mode.

<p align="center">
  <img src="docs/media/settings-pet-config.png" alt="Pet config entry and panel in DSH Settings" width="920" />
</p>

### Configuration

Open **DSH Settings → “Pet config”**. Changes apply immediately — no restart.

- **Show pet**: on / off
- **Size**: 40–400px (default 160)
- **Canvas padding**: horizontal/vertical (per side %, default 130/70) — keeps motion swings from being clipped
- **Default position / recenter**: configure the display-area center distance from the right/bottom edge and recenter with one click
- **Render FPS**: 30 / 60 / unlimited (default 30)
- **Event bindings**: per-event motion groups + line pools (three stages for thinking/waiting), reset-to-default
- **Touch parts**: edit parts / boxes / lines / touch motion mapping (see above)
- **Developer options**: master toggle (off by default); when enabled, shows the debug panel (with native model animation list preview) and the touch-part overlay

### Uninstall

```sh
dsh plugin --profile web remove dsh-waifu
```

## Docs

| Need | Doc |
|------|------|
| Chinese README | [`README.md`](README.md) |
| Product intent | [`docs/intent/dsh-waifu.md`](docs/intent/dsh-waifu.md) (Chinese) |
| Behavior spec | [`docs/spec/dsh-waifu-v01.md`](docs/spec/dsh-waifu-v01.md) (Chinese) |
| Architecture decisions | [`docs/adr/`](docs/adr/) (rendering stack: ADR-003; bundled model & touchboxes: ADR-014) |
| Research notes | [`docs/research/`](docs/research/) (settings panel: settings-tab.md) |

## Stack

- pixi-live2d-display 0.4.0 + PixiJS 6.5.10 + Cubism Core 4 ([ADR-003](docs/adr/003-spike-results-and-rendering-stack.md))
- Client renders in DSH Web GUI `shell.overlay` (Popover top layer, [ADR-005](docs/adr/005-pet-visual-top-layer-popover.md)); settings section on `settings.section` ([ADR-002](docs/adr/002-pet-mount-and-state-source.md))
- State push: Host subscribes to `agent/*` → same-origin SSE `/api/dsh-waifu/events` ([ADR-006](docs/adr/006-push-state-sse.md)); pause when tab hidden / blurred
- Built-in model & authored motions: `assets/models/jian/` + `scripts/gen-jian-motions.mjs` (idempotent motion3.json generator, [ADR-014](docs/adr/014-bundled-jian-model-and-touchbox-parts.md)); touch parts at `~/.dsh/waifu/touch-parts.jsonc`
- Settings: plugin-owned `$DSH_HOME/waifu/settings.jsonc` (DSH 0.2.x settings service adaptation, [ADR-013](docs/adr/013-dsh-0.2.x-settings-plugin-private-file.md)); transport via plugin API `/api/dsh-waifu/settings`

## License

- **Plugin code**: MIT
- **Built-in model “Jian”**: user-provided model (VTube Studio export), shipped inside the package; **confirm the model author's permission before public distribution** ([`src/presets/presets.jsonc`](src/presets/presets.jsonc))
- **Model list**: each entry must record license type + link; NC models marked non-commercial only
- **Live2D SDK**: follow [Live2D official terms](https://www.live2d.com/en/download/cubism-sdk/)
