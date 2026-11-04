# dsh-waifu 🐾

English | [简体中文](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/lof6yo/dsh-waifu)](https://github.com/lof6yo/dsh-waifu/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

A Live2D desk waifu for **DeepSeek Harness (DSH)**: it tilts its head while you think, celebrates when you finish, and you can pet it — **with touch regions you draw yourself**.

It ships one built-in model, **Jian**, and drives motion + speech from **event bindings**: idle / thinking / error / done / delivery / waiting-for-approval. Touch regions are user-defined **touchboxes**: a name, one or more rectangles, a layer order, and per-part lines + motions.

<p align="center">
  <img src="docs/media/hero.jpg" alt="dsh-waifu hero" width="920" />
</p>

## Features

- **Built-in model “Jian”**: shipped inside the package (moc3 / textures / physics / cdi3), no model download; only one motion group is bundled: the authored **Idle**. (The original asset's Scene1 was researched and dropped — most of its target parameters are missing from the exported model, see ADR-017.) This version has **no** model selection/import UI.
- **Event bindings (animation + lines)**: each of the 6 events has motion-group candidates and a line pool; thinking / waiting support three staged line pools (on-entry / 15s / 40s and on-entry / 30s / 90s) with timed progression; each card can reset to defaults.
- **User-defined touchboxes**: no longer relies on the model's HitAreas. A part = name + one or more normalized rectangles (entered as 0–100% of the character bounding box) + layer + its own line pool and touch motion groups. Overlaps resolve by **layer order** (upper part wins), reorderable with ↑/↓.
- **Preview editing**: “Touch parts” → “Preview boxes” draws every box on the character live; click the character in preview mode to try the part's lines/motions.
- **State mirroring**: agent state pushed over SSE; thinking / waiting bubbles persist and evolve by stage; completion and file delivery trigger celebrations.
- **Display settings**: enable, size, render FPS, canvas padding (prevents motion clipping), default position (display-area center distance from the right/bottom) + one-click recenter, bubble offsets / background / text colors.
- **Non-intrusive**: bottom-right by default, small, draggable, hideable; transparent canvas areas are **click-through** (only touchboxes receive clicks, so the pet never blocks the DSH UI); you can drag it half outside the window while its center stays inside the viewport; rendering pauses when the tab is hidden, FPS is capped, and it falls back to a static avatar on low-end devices.
- **Rendering quality**: HiDPI 2× buffer + antialias; the touchbox overlay is drawn at the same scale.
- **Debuggable**: browser-side boot milestones / errors are written to `$DSH_HOME/waifu/client.log` so model-loading problems can be diagnosed without devtools.

## Requirements

- DeepSeek Harness (DSH) **0.2.x** (Desktop or Web)
- Network access to GitHub and the npm registry for install/update
- The package ships prebuilt `lib/` artifacts — **no local build is required** to install it

## Install

### Install directly from GitHub (recommended)

Run in a terminal (`<profile>` is your DSH profile, e.g. `desktop` / `web`):

```sh
dsh plugin --profile <profile> add github:lof6yo/dsh-waifu
```

Or with a full Git URL:

```sh
dsh plugin --profile <profile> add https://github.com/lof6yo/dsh-waifu.git
```

> Equivalent specifiers (depending on the dsh version): `github:lof6yo/dsh-waifu#main`, `github:lof6yo/dsh-waifu#<commit>`.
> The repository commits the built `lib/index.js` and `lib/client.js`, so a git install works without building.

Verify:

```sh
dsh plugin --profile <profile> list
```

The plugin appears as **dsh-waifu**. Refresh (or restart) DSH and “Jian” appears at the bottom-right; you can also check and enable it in DSH Settings → Plugins.

### Local development install

```sh
git clone https://github.com/lof6yo/dsh-waifu.git
cd dsh-waifu
bun install          # dependency install (repository uses bun)
bun run build        # generate lib/ (after editing sources, rebuild and commit lib/)
dsh plugin --profile <profile> add /absolute/path/to/dsh-waifu
```

### Uninstall

```sh
dsh plugin --profile <profile> remove dsh-waifu
```

Plugin-private data stays in `$DSH_HOME/waifu/`; delete it manually if you no longer want it.

## Usage

Open DSH **Settings → “Waifu config”** (single-page sections):

### Display

- **Basics**: enable / size (40–400px) / render FPS (30 / 60 / unlimited)
- **Canvas & position**: horizontal/vertical canvas padding (per-side % of size, default 130 / 70, prevents motion clipping); default position (display-area center distance from the window right/bottom, default 300 / 260) and a “Recenter” button
- **Speech bubble**: horizontal/vertical offset (relative to the character bounding-box top center), background color, background opacity, text color

### Event bindings (current model)

- 6 event cards (idle / thinking / error / done / delivery / waiting-for-approval), collapsed by default
- Each card: multi-select **motion groups** (from the current model `Motions`; none = no motion) + **line pools** as textareas (one line per row, picked randomly; thinking / waiting have 3 stages)
- Edits mark only that card “● Unsaved”; “Save” stores it and shows “Saved HH:MM:SS” in place
- “Reset to default” restores the built-in default motions/lines for that event

### Touch parts (current model)

1. Click “Preview boxes” — the character enters preview mode and shows all touchboxes live; clicking the character triggers the matching part's lines/motions
2. “+ New part” → type a name
3. “+ Add box” → enter **left / top / right / bottom** as percentages of the character bounding box (0–100); boxes render live; one part may have several boxes
4. Each part has its own **lines** (one per row; empty = motion only, no bubble) and **touch motions** (multi-select, picked randomly per touch)
5. Parts have **layers**: list order is top layer → bottom layer; on overlap the upper part wins. Reorder with ↑/↓; new parts go to the top
6. Saves are prompted per part (card-level “Save”; structural changes prompt at the section top) and persisted to `$DSH_HOME/waifu/touch-parts.jsonc`

### Developer options

- Master switch; when enabled you can open the debug panel (state demo, native motion preview) and the “Show touch-part overlay” toggle

### Config files

| File | Content |
|---|---|
| `$DSH_HOME/waifu/settings.jsonc` | scalar display / render / canvas / bubble settings |
| `$DSH_HOME/waifu/touch-parts.jsonc` | touch parts (layers / boxes / lines / motions) and event-binding overrides |
| `$DSH_HOME/waifu/client.log` | browser-side diagnostics (boot milestones / error stacks) |
| `$DSH_HOME/waifu.json` | persisted pet position (drag / recenter) |

All are plugin-private JSONC (comments allowed) and can be edited directly; a broken file falls back to the last good result with an inline settings-page warning.

## Repository layout

```text
dsh-waifu/
├── assets/
│   ├── icons/                 # settings nav icon
│   ├── models/jian/           # built-in Jian model (moc3 / textures / physics3 / cdi3 / model3.json / motions)
│   └── vendor/                # bundled runtime: pixi, Cubism Core, live2d-display
├── src/
│   ├── index.ts               # Host entry: plugin row, settings, routes
│   ├── service.ts             # state machine + event-binding resolution + snapshot
│   ├── routes.ts              # same-origin API / SSE / assets / diagnostics
│   ├── models.ts              # shared types: event bindings, TouchPart/TouchBox, hit-test
│   ├── models-host.ts         # built-in presets loading/resolution
│   ├── settings-store.ts      # plugin-private settings.jsonc
│   ├── touch-parts.ts         # plugin-private touch-parts.jsonc (parts + events)
│   ├── persist.ts             # display-position persistence
│   ├── client-log.ts          # browser diagnostics sink
│   └── client/                # browser half (React): pet, settings page, event bridge
├── scripts/gen-jian-motions.mjs  # Jian motion generator/validator (idempotent)
├── docs/                      # intent / spec / ADRs
├── lib/                       # build output (committed; git install uses it directly)
├── cordis.patch.yml           # DSH bundle patch (inserts the dsh-waifu row)
├── package.json
└── tsdown.config.ts
```

## Development

```sh
bun install
bun run build        # tsdown: lib/index.js (Host) + lib/client.js (browser)
bun run typecheck    # tsc --noEmit
bun run test         # vitest (--pool=threads)
```

- **Rebuild and commit `lib/` before pushing**: git/GitHub installs use the committed `lib/`.
- After editing model motions, run `bun scripts/gen-jian-motions.mjs` (or run it with DSH's bundled node) — it regenerates `assets/models/jian/motions/` and validates meta / parameters / references.
- If the machine has no global node/bun, use the runtime bundled with DSH Desktop (see [AGENTS.md](AGENTS.md)).

## Docs

| Need | Doc |
|------|-----|
| Product intent | [`docs/intent/dsh-waifu.md`](docs/intent/dsh-waifu.md) (Chinese) |
| Behavior spec | [`docs/spec/dsh-waifu-v01.md`](docs/spec/dsh-waifu-v01.md) (Chinese) |
| Architecture decisions | [`docs/adr/`](docs/adr/) (rendering stack ADR-003, bundled model & touchboxes ADR-014, event bindings ADR-015, rename & custom-model removal ADR-016) |
| Dev conventions | [AGENTS.md](AGENTS.md) (Chinese) |

## License

- **Plugin code**: MIT, see [LICENSE](LICENSE); forked and rebuilt from [cyanfish-x/dsh-live2d-pets](https://github.com/cyanfish-x/dsh-live2d-pets).
- **Built-in model “Jian”**: user-provided model (VTube Studio export), bundled with the plugin; **confirm the model author's permission before public distribution** (license annotation in [`src/presets/presets.jsonc`](src/presets/presets.jsonc)).
- **Live2D SDK / Cubism Core**: under [Live2D's terms](https://www.live2d.com/eula/).

## FAQ

- **No pet after install**: confirm `dsh-waifu` is listed by `dsh plugin --profile <profile> list`; refresh the page; check `$DSH_HOME/waifu/client.log` for load errors (the pet falls back to a static avatar if the model fails to load).
- **Touches do nothing**: make sure the “Touch parts” section has parts whose boxes cover the clicked area; use preview mode to try; clicks that miss every box are ignored.
- **Can I use another model / import my own?**: not in this version — it focuses on the built-in “Jian” model.
- **Sound / LLM-driven persona speech**: not included yet; planned later.
