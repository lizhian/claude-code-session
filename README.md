# Claude Code Session Picker

[中文](README.zh-CN.md) | English

Interactive Claude Code session picker for the current directory and existing Claude Code workspaces.

## Features

- List Claude Code sessions for the current directory.
- Start a new session or resume an existing session.
- Search sessions interactively.
- Navigate with arrow keys.
- Show short session IDs, relative update time, message counts, first user message, and last user message.
- Switch between normal launch mode and trust launch mode.
- Remember the last selected launch mode.
- Browse existing Claude Code workspaces with the right arrow key.

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

The installer checks that `node` and `claude` are available, copies the picker to `~/.claude-code-session`, makes it executable where applicable, and adds `cc` to your shell profile.

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

The selected launch mode is saved to:

```bash
~/.claude-code-session/config.json
```

## CLI

```bash
node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]
```

Options:

- `--json`: output JSON.
- `--pick`: open the interactive picker.
- `--trust-current-folder`: mark the current folder as trusted in Claude Code config.
- `--cwd <path>`: list sessions for a specific directory.
- `--claude-home <path>`: set Claude home, defaulting to `~/.claude` or `CLAUDE_HOME`.

## Test

```bash
npm test
```
