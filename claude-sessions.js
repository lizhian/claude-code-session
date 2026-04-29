#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".claude-code-session", "config.json");
const VALID_LAUNCH_MODES = new Set(["normal", "trust"]);

function encodeProjectPath(cwd) {
  return path.resolve(cwd).replace(/[^A-Za-z0-9._-]/g, "-");
}

function normalizeLaunchMode(launchMode) {
  return VALID_LAUNCH_MODES.has(launchMode) ? launchMode : "normal";
}

function readConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config && typeof config === "object" && !Array.isArray(config) ? config : {};
  } catch {
    return {};
  }
}

function writeConfig(config, configPath = DEFAULT_CONFIG_PATH) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function loadLaunchMode(configPath = DEFAULT_CONFIG_PATH) {
  return normalizeLaunchMode(readConfig(configPath).launchMode);
}

function saveLaunchMode(launchMode, configPath = DEFAULT_CONFIG_PATH) {
  const config = readConfig(configPath);
  config.launchMode = normalizeLaunchMode(launchMode);
  writeConfig(config, configPath);
}

function textFromContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function promptTextFromRecord(record) {
  if (record.type === "last-prompt" && typeof record.lastPrompt === "string") {
    return record.lastPrompt;
  }

  if (record.type !== "user" || record.isMeta || !record.message || record.message.role !== "user") {
    return "";
  }

  const content = record.message.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function readJsonLines(file) {
  const raw = fs.readFileSync(file, "utf8");
  const records = [];
  let parseErrorCount = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      records.push(JSON.parse(line));
    } catch {
      parseErrorCount += 1;
    }
  }

  return { records, parseErrorCount };
}

function summarizeSession(file, projectDir) {
  const { records, parseErrorCount } = readJsonLines(file);
  const timestamps = records
    .map((record) => record.timestamp)
    .filter((timestamp) => typeof timestamp === "string" && timestamp.length > 0);
  const firstRecord = records[0] || {};
  const lastRecord = records[records.length - 1] || {};
  const userMessages = records.map(promptTextFromRecord).filter(Boolean);
  const idFromFile = path.basename(file, ".jsonl");

  return {
    id: firstRecord.sessionId || lastRecord.sessionId || idFromFile,
    file,
    projectDir,
    cwd: firstRecord.cwd || lastRecord.cwd || "",
    gitBranch: firstRecord.gitBranch || lastRecord.gitBranch || "",
    version: firstRecord.version || lastRecord.version || "",
    messageCount: records.length,
    parseErrorCount,
    startedAt: timestamps[0] || "",
    updatedAt: timestamps[timestamps.length - 1] || "",
    firstUserMessage: userMessages[0] || "",
    lastUserMessage: userMessages[userMessages.length - 1] || "",
  };
}

