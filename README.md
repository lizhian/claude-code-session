# Agent Session

[中文](README.zh-CN.md) | English

Interactive session pickers for Claude Code, Codex, and OpenCode. Claude Code uses `cc`; Codex uses `cx`; OpenCode uses `oc`.

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
- Browse existing Claude Code, Codex, and OpenCode workspaces with the right arrow key.
- Open Codex and OpenCode configuration actions from the workspace list.

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
- Enter opens the selected session or workspace.
- `Tab` switches permission mode.
- Right arrow opens workspace selection.
- In Codex workspace selection, right arrow opens configurations and `Model provider` switches the global Codex model provider from `~/.codex/config.toml`.
- In OpenCode workspace selection, right arrow opens configurations. `Provider models` syncs model IDs for `@ai-sdk/*` providers, while `Default model` and `Small model` update OpenCode's top-level `model` and `small_model`.
- Left arrow returns to the previous picker view.
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
~/.agent-session/claude-code.json
```

The selected Codex permission mode is saved to:

```bash
~/.agent-session/codex.json
```

Codex model provider selection is saved in `~/.codex/config.toml` as `model_provider_selected`. Before switching providers, the picker backs up the current `~/.codex/auth.json` into the previous provider's `auth_json`. If no previous provider is known, it creates an `unknown-YYYYMMDD-HHmmss` provider with `name` and `auth_json` so current tokens are not lost.

The selected OpenCode permission mode is saved to:

```bash
~/.agent-session/opencode.json
```

OpenCode provider model configuration is read from `~/.config/opencode/opencode.json`. The picker supports JSONC-style input with comments and trailing commas, fetches models with `GET {baseURL}/models` using `options.apiKey`, writes selected model IDs to `provider.<name>.models`, and can update the top-level `model` and `small_model` fields as standard formatted JSON.

## CLI

```bash
node claude/claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
node codex/codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]
node opencode/opencode-sessions.js [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]
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

- `claude/claude-sessions.js`: Claude Code session CLI.
- `codex/codex-sessions.js`: Codex session CLI.
- `opencode/opencode-sessions.js`: OpenCode session CLI. It reads `opencode.db` through `sqlite3`.
- `common/session-utils.js`: shared config, JSONL, process launching, workspace filtering, and interactive picker helpers.
- `common/session-renderer.js`: shared session table, workspace list, and interactive picker rendering.
- `*.test.js`: Node test files for provider behavior and installer behavior.
- `install.sh` and `install.ps1`: installers for aliases/functions.

## Design Notes

- Claude, Codex, and OpenCode keep separate entry files so provider-specific storage and launch flags stay isolated.
- Shared picker behavior lives in `common/session-utils.js` and `common/session-renderer.js`; provider CLIs reuse it with provider-specific titles.
- Permission modes are persisted per provider under `~/.agent-session`.
- OpenCode full permission is passed through `OPENCODE_PERMISSION="allow"` because the OpenCode TUI does not support a matching command-line flag.

## Development

```bash
npm test
npm run check
```
