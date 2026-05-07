const {
  clampSelectedIndex,
  normalizePermissionMode,
  workspaceItems,
} = require("./session-utils");

const ANSI = {
  reset: "\x1b[0m",
  previewMeta: "\x1b[36m",
};

function colorize(value, color, enabled) {
  return enabled ? `${color}${value}${ANSI.reset}` : value;
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

function formatDateTime(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${formatDate(date)} ${hours}:${minutes}:${seconds}`;
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
  if (diffMs < 7 * dayMs) {
    return `${Math.floor(diffMs / dayMs)}天前`;
  }
  return formatDate(date);
}

function formatPreviewMessageTime(timestamp, now = new Date()) {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs < 7 * dayMs) {
    return formatSessionTime(timestamp, now);
  }
  return formatDateTime(date);
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

function formatSessions(sessions, options = {}) {
  const providerName = options.providerName || "Claude Code";
  if (sessions.length === 0) {
    return `当前目录没有找到 ${providerName} session。`;
  }

  const rows = sessions.map((session, index) => ({
    number: String(index + 1),
    messages: String(session.messageCount),
    updated: session.updatedAt || "-",
    started: session.startedAt || "-",
    firstPrompt: truncate(displayFirstUserMessage(session), 40) || "-",
    lastPrompt: truncate(displayLastUserMessage(session), 40) || "-",
  }));
  const widths = {
    number: Math.max("#".length, ...rows.map((row) => row.number.length)),
    messages: Math.max("MESSAGES".length, ...rows.map((row) => row.messages.length)),
    updated: Math.max("UPDATED".length, ...rows.map((row) => row.updated.length)),
    started: Math.max("STARTED".length, ...rows.map((row) => row.started.length)),
    firstPrompt: Math.max("FIRST USER MESSAGE".length, ...rows.map((row) => displayWidth(row.firstPrompt))),
  };

  const lines = [
    `${pad("#", widths.number)}  ${pad("MESSAGES", widths.messages)}  ${pad("UPDATED", widths.updated)}  ${pad("STARTED", widths.started)}  ${padDisplay("FIRST USER MESSAGE", widths.firstPrompt)}  LAST USER MESSAGE`,
    `${"-".repeat(widths.number)}  ${"-".repeat(widths.messages)}  ${"-".repeat(widths.updated)}  ${"-".repeat(widths.started)}  ${"-".repeat(widths.firstPrompt)}  ${"-".repeat(17)}`,
  ];

  for (const row of rows) {
    lines.push(
      `${pad(row.number, widths.number)}  ${pad(row.messages, widths.messages)}  ${pad(row.updated, widths.updated)}  ${pad(row.started, widths.started)}  ${padDisplay(row.firstPrompt, widths.firstPrompt)}  ${row.lastPrompt}`,
    );
  }

  return lines.join("\n");
}

function formatPicker(sessions, now = new Date()) {
  const lines = ["0. new"];

  sessions.forEach((session, index) => {
    const number = index + 1;
    const updated = formatSessionTime(session.updatedAt, now);
    const prompt = truncate(displayUserMessages(session), 96) || "-";
    lines.push(`${number}. ${updated}  ${session.messageCount} messages  ${prompt}`);
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

function wrapToWidth(value, width) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return ["-"];
  }
  if (width <= 1) {
    return [truncateToWidth(text, width)];
  }

  const lines = [];
  let line = "";
  let lineWidth = 0;

  for (const char of text) {
    const nextWidth = charWidth(char);
    if (line && lineWidth + nextWidth > width) {
      lines.push(line);
      line = "";
      lineWidth = 0;
    }
    line += char;
    lineWidth += nextWidth;
  }

  if (line) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : ["-"];
}

function wrapRawLineToWidth(value, width, firstWidth = width) {
  const text = String(value || "");
  if (!text) {
    return [""];
  }
  if (displayWidth(text) <= firstWidth) {
    return [text];
  }
  if (firstWidth <= 1 || width <= 1) {
    return [truncateToWidth(text, firstWidth)];
  }

  const lines = [];
  let line = "";
  let lineWidth = 0;
  let currentWidth = firstWidth;

  for (const char of text) {
    const nextWidth = charWidth(char);
    if (line && lineWidth + nextWidth > currentWidth) {
      lines.push(line);
      line = "";
      lineWidth = 0;
      currentWidth = width;
    }
    line += char;
    lineWidth += nextWidth;
  }

  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

function wrapTranscriptText(value, width, firstWidth = width) {
  const text = String(value || "").trim();
  if (!text) {
    return ["-"];
  }

  return text
    .split(/\r?\n/)
    .flatMap((line, index) => wrapRawLineToWidth(line, width, index === 0 ? firstWidth : width));
}

function pickerItems(sessions, query) {
  return [
    { type: "new", label: "new" },
    ...filterSessions(sessions, query).map((session) => ({ type: "session", session })),
  ];
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

function permissionModeLabel(permissionMode, permissionModes) {
  return normalizePermissionMode(permissionMode, permissionModes);
}

function pickerStatusLine(permissionMode, filteredCount, query, permissionModes) {
  const permission = padDisplay(`Permission: ${permissionModeLabel(permissionMode, permissionModes)}`, 24);
  const matches = padDisplay(`Matches: ${filteredCount}`, 18);
  return `${permission}${matches}Search: ${query}`;
}

function pickerTitleLine(title, item) {
  if (!item || item.type !== "session") {
    return title;
  }
  return `${title}  ${item.session.id}`;
}

function renderSessionPreview(options) {
  const session = options.previewSession;
  const title = options.title || "Claude Code sessions";
  const permissionMode = normalizePermissionMode(options.permissionMode || options.launchMode, options.permissionModes);
  const cwd = options.cwd || process.cwd();
  const columns = options.columns || process.stdout.columns || 100;
  const now = options.now || new Date();
  const useColor = options.color === true;
  const header = [
    fitLine(`${title}  ${session.id}`, columns),
    fitLine(`Workspace: ${cwd}`, columns),
    fitLine(pickerStatusLine(permissionMode, options.filteredCount || 0, options.query || "", options.permissionModes), columns),
    "",
  ];
  const body = [
    fitLine(`Messages: ${session.messageCount || 0}  Started: ${session.startedAt || "-"}  Updated: ${session.updatedAt || "-"}`, columns),
  ];

  const details = [];
  if (session.version) {
    details.push(`Version: ${session.version}`);
  }
  if (session.gitBranch) {
    details.push(`Branch: ${session.gitBranch}`);
  }
  if (details.length > 0) {
    body.push(fitLine(details.join("  "), columns));
  }

  function appendWrapped(label, value) {
    body.push("");
    body.push(fitLine(label, columns));
    for (const line of wrapToWidth(value || "-", columns)) {
      body.push(fitLine(line, columns));
    }
  }

  if (options.previewError) {
    appendWrapped("Failed to load transcript:", options.previewError);
  } else if (options.previewTranscript && Array.isArray(options.previewTranscript.messages)) {
    const transcript = options.previewTranscript;
    const totalMessages = transcript.totalMessages ?? transcript.messages.length;
    body.push("");
    body.push(fitLine(`Transcript: ${totalMessages} user messages`, columns));
    for (const [index, message] of transcript.messages.entries()) {
      if (transcript.truncated && index === transcript.headCount) {
        body.push("");
        body.push(fitLine(`... skipped ${transcript.skippedCount} user messages ...`, columns));
      }
      body.push("");
      const ordinal = message.ordinal || index + 1;
      body.push(
        fitLine(
          colorize(`#${ordinal} ${formatPreviewMessageTime(message.timestamp, now)}`, ANSI.previewMeta, useColor),
          columns,
        ),
      );
      for (const line of wrapTranscriptText(message.text || "-", columns)) {
        body.push(fitLine(line, columns));
      }
    }
    if (transcript.messages.length === 0) {
      body.push("No user messages found.");
    }
  } else {
    appendWrapped("First user message:", displayFirstUserMessage(session) || "-");
    appendWrapped("Last user message:", displayLastUserMessage(session) || "-");
  }

  return [...header, ...body].join("\n");
}

