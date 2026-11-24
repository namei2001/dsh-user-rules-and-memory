# DSH User Standards · 用户习惯与规则

[![CI](https://github.com/namei2001/dsh-user-rules-and-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/namei2001/dsh-user-rules-and-memory/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](CHANGELOG.md)

> English &nbsp;·&nbsp; [中文](README.zh.md)

A cross-project user-standards plugin for [the agent runtime](http://127.0.0.1:58749) (DSH 0.2.2-rc.3+).

**Rules are hard constraints, injected every session. Memories are soft notes — only an index is injected, and the full text is retrieved on demand. Both can be global (all projects) or project-scoped.**

![Rules are always injected; memories inject only an index and are fetched on demand via recall](docs/preview.svg?v=3)

---

## Why it exists

DSH itself has **no** user-habit / memory configuration: no `MEMORY.md` / `SOUL.md` / `USER.md`, and no automatic memory (memory is only an optional, default-off third-party MCP). But it does provide two reliable mechanisms:

1. User-global and project-level `AGENTS.md` / `CLAUDE.md` instruction chains, injected automatically every session (65,536-byte budget per chain);
2. Per-agent scoped system-prompt context that can be evaluated dynamically at each assembly.

This plugin **reuses** those two mechanisms and adds a lightweight memory index plus a `recall` tool — it does not reimplement prompt injection, nor does it touch the profile's `cordis.patch.yml`.

Mainstream agents (Claude Code / Cursor / WorkBuddy / Windsurf) all strictly separate *memory* from *rules*. This plugin follows that mature design and fills the gap DSH was missing.

## Features at a glance

### Two layers × two scopes

| | **Rules (hard constraints)** | **Memories (soft notes)** |
|---|---|---|
| **Global (user)** | `$DSH_HOME/AGENTS.md`, injected into **all** projects | Global memory store; lightweight index injected globally |
| **Project** | `<project-root>/AGENTS.md`, injected for that project only | Project memory; index visible only for that project |

- **Rules** — explicit constraints. Triggered by wording like "write to config / from now on / always / make it a rule / mandatory"; always injected.
- **Memories** — implicit notes. Triggered by "remember X / remember this / save this"; only a one-line index is injected, and the agent fetches full content via `user_standards_recall` when relevant, saving context budget.

### Three core capabilities

1. **Proactive configuration** — manage rules and memories in separate tabs under **Settings → User standards**, including scope, category, reminder thresholds, defaults, and the memory-index size.
2. **Conservative reminders** — listens for corrections and explicit intent in user messages; when the same correction reaches the threshold (default 2), it gives a restrained end-of-turn reminder and shows a save chip, with a cooldown to avoid nagging. The target layer (rule/memory) is decided by the user's wording, and the reminder label reflects **intent**, not the storage target.
3. **Instant saving** — "remember X" saves as a memory by default; "write to config / rule / from now on" saves immediately as a rule. Manual saving is also available via tool or slash command.

### Tools and commands

| Entry | Description |
|---|---|
| `user_standards_save` | Params: `text`, `layer` (rule\|memory), `scope` (user\|project), `category`, `reason`; infers layer from wording |
| `user_standards_recall` | Params: `query`, `limit`; finds relevant memories by keyword / token overlap |
| `/habit-save <text>` | Saves as a rule by default; add `--memory` to save as a memory |
| `/habit-list` | Lists all rules and memories |

> Entries added from the global settings page are always `user` scope. For project-specific entries, ask the agent to save them in-session (where the working directory is known) so the current project root is bound automatically.

## Installation

From this project directory, install it as a local bundle through the plugin manager:

```
plugin_manager install_bundle { target: "<absolute path to this directory>" }
```

Do not hand-edit the profile's `cordis.patch.yml`. Once enabled:

- a **User standards** entry appears in Settings;
- a save-reminder chip appears at the bottom of conversations;
- global rules are injected into **every** project automatically.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `nudgesEnabled` | `true` | Master switch for repeated-correction reminders |
| `repeatThreshold` | `2` | How many times the same correction occurs before suggesting a save (1–10) |
| `cooldownMinutes` | `30` | Minimum interval between two reminders (0–1440) |
| `confirmOnNudge` | `true` | Ask for confirmation before saving an inferred suggestion |
| `autoSaveOnExplicit` | `true` | Treat an explicit "remember" as direct save authorization |
| `rememberDefault` | `memory` | "Remember X" saves as `memory` or `rule` |
| `memoryIndexMax` | `20` | Max number of memory-index lines always injected (0 = disable index) |

## How it works

1. **Structured state**: `$DSH_HOME/user-standards.json` (v2, migrated from v1 automatically) stores rules, memories, config, observations, and reminder state.
2. **Rule rendering**: written into a managed block in `AGENTS.md` — `<!-- BEGIN DSH USER STANDARDS ... -->` … `<!-- END DSH USER STANDARDS -->`; only this plugin's block is rewritten, all other content is preserved.
3. **Automatic injection**: `dsh-agent-instructions` handles injecting `AGENTS.md`; the project root is located by walking up to the nearest `.git`.
4. **Memory index**: `agent.ctx.systemPrompt.context()` evaluates the index against each session's working directory, so each session only sees the index relevant to its own project.
5. **Single backend**: the settings page, tools, and commands share one Host store via a same-origin HTTP bridge (`/dsh-user-standards/state|suggestion|update`).

## FAQ

**Q: Why doesn't "remember X" write straight into AGENTS.md?**
A: That's a memory (soft note), not a rule (hard constraint). Dumping everything into AGENTS.md burns the 65,536-byte injection budget and dilutes attention. Memories inject only a one-line index; the agent retrieves the full text with `user_standards_recall` when needed. If you really want a hard constraint, say "from now on / mandatory / write to config".

**Q: How do I add project-specific content?**
A: Ask the agent to save it in-session with `scope: project`. It walks up to the nearest `.git` as the project root and writes the rule into that project's `AGENTS.md`. The settings page can only add global content.

**Q: After removing the last project rule, does it linger in AGENTS.md?**
A: No. The plugin tracks every project path it has ever managed and re-renders an empty block on deletion, so deleted rules never remain injected.

## Project structure

```text
dsh-user-standards/
├── .github/workflows/ci.yml    # CI: syntax + manifest tests + health check
├── docs/
│   ├── DETAIL.md               # Plugin detail page (English, single image)
│   ├── DETAIL.zh.md            # Plugin detail page (Chinese, single image)
│   └── preview.svg             # Feature diagram (760×400)
├── scripts/healthcheck.mjs     # Manifest / locale / docs + live /state health check
├── tests/manifest.test.mjs     # Static tests, no running Harness required
├── .env.example                # Env var template (no real secrets)
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                     # MIT
├── README.md                   # This document (English, primary)
├── README.zh.md                # This document (Chinese)
├── client.js                   # Client half: settings page + conversation chip
├── index.js                    # Host half: store / tools / commands / HTTP bridge
├── cordis.patch.yml            # Bundle insert declaration
├── icon.svg                    # Plugin icon (36×36)
├── locale/{en,zh}.json
└── package.json                # Bundle manifest and dsh config
```

> Note: this is a JS bundle, not a Python package, so it uses the JS equivalent of a `pyproject.toml` / `src/` layout — `package.json` plays the role of `pyproject.toml`, `index.js` + `client.js` are the sources, with tests in `tests/` and scripts in `scripts/`.

## Development

```powershell
# Syntax check (using the session's Electron-as-node)
$env:ELECTRON_RUN_AS_NODE='1'
& $env:DSH_NODE_EXECUTABLE --check index.js
& $env:DSH_NODE_EXECUTABLE --check client.js

# Static tests (CI runs these with real Node; this sandbox blocks child-process spawn with EPERM)
& $env:DSH_NODE_EXECUTABLE --test tests/manifest.test.mjs

# Health check (writes result to scripts/healthcheck.out.txt)
& $env:DSH_NODE_EXECUTABLE scripts/healthcheck.mjs
```

After changes, reload the bundle: set `plugin_manager set_bundle` to `enabled:false`, then `enabled:true`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog & License

See [CHANGELOG.md](CHANGELOG.md). Current version: **2.0.0** (rules + memory architecture). Licensed under [MIT](LICENSE).