function listSessions(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const claudeHome = path.resolve(options.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
  const projectDir = path.join(claudeHome, "projects", encodeProjectPath(cwd));

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  return fs
    .readdirSync(projectDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => summarizeSession(path.join(projectDir, name), projectDir))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function listProjectSessions(projectDir) {
  if (!fs.existsSync(projectDir)) {
    return [];
  }

  return fs
    .readdirSync(projectDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => summarizeSession(path.join(projectDir, name), projectDir))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function summarizeWorkspace(projectDir) {
  const sessions = listProjectSessions(projectDir);
  if (sessions.length === 0) {
    return null;
  }

  const newestSession = sessions[0];
  const firstSession = sessions[sessions.length - 1];
  const cwd = newestSession.cwd || sessions.find((session) => session.cwd)?.cwd || projectDir;

  return {
    cwd,
    projectDir,
    sessionCount: sessions.length,
    messageCount: sessions.reduce((total, session) => total + session.messageCount, 0),
    startedAt: firstSession.startedAt || "",
    updatedAt: newestSession.updatedAt || "",
    firstUserMessage: firstSession.firstUserMessage || "",
    lastUserMessage: newestSession.lastUserMessage || newestSession.firstUserMessage || "",
  };
}

function listWorkspaces(options = {}) {
  const claudeHome = path.resolve(options.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
  const projectsDir = path.join(claudeHome, "projects");

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  return fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeWorkspace(path.join(projectsDir, entry.name)))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function charWidth(char) {
  const code = char.codePointAt(0);

  if (code === undefined) {
    return 0;
  }
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) {
    return 0;
  }
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  ) {
    return 0;
  }
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function displayWidth(value) {
  let width = 0;
  for (const char of stripAnsi(value)) {
    width += charWidth(char);
  }
  return width;
}

function truncateToWidth(value, maxWidth) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (displayWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 3) {
    return ".".repeat(Math.max(0, maxWidth));
  }

  let output = "";
  let width = 0;
  const suffix = "...";
  const allowedWidth = maxWidth - displayWidth(suffix);

  for (const char of text) {
    const nextWidth = charWidth(char);
    if (width + nextWidth > allowedWidth) {
      break;
    }
    output += char;
    width += nextWidth;
  }

  return `${output}${suffix}`;
}

function padDisplay(value, width, align = "left") {
  const text = String(value || "");
  const padding = " ".repeat(Math.max(0, width - displayWidth(text)));
  return align === "right" ? `${padding}${text}` : `${text}${padding}`;
}

function pad(value, width) {
  const text = String(value || "");
  return text + " ".repeat(Math.max(0, width - text.length));
}

function shortSessionId(id) {
  return String(id || "").split("-")[0].slice(0, 8);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSessionTime(timestamp, now = new Date()) {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) {
    return "刚刚";
  }
  if (diffMs < hourMs) {
    return `${Math.floor(diffMs / minuteMs)}分钟前`;
  }
  if (diffMs < dayMs) {
    return `${Math.floor(diffMs / hourMs)}小时前`;
  }
  if (diffMs <= 3 * dayMs) {
    return `${Math.floor(diffMs / dayMs)}天前`;
  }
  return formatDate(date);
}

function sessionSearchText(session) {
  return [
    session.id,
    shortSessionId(session.id),
    session.cwd,
    session.gitBranch,
    session.version,
    session.updatedAt,
    session.startedAt,
    session.firstUserMessage,
    session.lastUserMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function displayUserMessage(session) {
  return session.lastUserMessage || session.firstUserMessage || "";
}

function displayFirstUserMessage(session) {
  return session.firstUserMessage || session.lastUserMessage || "";
}

function displayLastUserMessage(session) {
  return session.lastUserMessage || session.firstUserMessage || "";
}

function displayUserMessages(session) {
  const first = displayFirstUserMessage(session) || "-";
  const last = displayLastUserMessage(session) || "-";
  return `${first}  |  ${last}`;
}

function filterSessions(sessions, query) {
  const terms = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return sessions;
  }

  return sessions.filter((session) => {
    const searchText = sessionSearchText(session);
    return terms.every((term) => searchText.includes(term));
  });
}

function workspaceSearchText(workspace) {
  return [
    workspace.cwd,
    workspace.projectDir,
    workspace.updatedAt,
    workspace.startedAt,
    workspace.firstUserMessage,
    workspace.lastUserMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterWorkspaces(workspaces, query) {
  const terms = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return workspaces;
  }

  return workspaces.filter((workspace) => {
    const searchText = workspaceSearchText(workspace);
    return terms.every((term) => searchText.includes(term));
  });
}

function formatSessions(sessions) {
  if (sessions.length === 0) {
    return "当前目录没有找到 Claude Code session。";
  }

  const rows = sessions.map((session) => ({
    id: session.id,
    messages: String(session.messageCount),
    updated: session.updatedAt || "-",
    started: session.startedAt || "-",
    firstPrompt: truncate(displayFirstUserMessage(session), 40) || "-",
    lastPrompt: truncate(displayLastUserMessage(session), 40) || "-",
  }));
  const widths = {
    id: Math.max("SESSION ID".length, ...rows.map((row) => row.id.length)),
    messages: Math.max("MESSAGES".length, ...rows.map((row) => row.messages.length)),
    updated: Math.max("UPDATED".length, ...rows.map((row) => row.updated.length)),
    started: Math.max("STARTED".length, ...rows.map((row) => row.started.length)),
    firstPrompt: Math.max("FIRST USER MESSAGE".length, ...rows.map((row) => displayWidth(row.firstPrompt))),
  };

  const lines = [
    `${pad("SESSION ID", widths.id)}  ${pad("MESSAGES", widths.messages)}  ${pad("UPDATED", widths.updated)}  ${pad("STARTED", widths.started)}  ${padDisplay("FIRST USER MESSAGE", widths.firstPrompt)}  LAST USER MESSAGE`,
    `${"-".repeat(widths.id)}  ${"-".repeat(widths.messages)}  ${"-".repeat(widths.updated)}  ${"-".repeat(widths.started)}  ${"-".repeat(widths.firstPrompt)}  ${"-".repeat(17)}`,
  ];

  for (const row of rows) {
    lines.push(
      `${pad(row.id, widths.id)}  ${pad(row.messages, widths.messages)}  ${pad(row.updated, widths.updated)}  ${pad(row.started, widths.started)}  ${padDisplay(row.firstPrompt, widths.firstPrompt)}  ${row.lastPrompt}`,
    );
  }

  return lines.join("\n");
}

function formatPicker(sessions, now = new Date()) {
  const lines = ["1. New session"];

  sessions.forEach((session, index) => {
    const number = index + 2;
    const updated = formatSessionTime(session.updatedAt, now);
    const prompt = truncate(displayUserMessages(session), 96) || "-";
    lines.push(`${number}. ${shortSessionId(session.id)}  ${updated}  ${session.messageCount} messages  ${prompt}`);
  });

  return lines.join("\n");
}

function fitLine(value, width) {
  const text = String(value || "");
  if (displayWidth(text) <= width) {
    return text;
  }
  return truncateToWidth(text, width);
}

function pickerItems(sessions, query) {
  return [
    { type: "new", label: "New session" },
    ...filterSessions(sessions, query).map((session) => ({ type: "session", session })),
  ];
}

function workspaceItems(workspaces, query) {
  return filterWorkspaces(workspaces, query).map((workspace) => ({ type: "workspace", workspace }));
}

function clampSelectedIndex(selectedIndex, itemCount) {
  if (itemCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, selectedIndex), itemCount - 1);
}

function splitPromptWidths(availableWidth) {
  if (availableWidth < 5) {
    return { firstWidth: Math.max(0, availableWidth), lastWidth: 0 };
  }

  const separatorWidth = 2;
  const promptsWidth = availableWidth - separatorWidth;
  const firstWidth = Math.max(1, Math.floor(promptsWidth / 2));
  const lastWidth = Math.max(1, promptsWidth - firstWidth);
  return { firstWidth, lastWidth };
}

function launchModeLabel(launchMode) {
  return launchMode === "trust" ? "信任模式" : "普通模式";
}

function toggleLaunchMode(launchMode) {
  return launchMode === "trust" ? "normal" : "trust";
}

function renderInteractivePicker(options) {
  const sessions = options.sessions || [];
  const query = options.query || "";
  const launchMode = options.launchMode || "normal";
  const cwd = options.cwd || process.cwd();
  const now = options.now || new Date();
  const rows = options.rows || process.stdout.rows || 24;
  const columns = options.columns || process.stdout.columns || 100;
  const items = pickerItems(sessions, query);
  const selectedIndex = clampSelectedIndex(options.selectedIndex || 0, items.length);
  const filteredCount = Math.max(0, items.length - 1);
  const maxItemRows = Math.max(1, rows - 7);
  const start = Math.max(0, Math.min(selectedIndex - maxItemRows + 1, items.length - maxItemRows));
  const visibleItems = items.slice(start, start + maxItemRows);
  const numberWidth = Math.max(2, displayWidth(`${items.length}.`));
  const timeWidth = Math.max(
    "UPDATED".length,
    ...visibleItems
      .filter((item) => item.type === "session")
      .map((item) => displayWidth(formatSessionTime(item.session.updatedAt, now))),
  );
  const messagesWidth = Math.max(
    "MESSAGES".length,
    ...visibleItems
      .filter((item) => item.type === "session")
      .map((item) => displayWidth(`${item.session.messageCount} msg`)),
  );
  const fixedSessionWidth =
    2 + numberWidth + 2 + 8 + 2 + timeWidth + 2 + messagesWidth + 2;
  const promptWidths = splitPromptWidths(Math.max(0, columns - fixedSessionWidth));
  const lines = [
    fitLine("Claude Code sessions", columns),
    fitLine(`Workspace: ${cwd}`, columns),
    fitLine(`Launch: ${launchModeLabel(launchMode)}    Tab switch    → workspaces`, columns),
    fitLine(`Search: ${query}`, columns),
    fitLine(`Matches: ${filteredCount}    ↑/↓ move  type search  Enter open  Esc cancel`, columns),
    "",
  ];

  visibleItems.forEach((item, visibleOffset) => {
    const itemIndex = start + visibleOffset;
    const prefix = itemIndex === selectedIndex ? "> " : "  ";

    if (item.type === "new") {
      lines.push(fitLine(`${prefix}${padDisplay("1.", numberWidth, "right")} New session`, columns));
      return;
    }

    const number = itemIndex + 1;
    const session = item.session;
    const updated = formatSessionTime(session.updatedAt, now);
    const messages = `${session.messageCount} msg`;
    const firstPrompt = truncateToWidth(displayFirstUserMessage(session) || "-", promptWidths.firstWidth);
    const lastPrompt = truncateToWidth(displayLastUserMessage(session) || "-", promptWidths.lastWidth);
    const promptPart =
      promptWidths.lastWidth > 0
        ? `${padDisplay(firstPrompt, promptWidths.firstWidth)}  ${lastPrompt}`
        : firstPrompt;
    const line = `${prefix}${padDisplay(`${number}.`, numberWidth, "right")} ${shortSessionId(
      session.id,
    )}  ${padDisplay(updated, timeWidth)}  ${padDisplay(messages, messagesWidth, "right")}  ${promptPart}`;
    lines.push(
      fitLine(line, columns),
    );
  });

  if (filteredCount === 0 && query.trim()) {
    lines.push("");
    lines.push("No matching sessions.");
  }

  return lines.join("\n");
}

function renderWorkspacePicker(options) {
  const workspaces = options.workspaces || [];
  const query = options.query || "";
  const now = options.now || new Date();
  const rows = options.rows || process.stdout.rows || 24;
  const columns = options.columns || process.stdout.columns || 100;
  const items = workspaceItems(workspaces, query);
  const selectedIndex = clampSelectedIndex(options.selectedIndex || 0, items.length);
  const filteredCount = items.length;
  const maxItemRows = Math.max(1, rows - 5);
  const start = Math.max(0, Math.min(selectedIndex - maxItemRows + 1, items.length - maxItemRows));
  const visibleItems = items.slice(start, start + maxItemRows);
  const numberWidth = Math.max(2, displayWidth(`${Math.max(1, items.length)}.`));
  const timeWidth = Math.max(
    "UPDATED".length,
    ...visibleItems.map((item) => displayWidth(formatSessionTime(item.workspace.updatedAt, now))),
  );
  const sessionsWidth = Math.max(
    "SESSIONS".length,
    ...visibleItems.map((item) => displayWidth(`${item.workspace.sessionCount} sessions`)),
  );
  const fixedWorkspaceWidth = 2 + numberWidth + 2 + timeWidth + 2 + sessionsWidth + 2;
  const pathWidth = Math.max(1, columns - fixedWorkspaceWidth);
  const lines = [
    fitLine("Claude Code workspaces", columns),
    fitLine(`Search: ${query}`, columns),
    fitLine(`Matches: ${filteredCount}    ↑/↓ move  type search  Enter choose  ← sessions  Esc cancel`, columns),
    "",
  ];

  visibleItems.forEach((item, visibleOffset) => {
    const itemIndex = start + visibleOffset;
    const prefix = itemIndex === selectedIndex ? "> " : "  ";
    const number = itemIndex + 1;
    const workspace = item.workspace;
    const updated = formatSessionTime(workspace.updatedAt, now);
    const sessions = `${workspace.sessionCount} sessions`;
    const workspacePath = truncateToWidth(workspace.cwd || workspace.projectDir || "-", pathWidth);
    const line = `${prefix}${padDisplay(`${number}.`, numberWidth, "right")} ${padDisplay(
      updated,
      timeWidth,
    )}  ${padDisplay(sessions, sessionsWidth, "right")}  ${workspacePath}`;
    lines.push(fitLine(line, columns));
  });

  if (filteredCount === 0 && query.trim()) {
    lines.push("");
    lines.push("No matching workspaces.");
  }

  return lines.join("\n");
}

function launchArgs(launchMode) {
  return launchMode === "trust" ? ["--dangerously-skip-permissions"] : [];
}

function buildClaudeCommand(sessions, choice, options = {}) {
  const normalized = String(choice || "").trim();
  const baseArgs = launchArgs(options.launchMode);

  if (normalized === "" || normalized === "1") {
    return { command: "claude", args: baseArgs };
  }

  const selectedNumber = Number.parseInt(normalized, 10);
  if (!Number.isInteger(selectedNumber) || String(selectedNumber) !== normalized) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  const session = sessions[selectedNumber - 2];
  if (!session) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  return { command: "claude", args: [...baseArgs, "--resume", session.id] };
}

function askQuestion(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    cwd: options.cwd || process.cwd(),
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code || 0;
  });
}

function selectedItemToCommand(item, options = {}) {
  const baseArgs = launchArgs(options.launchMode);
  if (!item || item.type === "new") {
    return { command: "claude", args: baseArgs, cwd: options.cwd };
  }
  return { command: "claude", args: [...baseArgs, "--resume", item.session.id], cwd: options.cwd };
}

function markProjectTrusted(cwd = process.cwd(), configPath = path.join(os.homedir(), ".claude.json")) {
  const resolvedCwd = path.resolve(cwd);
  let config = {};

  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    config = {};
  }
  if (!config.projects || typeof config.projects !== "object" || Array.isArray(config.projects)) {
    config.projects = {};
  }
  if (!config.projects[resolvedCwd] || typeof config.projects[resolvedCwd] !== "object") {
    config.projects[resolvedCwd] = {};
  }

  config.projects[resolvedCwd].hasTrustDialogAccepted = true;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function pickSessionInteractive(initialSessions, io = {}) {
  const input = io.input || process.stdin;
  const output = io.output || process.stdout;
  const claudeHome = path.resolve(io.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
  const configPath = io.configPath || DEFAULT_CONFIG_PATH;

  if (!input.isTTY || !output.isTTY) {
    return null;
  }

  let currentCwd = path.resolve(io.cwd || process.cwd());
  let sessions = initialSessions || listSessions({ cwd: currentCwd, claudeHome });
  let workspaces = null;
  let view = "sessions";
  let launchMode = normalizeLaunchMode(io.launchMode || loadLaunchMode(configPath));
  let sessionQuery = "";
  let workspaceQuery = "";
  let sessionSelectedIndex = 0;
  let workspaceSelectedIndex = 0;
  let previousQueryHadText = false;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  output.write("\x1b[?25l");

  return new Promise((resolve) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
      output.write("\x1b[2J\x1b[H");
    }

    function currentSessionItems() {
      return pickerItems(sessions, sessionQuery);
    }

    function currentWorkspaceItems() {
      if (!workspaces) {
        workspaces = listWorkspaces({ claudeHome });
      }
      return workspaceItems(workspaces, workspaceQuery);
    }

    function render() {
      output.write("\x1b[2J\x1b[H");

      if (view === "workspaces") {
        const itemCount = currentWorkspaceItems().length;
        workspaceSelectedIndex = clampSelectedIndex(workspaceSelectedIndex, itemCount);
        output.write(
          renderWorkspacePicker({
            workspaces: workspaces || [],
            query: workspaceQuery,
            selectedIndex: workspaceSelectedIndex,
            rows: output.rows || 24,
            columns: output.columns || 100,
          }),
        );
        return;
      }

      const itemCount = currentSessionItems().length;
      sessionSelectedIndex = clampSelectedIndex(sessionSelectedIndex, itemCount);
      output.write(
        renderInteractivePicker({
          sessions,
          query: sessionQuery,
          selectedIndex: sessionSelectedIndex,
          launchMode,
          cwd: currentCwd,
          rows: output.rows || 24,
          columns: output.columns || 100,
        }),
      );
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === "c") {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "escape") {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (view === "workspaces") {
          const items = currentWorkspaceItems();
          const item = items[clampSelectedIndex(workspaceSelectedIndex, items.length)];
          if (item && item.workspace) {
            currentCwd = path.resolve(item.workspace.cwd || item.workspace.projectDir || currentCwd);
            sessions = listSessions({ cwd: currentCwd, claudeHome });
            view = "sessions";
            sessionQuery = "";
            sessionSelectedIndex = 0;
            previousQueryHadText = false;
            render();
          }
          return;
        }

        const items = currentSessionItems();
        const item = items[clampSelectedIndex(sessionSelectedIndex, items.length)];
        cleanup();
        resolve({
          item: item || { type: "new", label: "New session" },
          launchMode,
          cwd: currentCwd,
        });
        return;
      }

      if (key.name === "tab") {
        launchMode = toggleLaunchMode(launchMode);
        saveLaunchMode(launchMode, configPath);
        render();
        return;
      }

      if (key.name === "right" && view === "sessions") {
        if (!workspaces) {
          workspaces = listWorkspaces({ claudeHome });
        }
        view = "workspaces";
        workspaceSelectedIndex = 0;
        previousQueryHadText = Boolean(workspaceQuery);
        render();
        return;
      }

      if (key.name === "left" && view === "workspaces") {
        view = "sessions";
        previousQueryHadText = Boolean(sessionQuery);
        render();
        return;
      }

      if (key.name === "up") {
        if (view === "workspaces") {
          workspaceSelectedIndex = Math.max(0, workspaceSelectedIndex - 1);
        } else {
          sessionSelectedIndex = Math.max(0, sessionSelectedIndex - 1);
        }
        render();
        return;
      }

      if (key.name === "down") {
        if (view === "workspaces") {
          workspaceSelectedIndex = Math.min(
            Math.max(0, currentWorkspaceItems().length - 1),
            workspaceSelectedIndex + 1,
          );
        } else {
          sessionSelectedIndex = Math.min(
            Math.max(0, currentSessionItems().length - 1),
            sessionSelectedIndex + 1,
          );
        }
        render();
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        if (view === "workspaces") {
          workspaceQuery = workspaceQuery.slice(0, -1);
        } else {
          sessionQuery = sessionQuery.slice(0, -1);
        }
        const query = view === "workspaces" ? workspaceQuery : sessionQuery;
        if (!query) {
          previousQueryHadText = false;
          if (view === "workspaces") {
            workspaceSelectedIndex = 0;
          } else {
            sessionSelectedIndex = 0;
          }
        }
        render();
        return;
      }

      if (str && str >= " " && !key.ctrl && !key.meta) {
        if (view === "workspaces") {
          workspaceQuery += str;
          if (!previousQueryHadText && filterWorkspaces(workspaces || [], workspaceQuery).length > 0) {
            workspaceSelectedIndex = 0;
          }
        } else {
          sessionQuery += str;
          if (!previousQueryHadText && filterSessions(sessions, sessionQuery).length > 0) {
            sessionSelectedIndex = 1;
          }
        }
        previousQueryHadText = true;
        render();
      }
    }

    input.on("keypress", onKeypress);
    render();
  });
}

