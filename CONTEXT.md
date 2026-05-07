# Agent Session

Agent Session is a small CLI toolkit for listing, filtering, and reopening local sessions created by different coding agents.

## Language

**Agent provider**:
A supported coding-agent product whose local session history can be browsed by this project.
_Avoid_: Agent, backend

**Provider CLI**:
The command-line entry point and provider-specific session parser for one **Agent provider**.
_Avoid_: Agent file, provider script

**Public command**:
The user-facing command or alias that launches a **Provider CLI**.
_Avoid_: Internal file path

**Common support module**:
A shared module used by multiple **Provider CLIs** for picker state, config, formatting, JSONL parsing, or command launching.
_Avoid_: Provider code

**Session renderer**:
A **Common support module** that formats session lists, workspace lists, and interactive picker output without owning provider-specific session discovery.
_Avoid_: Claude renderer

**Session preview**:
A temporary picker view for reading the selected session's user-message transcript before reopening it.
_Avoid_: Editor-like transcript browser

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
- A **Public command** points at exactly one **Provider CLI**.
- A **Common support module** may be used by multiple **Provider CLIs**.
- **Provider CLIs** keep provider-specific behavior separate from **Common support modules**.
- A **Session renderer** may be used by any **Provider CLI**.
- A **Session preview** belongs to the session picker and loads a **Session transcript** lazily.
- **Provider CLIs** own **Session transcript** loading because session storage differs by **Agent provider**.
- A **Session renderer** owns **Session transcript** display; terminal scrollback owns long-preview scrolling.
- The **Install layout** mirrors the **Source layout** so relative imports stay the same after installation.
- Tests may remain at the repository root while importing provider modules from the **Source layout**.

## Example dialogue

> **Dev:** "If we move `claude-sessions.js` under `claude/`, should the `cc` alias change?"
> **Domain expert:** "No. `cc` is a **Public command**. The file move only changes the internal **Provider CLI** path."

> **Dev:** "Can Codex reuse the Claude picker renderer?"
> **Domain expert:** "It can reuse the same **Session renderer**, but that renderer must live under `common/`, not inside the Claude **Provider CLI**."

> **Dev:** "Should installed files be flattened into one directory?"
> **Domain expert:** "No. The **Install layout** mirrors the **Source layout** so `common/`, `claude/`, `codex/`, and `opencode/` exist in both places."

> **Dev:** "Does pressing Space load every session transcript upfront?"
> **Domain expert:** "No. Space opens a **Session preview** and lazily loads the selected session's **Session transcript**."

> **Dev:** "Should the **Session preview** show assistant replies too?"
> **Domain expert:** "No. A **Session transcript** is a user-message view; assistant replies are intentionally excluded."

## Flagged ambiguities

- "agent file" is resolved as **Provider CLI** when it refers to the Claude, Codex, or OpenCode executable module.
- "Claude renderer" is resolved as **Session renderer** once the formatting logic is shared by Codex and OpenCode.
- "root files" is resolved as the legacy layout where Provider CLIs lived at the repository root; the resolved **Source layout** no longer keeps root Provider CLI files.
- "preview messages" is resolved as **Session preview** backed by a lazily-loaded **Session transcript**, not the already-loaded session summary.
- "complete conversation messages" is resolved as complete user messages inside the **Session transcript**, not assistant replies.
