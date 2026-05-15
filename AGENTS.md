# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Go CLI (`agent-session`) for browsing Claude Code, Codex, and OpenCode sessions. A single dispatcher binary selects an agent provider either from the invoked command name (`c`, `cx`, `oc`) or from the first subcommand (`agent-session c`, `agent-session cx`, `agent-session oc`). Use the domain terms in `CONTEXT.md` when describing these concepts.

- `cmd/agent-session/main.go`: Dispatcher binary entry point. Resolves the public command and launches the matching provider implementation.
- `internal/provider/provider.go`: Provider interface and shared provider-facing data types.
- `internal/claude/`: Claude Code provider implementation — JSONL session parsing, `settings.json` config, model provider selection, HTTP model fetch.
- `internal/codex/`: Codex provider implementation — recursive JSONL discovery, TOML config parsing, auth backup, thread sync via `codex-threadripper`.
- `internal/opencode/`: OpenCode provider implementation — SQLite via `modernc.org/sqlite` (pure Go, no CGO), JSONC config parsing, provider model fetch.
- `internal/picker/picker.go`: bubbletea session picker with seven picker views (sessions, preview, terminal preview, workspaces, configurations, config items, config subitems).
- `internal/render/render.go`: ANSI styling, CJK width calculation, table formatting.
- `internal/session/`: Shared utilities — JSONL parser, config read/write, permission modes, command runner, transcript preview.
- `install.sh`: macOS/Linux installer. Downloads pre-compiled binary from GitHub Releases, creates symlinks plus shell functions, and adds the install directory to PATH.
- `install.ps1`: Windows installer. Downloads binary, creates hardlinks plus PowerShell functions, and adds the install directory to the PowerShell profile.
- `.github/workflows/release.yml`: GitHub Actions CI. Cross-compiles on `v*` tags, uploads binaries + checksums to GitHub Release.
- `README.md`: User-facing documentation in Chinese.
- `go.mod` / `go.sum`: Go module definition and dependency checksums.

Keep the provider implementations additive: changes for `cx` or `oc` should not regress the existing `c` behavior.
Do not document or reintroduce unsupported public flags such as `--json`, `--pick`, or `--trust-current-folder` unless the dispatcher and provider argument parsers are implemented first.

## Build, Test, and Development Commands

- `go test ./...`: runs all tests.
- `go vet ./...`: static analysis.
- `go build -ldflags="-s -w" -o agent-session ./cmd/agent-session/`: builds a stripped binary (~10MB).
- `./agent-session c`: opens the interactive Claude picker.
- `./agent-session cx`: opens the Codex picker.
- `./agent-session oc`: opens the OpenCode picker.
- `./agent-session c --cwd <path>`: opens the Claude picker for a specific directory.
- `./agent-session cx --cwd <path>`: opens the Codex picker for a specific directory.
- `./agent-session oc --cwd <path>`: opens the OpenCode picker for a specific directory.
- `./agent-session c --help`, `./agent-session cx --help`, `./agent-session oc --help`: show provider-specific supported options.

## Coding Style & Naming Conventions

Follow Go conventions: `gofmt` formatting, camelCase for unexported names, PascalCase for exported names. Prefer small pure functions that can be tested independently. Use table-driven tests with `t.Run`. Shell scripts keep `set -euo pipefail`; PowerShell keeps `$ErrorActionPreference = "Stop"`.

## Testing Guidelines

Tests use the standard `testing` package and `go test`. Name tests after the behavior under test. Keep test files next to the code they test (e.g., `internal/claude/config_test.go`). Add coverage for JSONL edge cases, SQLite session rows, config writes, permission-to-command mapping, TOML parsing, JSONC parsing, public-command dispatch, and picker navigation.

## Commit & Pull Request Guidelines

Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`. Keep commits scoped to one logical change. Pull requests should include a short summary, `go test ./...` and `go vet ./...` results, and any linked issue.

## Release Process

Push a `v*` tag to trigger the GitHub Actions release pipeline:

```bash
git tag v0.0.1
git push origin --tags
```

This cross-compiles for darwin-arm64, darwin-amd64, linux-amd64, linux-arm64, and windows-amd64, then creates a GitHub Release with binaries and `checksums.txt`.

Users install with:

```bash
curl -fsSL https://raw.githubusercontent.com/lizhian/agent-session/main/install.sh | sh
```

## Security & Configuration Tips

Do not commit generated files from `~/.agent-session`, `~/.claude`, `~/.codex`, or OpenCode's data directory. Be careful with permission modes: Claude full launches `claude --dangerously-skip-permissions`, Codex full launches `codex --dangerously-bypass-approvals-and-sandbox`, and OpenCode full launches `opencode` with `OPENCODE_PERMISSION="allow"` instead of an unsupported TUI flag. Claude/Codex support default, auto, and full permission modes; OpenCode currently supports default and full only. Keep the picker labels in English (`Permission`, `Matches`, `Search`) and keep status columns fixed-width so changing values do not move later fields.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `lizhian/agent-session`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain docs layout. See `docs/agents/domain.md`.
Read `CONTEXT.md` before changing provider, picker, configuration, or documentation language. Prefer its terms (`Dispatcher binary`, `Public command`, `Provider implementation`, `Session picker`, `Configurations view`) over retired names such as `Provider CLI` or JS-era layout terms.