async function pickAndRunClaude(sessions, options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const launchMode = normalizeLaunchMode(options.launchMode || loadLaunchMode(configPath));
  const picked = await pickSessionInteractive(sessions, options);
  if (picked) {
    if (options.trustCurrentFolder) {
      markProjectTrusted(picked.cwd);
    }
    const { command, args, cwd } = selectedItemToCommand(picked.item, {
      launchMode: picked.launchMode,
      cwd: picked.cwd,
    });
    runCommand(command, args, { cwd });
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.exitCode = 130;
    return;
  }

  console.log(formatPicker(sessions));
  console.log("");

  const answer = await askQuestion("选择 session 编号，直接回车创建 New session: ");
  if (options.trustCurrentFolder) {
    markProjectTrusted(options.cwd);
  }
  const { command, args } = buildClaudeCommand(sessions, answer, { ...options, launchMode });
  runCommand(command, args, { cwd: options.cwd });
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    claudeHome: process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"),
    json: false,
    pick: false,
    trustCurrentFolder: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--pick") {
      options.pick = true;
    } else if (arg === "--trust-current-folder") {
      options.trustCurrentFolder = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--cwd") {
      options.cwd = argv[++index];
    } else if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length);
    } else if (arg === "--claude-home") {
      options.claudeHome = argv[++index];
    } else if (arg.startsWith("--claude-home=")) {
      options.claudeHome = arg.slice("--claude-home=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.cwd) {
    throw new Error("--cwd requires a path");
  }
  if (!options.claudeHome) {
    throw new Error("--claude-home requires a path");
  }

  return options;
}

