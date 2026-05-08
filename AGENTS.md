# Repository Guidelines

## Project Structure & Module Organization

This repository contains small Node.js CLIs for browsing Claude Code, Codex, and OpenCode sessions. Keep the provider CLIs additive: changes for `cx` or `oc` should not regress the existing `cc` behavior.

- `claude/claude-sessions.js`: Claude Code executable and exported helpers for listing, formatting, and launching sessions.
- `claude/claude-model-providers.js`: Claude Code model provider selection and default model configuration.
- `codex/codex-sessions.js`: Codex executable with Codex-specific session parsing and launch commands.
- `opencode/opencode-sessions.js`: OpenCode executable. It reads OpenCode's SQLite database through `sqlite3`.
- `common/session-utils.js`: shared config, JSONL, command launching, workspace filtering, and interactive picker state helpers.
- `common/session-renderer.js`: shared session table, workspace list, and interactive picker rendering.
- `claude-sessions.test.js`, `codex-sessions.test.js`, and `opencode-sessions.test.js`: unit tests for provider-specific parsing, formatting, config, picker behavior, and launch commands.
- `install.sh`: macOS/Linux installer that copies only detected agent CLIs plus shared support files and adds matching `cc`, `cx`, and/or `oc` aliases.
- `install.ps1`: Windows PowerShell installer that adds matching `cc`, `cx`, and/or `oc` functions for detected agent CLIs.
- `install.test.js` and `install-windows.test.js`: installer behavior and smoke tests.
- `README.md` and `README.zh-CN.md`: user-facing documentation.
- `package.json`: npm metadata, binary entries, and test/check scripts.

Provider-specific code lives in the provider directories. Shared support scripts live in `common/`. Tests remain co-located at the root unless the codebase grows enough to justify a dedicated test directory.

## Build, Test, and Development Commands

- `npm test`: runs all tests with Node's built-in test runner.
- `npm run check`: syntax-checks the CLI/shared JavaScript files and validates `install.sh` with `bash -n`.
- `node claude/claude-sessions.js --json`: lists sessions for the current directory as JSON.
- `node codex/codex-sessions.js --json`: lists Codex sessions for the current directory as JSON.
- `node opencode/opencode-sessions.js --json`: lists OpenCode sessions for the current directory as JSON.
- `node claude/claude-sessions.js --pick`: opens the interactive picker locally.
- `node codex/codex-sessions.js --pick`: opens the Codex picker locally.
- `node opencode/opencode-sessions.js --pick`: opens the OpenCode picker locally.
- `./install.sh` or `.\install.ps1`: installs aliases/functions only for agent CLIs currently found in `PATH`.

## Coding Style & Naming Conventions

Use CommonJS modules, two-space indentation, double quotes, and semicolons to match the existing JavaScript. Prefer small pure helper functions that can be exported and tested. Use camelCase for functions and variables, UPPER_SNAKE_CASE only for constants such as `DEFAULT_CONFIG_PATH`. Shell scripts should keep `set -euo pipefail`; PowerShell should keep `$ErrorActionPreference = "Stop"`.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name tests after the behavior under test, for example `test("loads default permission mode when config is missing or invalid", ...)`. Keep tests co-located in root-level `*.test.js` files. Add coverage for CLI parsing, JSONL edge cases, SQLite session rows, config writes, permission-to-command mapping, zero-based picker choices, installer idempotency, and conditional alias installation when changing those areas.

## Commit & Pull Request Guidelines

Recent history uses conventional commit prefixes such as `feat:`, `fix:`, and `docs:`. Keep commits scoped to one logical change. Pull requests should include a short summary, test results such as `npm test` and `npm run check`, any linked issue, and screenshots or terminal output when interactive picker behavior changes.

## Security & Configuration Tips

Do not commit generated files from `~/.agent-session`, `~/.claude`, `~/.codex`, or OpenCode's data directory. Be careful with permission flags: Claude full uses `--dangerously-skip-permissions`, Codex full uses `--dangerously-bypass-approvals-and-sandbox`, and OpenCode full uses `OPENCODE_PERMISSION="allow"` instead of an unsupported TUI flag. Claude/Codex support default, auto, and full permission modes; OpenCode currently supports default and full only. Keep the picker labels in English (`Permission`, `Matches`, `Search`) and keep status columns fixed-width so changing values do not move later fields. Changes around permission mode or `--trust-current-folder` should be explicit in the PR description and covered by tests where possible.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `lizhian/agent-session`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain docs layout. See `docs/agents/domain.md`.
