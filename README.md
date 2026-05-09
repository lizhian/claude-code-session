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
For Claude Code sessions:

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
- In Claude Code workspace selection, right arrow opens configurations. `Model provider` switches the active provider from `~/.claude/settings.json`, while `Opus model`, `Sonnet model`, and `Haiku model` update Claude's default model env fields.
- In Codex workspace selection, right arrow opens configurations and `Model provider` switches the global Codex model provider from `~/.codex/config.toml`.
- In OpenCode workspace selection, right arrow opens configurations. `Provider models` syncs model IDs for `@ai-sdk/*` providers, while `Default model` and `Small model` update OpenCode's top-level `model` and `small_model`.
- Left arrow returns to the previous picker view.
- `Esc` or `Ctrl-C` cancels.

Picker numbering starts at `0`: choose `0` or press Enter at the prompt to create a new session; choose `1` or above to resume an existing session.

Configuration controls:

- From the session list, press right arrow to open workspaces.
- From the workspace list, press Enter to open sessions for that workspace.
- From the workspace list, press right arrow to open provider configurations.
- In multi-select configuration views, press Space to toggle an item and Enter to save.

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

Claude Code configuration:

- Reads `~/.claude/settings.json`.
- Stores the selected permission mode in top-level `permission_mode_selected`.
- Lists `provider.<name>` entries under `Claude Code configurations` -> `Model provider`.
- Stores the active picker-selected provider in top-level `model_provider_selected`.
- Before switching providers, backs up provider-managed fields from `env` into the previously selected `provider.<name>`.
- Copies the selected provider's `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and default Haiku/Opus/Sonnet model fields into `env` while preserving unrelated `env` fields.
- `Opus model`, `Sonnet model`, and `Haiku model` fetch `GET {ANTHROPIC_BASE_URL}/v1/models` with `Authorization: Bearer {ANTHROPIC_AUTH_TOKEN}` from the selected provider, then update both `env` and `provider.<model_provider_selected>`.

Codex model provider configuration:

- Reads `~/.codex/config.toml`.
- Stores the selected permission mode in top-level `permission_mode_selected`.
- Lists `[model_providers.*]` entries under `Codex configurations` -> `Model provider`.
- Stores the active picker-selected provider in top-level `model_provider_selected`.
- Before switching providers, backs up the current `~/.codex/auth.json` into the previous provider's `auth_json`.
- If no previous provider is known, creates an `unknown-YYYYMMDD-HHmmss` provider with `name` and `auth_json` so current tokens are not lost.
- Updates Codex's native top-level `model_provider` only when the target provider has `base_url`; selecting a provider without `base_url` removes `model_provider`.
- When `codex-threadripper` is installed, switching to a different provider from the picker runs `codex-threadripper --codex-home <active CODEX_HOME> --provider <selected provider> sync` once so Codex thread history follows the selected provider.

OpenCode configuration:

- Reads `~/.config/opencode/opencode.json`.
- Supports JSONC-style input with comments and trailing commas.
- Writes back standard formatted JSON.
- Stores the selected permission mode in OpenCode's native top-level `permission` field: `full` writes `permission: "allow"` and `default` writes `permission: "ask"`.
- Removes the legacy unsupported `permission_mode_selected` key when reading or saving OpenCode permission mode.
- `Provider models` lists `@ai-sdk/*` providers with `options.baseURL` and `options.apiKey`, fetches models with `GET {baseURL}/models`, and writes selected model IDs to `provider.<name>.models`.
- If a provider's own model endpoint returns an empty list, providers with the same origin and API key may be used as a fallback model-list source.
- `Default model` writes top-level `model` as `provider/model`.
- `Small model` writes top-level `small_model` as `provider/model`.

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
- `claude/claude-model-providers.js`: Claude Code model provider selection and default model configuration.
- `codex/codex-sessions.js`: Codex session CLI.
- `codex/codex-model-providers.js`: Codex model provider config parsing, auth backup, and provider switching.
- `opencode/opencode-sessions.js`: OpenCode session CLI. It reads `opencode.db` through `sqlite3`.
- `opencode/opencode-provider-models.js`: OpenCode provider model discovery and `opencode.json` updates.
- `common/session-utils.js`: shared config, JSONL, process launching, workspace filtering, and interactive picker helpers.
- `common/session-renderer.js`: shared session table, workspace list, and interactive picker rendering.
- `common/session-transcript.js`: shared transcript normalization and preview limits.
- `common/provider-runner.js`: shared provider CLI run flow for JSON, picker, and fallback prompt modes.
- `*.test.js`: Node test files for provider behavior and installer behavior.
- `install.sh` and `install.ps1`: installers for aliases/functions.

## Design Notes

- Claude, Codex, and OpenCode keep separate entry files so provider-specific storage and launch flags stay isolated.
- Shared picker behavior lives in `common/session-utils.js` and `common/session-renderer.js`; provider CLIs reuse it with provider-specific titles.
- Claude and Codex permission modes are persisted in each provider's native config as `permission_mode_selected`.
- OpenCode permission mode is persisted in its native `permission` field and full permission is also passed through `OPENCODE_PERMISSION="allow"` for CLI compatibility.

## Development

```bash
npm test
npm run check
```