function usage() {
  return [
    "Usage: node claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]",
    "",
    "获取指定目录对应的 Claude Code sessions。默认读取当前目录和 ~/.claude。",
    "交互模式快捷键：Tab 切换普通/信任启动模式，→ 选择 Claude Code 工作区，← 返回 session 列表。",
    "启动模式会自动记住，配置保存在 ~/.claude-code-session/config.json。",
    "",
    "Options:",
    "  --json                 输出 JSON，方便 jq 或其他脚本处理",
    "  --pick                 交互选择 New session 或恢复某个 session",
    "  --trust-current-folder 标记当前目录为 Claude Code 已信任，避免重复信任确认",
    "  --cwd <path>           指定要查询的项目目录，默认是当前目录",
    "  --claude-home <path>   指定 Claude 配置目录，默认是 ~/.claude 或 CLAUDE_HOME",
    "  -h, --help             显示帮助",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  const cwd = path.resolve(options.cwd);
  const claudeHome = path.resolve(options.claudeHome);
  const projectDir = path.join(claudeHome, "projects", encodeProjectPath(cwd));
  const sessions = listSessions({ cwd, claudeHome });

  if (options.trustCurrentFolder) {
    markProjectTrusted(cwd);
  }

  if (options.pick) {
    await pickAndRunClaude(sessions, { cwd, claudeHome, trustCurrentFolder: options.trustCurrentFolder });
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          cwd,
          claudeHome,
          projectDir,
          count: sessions.length,
          sessions,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`CWD: ${cwd}`);
  console.log(`Claude project dir: ${projectDir}`);
  console.log(`Sessions: ${sessions.length}`);
  console.log("");
  console.log(formatSessions(sessions));
}

if (require.main === module) {
  try {
    main().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  buildClaudeCommand,
  displayWidth,
  encodeProjectPath,
  filterSessions,
  formatPicker,
  formatSessionTime,
  formatSessions,
  filterWorkspaces,
  loadLaunchMode,
  listSessions,
  listWorkspaces,
  markProjectTrusted,
  parseArgs,
  promptTextFromRecord,
  pickAndRunClaude,
  renderInteractivePicker,
  renderWorkspacePicker,
  saveLaunchMode,
  shortSessionId,
  summarizeSession,
  truncateToWidth,
};
