# Agent Session

[中文](README.zh-CN.md) | English

Interactive session pickers for Claude Code, Codex, and OpenCode. Single binary, zero runtime dependencies.

- `cc` — Claude Code sessions
- `cx` — Codex sessions
- `oc` — OpenCode sessions

## Features

- List Claude Code, Codex, and OpenCode sessions for the current directory.
- Start a new session or resume an existing session.
- Search sessions interactively with a fixed-column status line.
- Navigate with arrow keys.
- Show short session IDs, relative update time, message counts, first/last user messages.
- Switch between permission modes (Tab).
- Remember the last selected permission mode.
- Browse workspaces with the right arrow key.
- Configure model providers, default models, and provider-specific settings.
- Single binary with symlink dispatch: `cc`/`cx`/`oc` → `agent-session`.
- Zero runtime dependencies — no Node.js, no sqlite3, no Go needed at runtime.

## Install

macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/lizhian/agent-session/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/lizhian/agent-session/main/install.ps1 | iex
```

The installer downloads a pre-compiled binary from GitHub Releases, creates `cc`/`cx`/`oc` symlinks (hardlinks on Windows), and adds the install directory to your PATH.

After installing, reload your shell:

```bash
source ~/.zshrc    # or source ~/.bashrc
```

On Windows, restart PowerShell or run:

```powershell
. $PROFILE
```

## Usage

```bash
cc              # Claude Code sessions
cx              # Codex sessions
oc              # OpenCode sessions
```

Interactive controls:

- Type to search.
- Up/down arrows move the selection.
- Enter opens the selected session or workspace.
- `Tab` switches permission mode.
- Right arrow opens workspace selection.
- Left arrow returns to the previous view.
- `Esc` or `Ctrl-C` cancels.

Picker numbering starts at `0`: choose `0` for a new session; choose `1+` to resume an existing session.

Permission modes:

| Mode    | Claude                                          | Codex                                               | OpenCode                          |
|---------|-------------------------------------------------|-----------------------------------------------------|-----------------------------------|
| Default | `claude`                                        | `codex`                                             | `opencode`                        |
| Auto    | `claude --enable-auto-mode`                     | `codex --full-auto`                                 | —                                 |
| Full    | `claude --dangerously-skip-permissions`         | `codex --dangerously-bypass-approvals-and-sandbox`  | `OPENCODE_PERMISSION="allow"`     |

## CLI

```bash
cc [--json | --pick] [--cwd <path>] [--claude-home <path>]
cx [--json | --pick] [--cwd <path>] [--codex-home <path>]
oc [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]
```

Options:

- `--json`: output JSON for scripting.
- `--pick`: open the interactive picker.
- `--trust-current-folder`: mark current folder as trusted.
- `--cwd <path>`: list sessions for a specific directory.
- `--claude-home <path>`: Claude config directory (default `~/.claude`).
- `--codex-home <path>`: Codex config directory (default `~/.codex`).
- `--opencode-data-home <path>`: OpenCode data directory (default `~/.local/share/opencode`).

## Project Structure

```
cmd/agent-session/main.go     # Binary entry point, symlink dispatch
internal/
  provider/                   # Provider interface
  claude/                     # Claude Code provider (JSONL, settings.json)
  codex/                      # Codex provider (JSONL, config.toml, thread sync)
  opencode/                   # OpenCode provider (SQLite, JSONC config)
  picker/                     # bubbletea TUI, 6-view state machine
  render/                     # ANSI, CJK width, formatting
  session/                    # JSONL parser, config, permission, runner, transcript
```

## Development

```bash
go test ./...
go vet ./...
go build -ldflags="-s -w" -o agent-session ./cmd/agent-session/
```

## Release

Push a tag to trigger the CI pipeline:

```bash
git tag v0.0.1
git push origin --tags
```

GitHub Actions cross-compiles for darwin-arm64, darwin-amd64, linux-amd64, linux-arm64, and windows-amd64, then creates a release with binaries and checksums.
