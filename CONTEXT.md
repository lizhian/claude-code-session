# Agent Session

Agent Session is a small CLI toolkit for listing, filtering, and reopening local sessions created by different coding agents.

## Language

**Agent provider**:
A supported coding-agent product whose local session history can be browsed by this project.
_Avoid_: Agent, backend

**Model provider**:
A selectable model backend configuration inside an **Agent provider**.
_Avoid_: Provider

**Model provider selection state**:
A top-level provider config state that records the current **Model provider** in `model_provider_selected` when the **Agent provider** supports that field.
_Avoid_: Default provider inference

**Permission mode selection state**:
A top-level provider config state that records the current permission mode in `permission_mode_selected`.
_Avoid_: Install config

**Provider CLI**:
The command-line entry point and provider-specific session parser for one **Agent provider**.
_Avoid_: Agent file, provider script

**Public command**:
The user-facing command or alias that launches a **Provider CLI**.
_Avoid_: Internal file path

**Public command runner**:
A **Common support module** that executes the shared lifecycle of a **Public command** after provider-specific argument parsing.
_Avoid_: Provider main, CLI runner

**Common support module**:
A shared module used by multiple **Provider CLIs** for picker state, config, formatting, JSONL parsing, or command launching.
_Avoid_: Provider code

**Session renderer**:
A **Common support module** that formats session lists, workspace lists, and interactive picker output without owning provider-specific session discovery.
_Avoid_: Claude renderer

**Session preview**:
A temporary picker view for reading the selected session's user-message transcript before reopening it.
_Avoid_: Editor-like transcript browser

**Configurations page**:
A picker view for actions that change provider-specific configuration for the selected **Agent provider**.
_Avoid_: Settings screen, right-click menu

**Multi-select configuration list**:
A **Configurations page** subview where multiple configuration choices can be toggled before saving.
_Avoid_: Session list

**Provider-managed environment**:
Environment fields inside an **Agent provider** config that belong to the selected **Model provider**.
_Avoid_: All env fields

**Session transcript**:
Provider-loaded chronological user messages for one session.
_Avoid_: Session summary

**Source layout**:
The repository directory structure that separates **Provider CLIs** into provider folders and shared scripts into `common/`.
_Avoid_: Root CLI files

**Install layout**:
The copied file structure under the local install directory that mirrors the **Source layout**.
_Avoid_: Flattened install files

## Relationships

- A **Provider CLI** belongs to exactly one **Agent provider**.
- An **Agent provider** may expose one or more **Model providers**.
- **Model provider selection state** is authoritative for Agent providers that support `model_provider_selected`.
- **Permission mode selection state** is stored in each **Agent provider**'s native config, not under the **Install layout**.
- Codex **Model provider selection state** is authoritative before Codex's native `model_provider` field.
- Claude Code **Model provider selection state** is authoritative before copying the selected provider's environment into `env`.
- Claude Code **Model provider** switching updates only the **Provider-managed environment** and preserves unrelated global `env` fields.
- Claude Code **Model provider** model choices are discovered from the selected provider's `GET /v1/models` endpoint.
- Claude Code **Model provider** model discovery uses the selected provider's `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, not fallback `env` values.
- Claude Code Haiku, Opus, and Sonnet model settings use the same discovered model list without automatic name-based filtering.
- Claude Code **Model provider** switching backs up current **Provider-managed environment** fields into the previously selected provider before applying the new provider.
- Claude Code model setting changes require a valid **Model provider selection state**.
- Claude Code **Configurations page** exposes `Model provider`, `Opus model`, `Sonnet model`, and `Haiku model` actions in that order.
- OpenCode **Model providers** backed by `@ai-sdk/*` packages may refresh their configured model list from `options.baseURL`.
- A **Public command** points at exactly one **Provider CLI**.
- A **Provider CLI** may delegate **Public command** lifecycle behavior to a **Public command runner**.
- A **Common support module** may be used by multiple **Provider CLIs**.
- **Provider CLIs** keep provider-specific behavior separate from **Common support modules**.
- A **Session renderer** may be used by any **Provider CLI**.
- A **Session preview** belongs to the session picker and loads a **Session transcript** lazily.
- A **Configurations page** is reached from a workspace list and belongs to the current **Agent provider**.
- A **Multi-select configuration list** uses blue for selected choices and cyan only for the current unselected cursor row.
- **Provider CLIs** own **Session transcript** loading because session storage differs by **Agent provider**.
- A **Session renderer** owns **Session transcript** display; terminal scrollback owns long-preview scrolling.
- The **Install layout** mirrors the **Source layout** so relative imports stay the same after installation.
- Tests may remain at the repository root while importing provider modules from the **Source layout**.