function renderInteractivePicker(options) {
  const sessions = options.sessions || [];
  const query = options.query || "";
  const permissionMode = normalizePermissionMode(options.permissionMode || options.launchMode, options.permissionModes);
  const cwd = options.cwd || process.cwd();
  const now = options.now || new Date();
  const rows = options.rows || process.stdout.rows || 24;
  const columns = options.columns || process.stdout.columns || 100;
  const title = options.title || "Claude Code sessions";
  const items = pickerItems(sessions, query);
  const selectedIndex = clampSelectedIndex(options.selectedIndex || 0, items.length);
  const selectedItem = items[selectedIndex];
  const filteredCount = Math.max(0, items.length - 1);
  if (options.previewSession) {
    return renderSessionPreview({ ...options, filteredCount });
  }
  const maxItemRows = Math.max(1, rows - 7);
  const start = Math.max(0, Math.min(selectedIndex - maxItemRows + 1, items.length - maxItemRows));
  const visibleItems = items.slice(start, start + maxItemRows);
  const numberWidth = Math.max(2, displayWidth(`${Math.max(0, items.length - 1)}.`));
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
  const fixedSessionWidth = 2 + numberWidth + 2 + timeWidth + 2 + messagesWidth + 2;
  const promptWidths = splitPromptWidths(Math.max(0, columns - fixedSessionWidth));
  const lines = [
    fitLine(pickerTitleLine(title, selectedItem), columns),
    fitLine(`Workspace: ${cwd}`, columns),
    fitLine(pickerStatusLine(permissionMode, filteredCount, query, options.permissionModes), columns),
    "",
  ];

  visibleItems.forEach((item, visibleOffset) => {
    const itemIndex = start + visibleOffset;
    const prefix = itemIndex === selectedIndex ? "> " : "  ";

    if (item.type === "new") {
      lines.push(fitLine(`${prefix}${padDisplay("0.", numberWidth, "right")} new`, columns));
      return;
    }

    const number = itemIndex;
    const session = item.session;
    const updated = formatSessionTime(session.updatedAt, now);
    const messages = `${session.messageCount} msg`;
    const firstPrompt = truncateToWidth(displayFirstUserMessage(session) || "-", promptWidths.firstWidth);
    const lastPrompt = truncateToWidth(displayLastUserMessage(session) || "-", promptWidths.lastWidth);
    const promptPart =
      promptWidths.lastWidth > 0
        ? `${padDisplay(firstPrompt, promptWidths.firstWidth)}  ${lastPrompt}`
        : firstPrompt;
    const line = `${prefix}${padDisplay(`${number}.`, numberWidth, "right")} ${padDisplay(
      updated,
      timeWidth,
    )}  ${padDisplay(messages, messagesWidth, "right")}  ${promptPart}`;
    lines.push(fitLine(line, columns));
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
  const title = options.title || "Claude Code workspaces";
  const items = workspaceItems(workspaces, query);
  const selectedIndex = clampSelectedIndex(options.selectedIndex || 0, items.length);
  const filteredCount = items.length;
  const maxItemRows = Math.max(1, rows - 5);
  const start = Math.max(0, Math.min(selectedIndex - maxItemRows + 1, items.length - maxItemRows));
  const visibleItems = items.slice(start, start + maxItemRows);
  const numberWidth = Math.max(2, displayWidth(`${Math.max(0, items.length - 1)}.`));
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
    fitLine(title, columns),
    fitLine(`Search: ${query}`, columns),
    fitLine(`Matches: ${filteredCount}`, columns),
    "",
  ];

  visibleItems.forEach((item, visibleOffset) => {
    const itemIndex = start + visibleOffset;
    const prefix = itemIndex === selectedIndex ? "> " : "  ";
    const number = itemIndex;
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

module.exports = {
  displayWidth,
  filterSessions,
  formatPicker,
  formatSessionTime,
  formatSessions,
  renderInteractivePicker,
  renderWorkspacePicker,
  truncateToWidth,
};
