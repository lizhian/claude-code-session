# Claude Code, Codex, and OpenCode Session Picker

[中文](README.zh-CN.md) | English

Interactive session pickers for Claude Code, Codex, and OpenCode. The existing Claude Code picker keeps using `cc`; Codex uses `cx`; OpenCode uses `oc`.

## Features

- List Claude Code sessions for the current directory.
- List Codex sessions for the current directory.
- List OpenCode sessions for the current directory.
- Start a new session or resume an existing session.
- Search sessions interactively with a fixed-column status line: `Permission`, `Matches`, and `Search`.
- Navigate with arrow keys.
- Show short session IDs, relative update time, message counts, first user message, and last user message.
- Switch between permission modes.
- Remember the last selected permission mode.
- Use zero-based picker numbering: `0` creates a new session, `1` resumes the first existing match.
- Browse existing Claude Code workspaces with the right arrow key.
- Browse existing Codex sessions and workspaces with the same picker behavior.
- Browse existing OpenCode sessions and workspaces with the same picker behavior.

## Requirements

- Node.js.
- Claude Code CLI for `cc`.
- Codex CLI for `cx`.
- OpenCode CLI and `sqlite3` for `oc`.

Only Node.js is required to run the installer. Install at least one supported agent CLI before installing aliases.

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

The installer checks which supported agent CLIs are available in `PATH`, then installs only the matching picker scripts and aliases/functions. For example, if only `codex` is installed, it installs only `cx`. If none of `claude`, `codex`, or `opencode` is found, installation fails. OpenCode session browsing reads OpenCode's SQLite database through `sqlite3`; if `opencode` is installed but `sqlite3` is missing, the installer warns and still installs `oc`.

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

Picker numbering starts at `0`: choose `0` or press Enter at the prompt to create a new session; choose `1` or above to resume an existing session.

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

## Design Notes

- Claude, Codex, and OpenCode keep separate entry files so provider-specific storage and launch flags stay isolated.
- Shared picker behavior lives in `session-utils.js` and the Claude renderer; Codex/OpenCode reuse it with provider-specific titles.
- Permission modes are persisted per provider under each install config directory.
- OpenCode full permission is passed through `OPENCODE_PERMISSION="allow"` because the OpenCode TUI does not support a matching command-line flag.

## Development

```bash
npm test
npm run check
```