## Example dialogue

> **Dev:** "If we move `claude-sessions.js` under `claude/`, should the `cc` alias change?"
> **Domain expert:** "No. `cc` is a **Public command**. The file move only changes the internal **Provider CLI** path."

> **Dev:** "When Codex switches from OpenAI to another configured backend, is that a new **Agent provider**?"
> **Domain expert:** "No. Codex remains the **Agent provider**; the selected backend is a **Model provider**."

> **Dev:** "Should the Claude **Provider CLI** own JSON output and fallback prompt flow?"
> **Domain expert:** "No. Those are shared **Public command** lifecycle behaviours and belong in the **Public command runner**."

> **Dev:** "Can Codex reuse the Claude picker renderer?"
> **Domain expert:** "It can reuse the same **Session renderer**, but that renderer must live under `common/`, not inside the Claude **Provider CLI**."

> **Dev:** "Should installed files be flattened into one directory?"
> **Domain expert:** "No. The **Install layout** mirrors the **Source layout** so `common/`, `claude/`, `codex/`, and `opencode/` exist in both places."

> **Dev:** "Does pressing Space load every session transcript upfront?"
> **Domain expert:** "No. Space opens a **Session preview** and lazily loads the selected session's **Session transcript**."

> **Dev:** "In the workspace list, does Enter open configuration actions?"
> **Domain expert:** "No. Enter opens the selected workspace's sessions; the right arrow opens the **Configurations page**."

> **Dev:** "Should Codex model backend switching stay as a separate command?"
> **Domain expert:** "No. It belongs in the Codex **Configurations page** as **Model provider** selection."

> **Dev:** "If Codex has no `model_provider_selected` and no native `model_provider`, should we infer the provider without `base_url`?"
> **Domain expert:** "No. Create an `unknown-YYYYMMDD-HHmmss` **Model provider** with `name` and the current `auth_json`, then switch."

> **Dev:** "When switching Codex **Model providers**, can we replace `auth.json` immediately?"
> **Domain expert:** "No. First back up the current `auth.json` into the previously selected provider's `auth_json`; only then write the target provider's auth."

> **Dev:** "Should permission mode still be saved under `~/.agent-session`?"
> **Domain expert:** "No. It is **Permission mode selection state** and belongs in each **Agent provider**'s native config as `permission_mode_selected`."

> **Dev:** "Is `model_provider_selected` only a Codex concept?"
> **Domain expert:** "No. It is **Model provider selection state** for any **Agent provider** that supports the field; Codex and Claude Code both use it, while OpenCode currently does not."

> **Dev:** "When switching Claude Code **Model providers**, should every `env` field be replaced?"
> **Domain expert:** "No. Only the **Provider-managed environment** is copied from the selected **Model provider**; unrelated global `env` fields stay unchanged."

> **Dev:** "Should Claude Code model choices be typed manually?"
> **Domain expert:** "No. Fetch model choices from the selected **Model provider** using `GET /v1/models`."

> **Dev:** "If the selected Claude Code **Model provider** is missing base URL or token, should discovery use `env` as fallback?"
> **Domain expert:** "No. Model discovery belongs to the selected **Model provider** and must use that provider's own `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`."

