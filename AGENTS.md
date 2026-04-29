# Repository Guidelines

## Project Structure & Module Organization

This repository contains a small Node.js CLI for browsing Claude Code sessions.

- `claude-sessions.js`: main executable and exported helpers for listing, formatting, and launching sessions.
- `claude-sessions.test.js`: unit tests for session parsing, formatting, config, and picker behavior.
- `install.sh`: macOS/Linux installer that copies the CLI and adds the `cc` alias.
- `install.ps1`: Windows PowerShell installer that adds a `cc` function.
- `install.test.js` and `install-windows.test.js`: installer behavior and smoke tests.
- `README.md` and `README.zh-CN.md`: user-facing documentation.

There are no separate `src/`, `test/`, or asset directories; keep new project files at the root unless the codebase grows enough to justify a directory split.

## Build, Test, and Development Commands

- `npm test`: runs all tests with Node's built-in test runner.
- `npm run check`: syntax-checks `claude-sessions.js` and validates `install.sh` with `bash -n`.
- `node claude-sessions.js --json`: lists sessions for the current directory as JSON.
- `node claude-sessions.js --pick`: opens the interactive picker locally.
- `./install.sh` or `.\install.ps1`: installs the CLI alias/function for manual verification.

## Coding Style & Naming Conventions

Use CommonJS modules, two-space indentation, double quotes, and semicolons to match the existing JavaScript. Prefer small pure helper functions that can be exported and tested. Use camelCase for functions and variables, UPPER_SNAKE_CASE only for constants such as `DEFAULT_CONFIG_PATH`. Shell scripts should keep `set -euo pipefail`; PowerShell should keep `$ErrorActionPreference = "Stop"`.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name tests after the behavior under test, for example `test("loads normal launch mode when config is missing or invalid", ...)`. Keep tests co-located in root-level `*.test.js` files. Add coverage for CLI parsing, JSONL edge cases, config writes, and installer idempotency when changing those areas.

## Commit & Pull Request Guidelines

Recent history uses conventional commit prefixes such as `feat:`, `fix:`, and `docs:`. Keep commits scoped to one logical change. Pull requests should include a short summary, test results such as `npm test` and `npm run check`, any linked issue, and screenshots or terminal output when interactive picker behavior changes.

## Security & Configuration Tips

Do not commit generated files from `~/.claude-code-session` or `~/.claude`. Be careful with `--dangerously-skip-permissions`; changes around trust mode or `--trust-current-folder` should be explicit in the PR description and covered by tests where possible.
