# Claude Code, Codex, and OpenCode Session Picker

[中文](README.zh-CN.md) | English

Interactive session pickers for Claude Code, Codex, and OpenCode. The existing Claude Code picker keeps using `cc`; Codex uses `cx`; OpenCode uses `oc`.

## Features

- List Claude Code sessions for the current directory.
- List Codex sessions for the current directory.
- List OpenCode sessions for the current directory.
- Start a new session or resume an existing session.
- Search sessions interactively.
- Navigate with arrow keys.
- Show short session IDs, relative update time, message counts, first user message, and last user message.
- Switch between permission modes.
- Remember the last selected permission mode.
- Browse existing Claude Code workspaces with the right arrow key.
- Browse existing Codex sessions and workspaces with the same picker behavior.
- Browse existing OpenCode sessions and workspaces with the same picker behavior.

## Requirements

- Node.js.
- Claude Code CLI for `cc`.
- Codex CLI for `cx`.
- OpenCode CLI and `sqlite3` for `oc`.

## Install

Clone the repository, then run the installer.

macOS/Linux:

```bash
./install.sh
```

Windows PowerShell:

```powershell
.\install.ps1
```

The installer checks that `node` and `claude` are available, and warns if `codex`, `opencode`, or `sqlite3` is missing. OpenCode session browsing reads OpenCode's SQLite database through `sqlite3`. The installer copies the Claude picker to `~/.claude-code-session`, the Codex picker to `~/.codex-code-session`, and the OpenCode picker to `~/.opencode-code-session`, makes them executable where applicable, and adds `cc`, `cx`, and `oc` to your shell profile.

After installing, reload your shell:

```bash
source ~/.zshrc
```

Use `source ~/.bashrc` instead if you use Bash.

On Windows, restart PowerShell or run:

```powershell
. $PROFILE
```

## Usage

```bash
cc
```

For Codex sessions:

```bash
cx
```

For OpenCode sessions:

```bash
oc
```

Interactive controls:

- Type to search.
- Up/down arrows move the selection.
- Enter opens the selected item.
- `Tab` switches permission mode.
- Right arrow opens workspace selection.
- Left arrow returns to the session list.
- `Esc` or `Ctrl-C` cancels.

Permission modes:

- Claude default: runs `claude`.
- Claude auto: runs `claude --enable-auto-mode`.
- Claude full: runs `claude --dangerously-skip-permissions`.
- Codex default: runs `codex`.
- Codex auto: runs `codex --full-auto`.
- Codex full: runs `codex --dangerously-bypass-approvals-and-sandbox`.
- OpenCode default: runs `opencode`.
- OpenCode full: runs `opencode` with `OPENCODE_PERMISSION="allow"`.

OpenCode currently supports only default and full permission modes.

The selected Claude permission mode is saved to:

```bash
~/.claude-code-session/config.json
```

The selected Codex permission mode is saved to:

```bash
~/.codex-code-session/config.json
```

The selected OpenCode permission mode is saved to:

```bash
~/.opencode-code-session/config.json
```

## CLI

```bash
node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
node codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]
node opencode-sessions.js [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]
```

Options:

- `--json`: output JSON.
- `--pick`: open the interactive picker.
- `--trust-current-folder`: mark the current folder as trusted where the underlying tool supports a local trust config. Claude writes `~/.claude.json`, Codex writes `config.toml`, and OpenCode accepts the option for alias compatibility while full permission mode is controlled through `OPENCODE_PERMISSION`.
- `--cwd <path>`: list sessions for a specific directory.
- `--claude-home <path>`: set Claude home, defaulting to `~/.claude` or `CLAUDE_HOME`.
- `--codex-home <path>`: set Codex home, defaulting to `~/.codex` or `CODEX_HOME`.
- `--opencode-data-home <path>`: set OpenCode data home, defaulting to `~/.local/share/opencode` or `OPENCODE_DATA_HOME`.

## Project Structure

- `claude-sessions.js`: Claude Code session CLI.
- `codex-sessions.js`: Codex session CLI.
- `opencode-sessions.js`: OpenCode session CLI. It reads `opencode.db` through `sqlite3`.
- `session-utils.js`: shared config, JSONL, process launching, workspace filtering, and interactive picker helpers.
- `*.test.js`: Node test files for provider behavior and installer behavior.
- `install.sh` and `install.ps1`: installers for aliases/functions.

## Development

```bash
npm test
npm run check
```
