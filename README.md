# Claude Code and Codex Session Picker

[中文](README.zh-CN.md) | English

Interactive session pickers for Claude Code and Codex. The existing Claude Code picker keeps using `cc`; the Codex picker is available as `cx`.

## Features

- List Claude Code sessions for the current directory.
- Start a new session or resume an existing session.
- Search sessions interactively.
- Navigate with arrow keys.
- Show short session IDs, relative update time, message counts, first user message, and last user message.
- Switch between normal launch mode and trust launch mode.
- Remember the last selected launch mode.
- Browse existing Claude Code workspaces with the right arrow key.
- Browse existing Codex sessions and workspaces with the same picker behavior.

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

The installer checks that `node` and `claude` are available, and warns if `codex` is missing. It copies the Claude picker to `~/.claude-code-session`, copies the Codex picker to `~/.codex-code-session`, makes them executable where applicable, and adds `cc` and `cx` to your shell profile.

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

Interactive controls:

- Type to search.
- Up/down arrows move the selection.
- Enter opens the selected item.
- `Tab` switches launch mode.
- Right arrow opens workspace selection.
- Left arrow returns to the session list.
- `Esc` or `Ctrl-C` cancels.

Launch modes:

- Normal mode: runs `claude`.
- Trust mode: runs `claude --dangerously-skip-permissions`.
- Codex normal mode: runs `codex`.
- Codex trust mode: runs `codex --dangerously-bypass-approvals-and-sandbox`.

The selected Claude launch mode is saved to:

```bash
~/.claude-code-session/config.json
```

The selected Codex launch mode is saved to:

```bash
~/.codex-code-session/config.json
```

## CLI

```bash
node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
node codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]
```

Options:

- `--json`: output JSON.
- `--pick`: open the interactive picker.
- `--trust-current-folder`: mark the current folder as trusted in Claude Code config.
- `--cwd <path>`: list sessions for a specific directory.
- `--claude-home <path>`: set Claude home, defaulting to `~/.claude` or `CLAUDE_HOME`.
- `--codex-home <path>`: set Codex home, defaulting to `~/.codex` or `CODEX_HOME`.

## Test

```bash
npm test
```
