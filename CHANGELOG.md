# Changelog

All notable changes to this bundle are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project does not yet follow Semantic Versioning strictly; `2.0.0` marks the
rules + memory architecture change.

## [2.0.0] — 2026-11-18

### Added
- **Memory layer** as a peer to rules: "记住 X" notes are stored in
  `$DSH_HOME/user-standards.json` and surfaced as a short per-project index via
  dynamic system-prompt context; full content is fetched on demand with the new
  `user_standards_recall` tool.
- **Scope field** (`user` | `project`) on both rules and memories. Project scope
  resolves to the nearest `.git` root and writes a managed block into that
  project's `AGENTS.md`.
- Per-agent memory index: `agent.ctx.systemPrompt.context()` with a text function
  evaluates the index for each session's own working directory.
- Settings page tabs for **Rules** / **Memories**, plus `rememberDefault` and
  `memoryIndexMax` config keys.
- State migration from v1 (`version: 1` → `version: 2`, rules gain `scope`).

### Changed
- `user_standards_save` gained `layer` (rule|memory) and `scope` (user|project)
  parameters; auto-detects layer from the user's wording.
- Nudge labels are chosen by **intent** (explicit request vs repeated
  correction), not by the resulting storage layer.
- Project paths are normalized through `.git` detection everywhere (save,
  recall, index) so an entry cannot be written to one path and looked up under
  another.
- Settings-page additions are always global; project-scoped entries must be
  created in-session where the working directory is known.

### Fixed
- Stale managed block: removing the last project rule left its `AGENTS.md` block
  injected forever. Every ever-managed project path is now re-rendered.
- `memoryIndexMax: 0` was coerced back to `20`; explicit finite-number clamping
  now allows 0 (disables the index).
- Config persistence accepted `{action:'config', patch:{...}}` only; the UI now
  uses that shape.
- Detail-page metadata: `meta.detail` now points to `docs/DETAIL.md` /
  `docs/DETAIL.zh.md` instead of inline prose, fixing the Plugin Manager
  "详细介绍文件无效" error.
- Nudge chip was consumed by the agent before the user could see it; agent
  notification and user-facing claiming are now separate flags.

## [1.0.0] — 2026-11-18

### Added
- Initial bundle: rules-only, user-global scope, AGENTS.md managed block.
- Settings page (`settings.section`), conservative correction nudges
  (`agent/turn-stopping` + `conversation.chat.turnTail`), and the
  `user_standards_save` tool.
- `/habit-save` and `/habit-list` slash commands.
- Same-origin HTTP bridge (`/dsh-user-standards/state|suggestion|update`) shared
  by the settings UI, tools and commands.