> **Dev:** "Should Claude Code Haiku, Opus, and Sonnet model pickers filter the discovered list by model name?"
> **Domain expert:** "No. They share the same discovered model list because third-party **Model provider** names may use aliases that do not contain Haiku, Opus, or Sonnet."

> **Dev:** "Should Claude Code copy current `env` provider fields back before switching **Model providers**?"
> **Domain expert:** "Yes. Back up the current **Provider-managed environment** into the previously selected **Model provider**, then copy the target provider into `env` and update **Model provider selection state**."

> **Dev:** "If Claude Code has no valid selected **Model provider**, should model setting changes guess one?"
> **Domain expert:** "No. First select a **Model provider**; model setting changes must update `env` and the selected provider together."

> **Dev:** "Should Claude Code call the three model actions `Default model` variants?"
> **Domain expert:** "No. Use `Haiku model`, `Opus model`, and `Sonnet model` so the actions map directly to Claude Code environment fields."

> **Dev:** "Should Claude Code show the current default model beside each model action?"
> **Domain expert:** "Yes. The **Configurations page** should show the current Opus, Sonnet, and Haiku model values in columns beside their actions."

> **Dev:** "Should OpenCode preserve comments and trailing commas when updating provider models?"
> **Domain expert:** "No. It may read JSONC-style config but writes standard formatted JSON."

> **Dev:** "In a **Multi-select configuration list**, should the current cursor color override a selected choice?"
> **Domain expert:** "No. Selected choices stay blue; cyan is only the cursor color for unselected choices."

> **Dev:** "How does OpenCode discover models for an `@ai-sdk/*` provider?"
> **Domain expert:** "It calls `GET {options.baseURL}/models` with `Authorization: Bearer {options.apiKey}`, then writes selected IDs to `provider.<name>.models`."

> **Dev:** "How does OpenCode choose its default models?"
> **Domain expert:** "The OpenCode **Configurations page** selects from configured `provider.<name>.models` values and writes top-level `model` or `small_model` as `provider/model`."

> **Dev:** "Should the **Session preview** show assistant replies too?"
> **Domain expert:** "No. A **Session transcript** is a user-message view; assistant replies are intentionally excluded."

## Flagged ambiguities

- "agent file" is resolved as **Provider CLI** when it refers to the Claude, Codex, or OpenCode executable module.
- "provider" is resolved as **Model provider** when it refers to a selectable backend inside an **Agent provider**.
- "current Codex provider" is resolved through `model_provider_selected`, then native `model_provider`; never by inferring the provider without `base_url`.
- "current Claude Code provider" is resolved through `model_provider_selected`; the selected provider's fields are copied into `env`.
- "Claude unknown provider" is not introduced for missing **Model provider selection state**; Claude Code can directly select a configured provider and set `model_provider_selected`.
- "CLI runner" is resolved as **Public command runner** when it refers to shared command lifecycle behavior.
- "right key" is resolved as the keyboard right-arrow navigation from session list to workspace list, or from workspace list to **Configurations page**.
- "codexuse" is resolved as the legacy standalone Codex **Model provider** switcher; the resolved flow is the Codex **Configurations page**.
- "OpenCode provider models" is resolved as the OpenCode **Configurations page** action that edits `~/.config/opencode/opencode.json` `provider.<name>.models`.
- "OpenCode default model" is resolved as the top-level `model` or `small_model` fields in `~/.config/opencode/opencode.json`, not provider model discovery.
- "Claude renderer" is resolved as **Session renderer** once the formatting logic is shared by Codex and OpenCode.
- "root files" is resolved as the legacy layout where Provider CLIs lived at the repository root; the resolved **Source layout** no longer keeps root Provider CLI files.
- "preview messages" is resolved as **Session preview** backed by a lazily-loaded **Session transcript**, not the already-loaded session summary.
- "complete conversation messages" is resolved as complete user messages inside the **Session transcript**, not assistant replies.
