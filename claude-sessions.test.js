const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  DEFAULT_CONFIG_PATH,
  buildClaudeCommand,
  loadPermissionMode,
  displayWidth,
  encodeProjectPath,
  filterSessions,
  formatPicker,
  formatSessionTime,
  formatSessions,
  loadSessionTranscript,
  listWorkspaces,
  markProjectTrusted,
  pickAndRunClaude,
  renderInteractivePicker,
  renderWorkspacePicker,
  savePermissionMode,
  truncateToWidth,
  listSessions,
} = require("./claude/claude-sessions");
const { createSessionPicker } = require("./common/session-utils");
const { renderConfigurationPicker } = require("./common/session-renderer");
const { normalizeTranscriptMessages } = require("./common/session-transcript");

test("stores default config under the install directory", () => {
  assert.equal(DEFAULT_CONFIG_PATH, path.join(os.homedir(), ".agent-session", "claude-code.json"));
});

test("encodes absolute paths the way Claude Code stores project directories", () => {
  const root = path.parse(process.cwd()).root;
  const encodedRoot = root.replace(/[^A-Za-z0-9._-]/g, "-");

  assert.equal(encodeProjectPath(path.join(root, "tmp", "临时")), `${encodedRoot}tmp---`);
  assert.equal(
    encodeProjectPath(path.join(root, "workspace", "2026-04-29", "agent-session")),
    `${encodedRoot}workspace-2026-04-29-agent-session`,
  );
});

test("lists sessions for a cwd from Claude Code jsonl files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-sessions-"));
  const claudeHome = path.join(tempDir, ".claude");
  const cwd = path.join(tempDir, "demo project");
  const projectDir = path.join(claudeHome, "projects", encodeProjectPath(cwd));
  const sessionId = "11111111-2222-3333-4444-555555555555";

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-29T00:00:00.000Z",
        cwd,
        sessionId,
        version: "2.1.83",
        gitBranch: "main",
        message: { role: "user", content: "first prompt" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-29T00:00:05.000Z",
        cwd,
        sessionId,
        message: { role: "assistant", content: [{ type: "text", text: "reply" }] },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-29T00:00:10.000Z",
        cwd,
        sessionId,
        message: { role: "user", content: "last prompt" },
      }),
    ].join("\n"),
  );

  const sessions = listSessions({ cwd, claudeHome });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].messageCount, 3);
  assert.equal(sessions[0].firstUserMessage, "first prompt");
  assert.equal(sessions[0].lastUserMessage, "last prompt");
  assert.equal(sessions[0].startedAt, "2026-04-29T00:00:00.000Z");
  assert.equal(sessions[0].updatedAt, "2026-04-29T00:00:10.000Z");
  assert.equal(sessions[0].projectDir, projectDir);
});

test("loads full Claude transcript text from a session file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-transcript-"));
  const sessionFile = path.join(tempDir, "session.jsonl");
  fs.writeFileSync(
    sessionFile,
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-29T00:00:00.000Z",
        message: { role: "user", content: "first prompt" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-29T00:00:05.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "assistant reply" }] },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-29T00:00:10.000Z",
        message: { role: "user", content: "last prompt" },
      }),
    ].join("\n"),
  );

  assert.deepEqual(loadSessionTranscript({ file: sessionFile }).messages, [
    { role: "user", timestamp: "2026-04-29T00:00:00.000Z", text: "first prompt", ordinal: 1 },
    { role: "user", timestamp: "2026-04-29T00:00:10.000Z", text: "last prompt", ordinal: 2 },
  ]);
});

test("returns an empty list when the current directory has no sessions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-sessions-empty-"));
  const sessions = listSessions({
    cwd: path.join(tempDir, "missing"),
    claudeHome: path.join(tempDir, ".claude"),
  });

  assert.deepEqual(sessions, []);
});

test("formats a compact table for terminal output", () => {
  const output = formatSessions([
    {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 2,
      startedAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:05.000Z",
      firstUserMessage: "first prompt",
      lastUserMessage: "last prompt",
      file: "/tmp/session.jsonl",
    },
  ]);

  assert.match(output, /^#  MESSAGES/m);
  assert.match(output, /FIRST USER MESSAGE/);
  assert.match(output, /LAST USER MESSAGE/);
  assert.doesNotMatch(output, /11111111-2222-3333-4444-555555555555/);
  assert.match(output, /^1  2/m);
  assert.match(output, /first prompt/);
  assert.match(output, /last prompt/);
});

test("formats interactive picker with new session first", () => {
  const output = formatPicker([
    {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 2,
      updatedAt: "2026-04-29T00:00:05.000Z",
      firstUserMessage: "first prompt",
      lastUserMessage: "last prompt",
    },
  ], new Date("2026-04-29T03:00:05.000Z"));

  assert.match(output, /0\. new/);
  assert.match(output, /1\. 3小时前/);
  assert.doesNotMatch(output, /11111111/);
  assert.doesNotMatch(output, /11111111-2222-3333-4444-555555555555/);
  assert.match(output, /3小时前/);
  assert.match(output, /first prompt/);
  assert.match(output, /last prompt/);
});

test("builds claude command for new session and resume choices", () => {
  const sessions = [{ id: "11111111-2222-3333-4444-555555555555" }];

  assert.deepEqual(buildClaudeCommand(sessions, "0"), { command: "claude", args: [] });
  assert.deepEqual(buildClaudeCommand(sessions, ""), { command: "claude", args: [] });
  assert.deepEqual(buildClaudeCommand(sessions, "1"), {
    command: "claude",
    args: ["--resume", "11111111-2222-3333-4444-555555555555"],
  });
  assert.deepEqual(buildClaudeCommand(sessions, "0", { permissionMode: "auto" }), {
    command: "claude",
    args: ["--enable-auto-mode"],
  });
  assert.deepEqual(buildClaudeCommand(sessions, "1", { permissionMode: "auto" }), {
    command: "claude",
    args: ["--enable-auto-mode", "--resume", "11111111-2222-3333-4444-555555555555"],
  });
  assert.deepEqual(buildClaudeCommand(sessions, "0", { permissionMode: "full" }), {
    command: "claude",
    args: ["--dangerously-skip-permissions"],
  });
  assert.deepEqual(buildClaudeCommand(sessions, "1", { permissionMode: "full" }), {
    command: "claude",
    args: ["--dangerously-skip-permissions", "--resume", "11111111-2222-3333-4444-555555555555"],
  });
});

test("loads default permission mode when config is missing or invalid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-config-"));
  const configPath = path.join(tempDir, "config.json");

  assert.equal(loadPermissionMode(configPath), "default");

  fs.writeFileSync(configPath, "{not json");
  assert.equal(loadPermissionMode(configPath), "default");

  fs.writeFileSync(configPath, JSON.stringify({ permissionMode: "invalid" }));
  assert.equal(loadPermissionMode(configPath), "default");
});

test("loads legacy launch mode as permission mode", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-config-"));
  const configPath = path.join(tempDir, "config.json");

  fs.writeFileSync(configPath, JSON.stringify({ launchMode: "trust" }));
  assert.equal(loadPermissionMode(configPath), "full");

  fs.writeFileSync(configPath, JSON.stringify({ launchMode: "normal" }));
  assert.equal(loadPermissionMode(configPath), "default");
});

test("saves permission mode so the next picker run can use it as default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-config-"));
  const configPath = path.join(tempDir, "nested", "config.json");

  savePermissionMode("full", configPath);
  assert.equal(loadPermissionMode(configPath), "full");

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.extra = "keep me";
  config.launchMode = "trust";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  savePermissionMode("auto", configPath);
  const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(updatedConfig.permissionMode, "auto");
  assert.equal(updatedConfig.launchMode, undefined);
  assert.equal(updatedConfig.extra, "keep me");
});

test("interactive picker uses provider permission storage hooks", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const saved = [];
  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};
  output.on("data", () => {});

  const picker = createSessionPicker({
    configPath: path.join(os.tmpdir(), "agent-session-permission-hooks.json"),
    defaultHome: () => os.tmpdir(),
    homeOptionName: "claudeHome",
    listSessions: () => [],
    listWorkspaces: () => [],
    filterSessions,
    renderInteractivePicker,
    renderWorkspacePicker,
    workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
    loadPermissionMode: () => "full",
    savePermissionMode: (permissionMode) => saved.push(permissionMode),
  });

  const picked = picker([], {
    input,
    output,
    cwd: "/tmp/payment-api",
    claudeHome: os.tmpdir(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "tab" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  const result = await picked;

  assert.deepEqual(saved, ["default"]);
  assert.equal(result.permissionMode, "default");
});

test("rejects invalid picker choices", () => {
  assert.throws(
    () => buildClaudeCommand([{ id: "11111111-2222-3333-4444-555555555555" }], "2"),
    /Invalid choice/,
  );
});

test("formats relative times for the picker", () => {
  const now = new Date("2026-04-29T12:00:00.000Z");

  assert.equal(formatSessionTime("2026-04-29T11:59:00.000Z", now), "1分钟前");
  assert.equal(formatSessionTime("2026-04-29T09:00:00.000Z", now), "3小时前");
  assert.equal(formatSessionTime("2026-04-28T12:00:00.000Z", now), "1天前");
  assert.equal(formatSessionTime("2026-04-23T12:00:00.000Z", now), "6天前");
  assert.equal(formatSessionTime("2026-04-21T12:00:00.000Z", now), "2026-04-21");
});

test("filters sessions by id, prompt, branch, and cwd", () => {
  const sessions = [
    {
      id: "11111111-2222-3333-4444-555555555555",
      cwd: "/tmp/payment-api",
      gitBranch: "main",
      firstUserMessage: "fix invoice export",
      lastUserMessage: "review refund flow",
    },
    {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      cwd: "/tmp/design-tool",
      gitBranch: "feature/search",
      firstUserMessage: "add canvas picker",
    },
  ];

  assert.deepEqual(filterSessions(sessions, "invoice").map((session) => session.id), [
    "11111111-2222-3333-4444-555555555555",
  ]);
  assert.deepEqual(filterSessions(sessions, "refund").map((session) => session.id), [
    "11111111-2222-3333-4444-555555555555",
  ]);
  assert.deepEqual(filterSessions(sessions, "feature search").map((session) => session.id), [
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ]);
});

test("renders searchable picker with highlighted selection", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        messageCount: 2,
        updatedAt: "2026-04-29T09:00:00.000Z",
        firstUserMessage: "first prompt",
        lastUserMessage: "last prompt",
      },
    ],
    query: "last",
    selectedIndex: 1,
    permissionMode: "full",
    cwd: "/tmp/payment-api",
    now: new Date("2026-04-29T12:00:00.000Z"),
    rows: 20,
  });

  assert.match(output, /^Claude Code sessions  11111111-2222-3333-4444-555555555555$/m);
  assert.match(output, /Workspace: \/tmp\/payment-api/);
  assert.match(output, /^Permission: full {8}Matches: 1 {8}Search: last$/m);
  assert.doesNotMatch(output, /^Search: /m);
  assert.doesNotMatch(output, /^Matches: /m);
  assert.doesNotMatch(output, /Tab switch/);
  assert.doesNotMatch(output, /→ workspaces/);
  assert.doesNotMatch(output, /↑\/↓ move/);
  assert.doesNotMatch(output, /type search/);
  assert.doesNotMatch(output, /Enter open/);
  assert.doesNotMatch(output, /Esc cancel/);
  assert.match(output, /> 1\. 3小时前/);
  assert.match(output, /first prompt/);
  assert.match(output, /last prompt/);
  assert.match(output, /3小时前/);
});

test("renders only the picker title when new session is selected", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        messageCount: 2,
      },
    ],
    selectedIndex: 0,
    cwd: "/tmp/payment-api",
    rows: 20,
  });

  assert.match(output, /^Claude Code sessions$/m);
  assert.doesNotMatch(output.split("\n")[0], /New session/);
  assert.doesNotMatch(output.split("\n")[0], /Session:/);
});

test("renders selected session transcript preview", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        messageCount: 2,
        startedAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:05.000Z",
        version: "2.1.83",
        gitBranch: "main",
        firstUserMessage: "first prompt",
        lastUserMessage: "last prompt",
      },
    ],
    selectedIndex: 1,
    previewSession: {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 2,
      startedAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:05.000Z",
      version: "2.1.83",
      gitBranch: "main",
      firstUserMessage: "first prompt",
      lastUserMessage: "last prompt",
    },
    previewTranscript: {
      messages: [
        { role: "user", timestamp: "2026-04-29T00:00:00", text: "first prompt\nsecond line", ordinal: 1 },
        { role: "user", timestamp: "2026-04-29T00:00:05", text: "last prompt", ordinal: 2 },
      ],
      truncated: false,
      totalMessages: 2,
      messageLimit: 100,
      headCount: 20,
      tailCount: 80,
    },
    now: new Date("2026-05-08T00:00:00"),
    cwd: "/tmp/payment-api",
    rows: 20,
    columns: 100,
  });

  assert.match(output, /^Claude Code sessions  11111111-2222-3333-4444-555555555555$/m);
  assert.match(output, /Messages: 2  Started: 2026-04-29T00:00:00.000Z  Updated: 2026-04-29T00:00:05.000Z/);
  assert.match(output, /Version: 2.1.83  Branch: main/);
  assert.match(output, /Transcript: 2 user messages/);
  assert.match(output, /#1 2026-04-29 00:00:00/);
  assert.match(output, /^first prompt$/m);
  assert.match(output, /^second line$/m);
  assert.doesNotMatch(output, /    first prompt/);
  assert.doesNotMatch(output, /    second line/);
  assert.match(output, /#2 2026-04-29 00:00:05/);
  assert.match(output, /^last prompt$/m);
  assert.doesNotMatch(output, /Assistant:/);
});

test("colors only transcript metadata when color is enabled", () => {
  const output = renderInteractivePicker({
    sessions: [],
    selectedIndex: 1,
    previewSession: {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 1,
    },
    previewTranscript: {
      messages: [{ role: "user", timestamp: "2026-04-29T00:00:00", text: "first prompt", ordinal: 1 }],
      totalMessages: 1,
      truncated: false,
      messageLimit: 100,
      headCount: 20,
      tailCount: 80,
    },
    now: new Date("2026-05-08T00:00:00"),
    cwd: "/tmp/payment-api",
    columns: 100,
    color: true,
  });

  assert.match(output, /\x1b\[36m#1 2026-04-29 00:00:00\x1b\[0m/);
  assert.match(output, /^first prompt$/m);
  assert.doesNotMatch(output, /\x1b\[[0-9;]*mfirst prompt/);
});

test("limits transcript previews to the first 20 and last 80 user messages", () => {
  const transcript = normalizeTranscriptMessages(
    Array.from({ length: 120 }, (_, index) => ({
      role: "user",
      timestamp: "2026-04-29T00:00:00",
      text: `prompt ${index + 1}`,
    })),
  );
  const output = renderInteractivePicker({
    sessions: [],
    selectedIndex: 1,
    previewSession: {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 120,
    },
    previewTranscript: transcript,
    now: new Date("2026-05-08T00:00:00"),
    cwd: "/tmp/payment-api",
    rows: 20,
    columns: 100,
  });

  assert.equal(transcript.messages.length, 100);
  assert.equal(transcript.totalMessages, 120);
  assert.equal(transcript.skippedCount, 20);
  assert.equal(transcript.messages[19].ordinal, 20);
  assert.equal(transcript.messages[20].ordinal, 41);
  assert.match(output, /Transcript: 120 user messages/);
  assert.match(output, /\.\.\. skipped 20 user messages \.\.\./);
  assert.match(output, /#1 2026-04-29 00:00:00/);
  assert.match(output, /^prompt 1$/m);
  assert.doesNotMatch(output, /^prompt 21$/m);
  assert.match(output, /#120 2026-04-29 00:00:00/);
});

test("renders transcript preview errors without leaving the picker", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        messageCount: 2,
      },
    ],
    selectedIndex: 1,
    previewSession: {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 2,
    },
    previewError: "missing session file",
    cwd: "/tmp/payment-api",
    rows: 20,
    columns: 100,
  });

  assert.match(output, /Failed to load transcript:/);
  assert.match(output, /missing session file/);
});

test("space previews selected sessions and escape returns to the session list", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};
  output.on("data", (chunk) => {
    rendered += chunk.toString("utf8");
  });

  const sessions = [
    {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 2,
      firstUserMessage: "first prompt",
      lastUserMessage: "last prompt",
    },
  ];
  const picker = createSessionPicker({
    configPath: path.join(os.tmpdir(), "agent-session-preview-test.json"),
    defaultHome: () => os.tmpdir(),
    homeOptionName: "claudeHome",
    listSessions: () => sessions,
    listWorkspaces: () => [],
    filterSessions,
    renderInteractivePicker,
    renderWorkspacePicker,
    loadSessionTranscript: () => ({
      messages: [
        { role: "user", text: "first prompt", ordinal: 1 },
        { role: "user", text: "last prompt", ordinal: 2 },
      ],
      truncated: false,
      totalMessages: 2,
      messageLimit: 100,
      headCount: 20,
      tailCount: 80,
    }),
    workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
  });
  const picked = picker(sessions, {
    input,
    output,
    cwd: "/tmp/payment-api",
    claudeHome: os.tmpdir(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "down" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /Transcript: 2 user messages/);
  assert.doesNotMatch(rendered, /Assistant:/);
  assert.match(rendered, /last prompt/);

  rendered = "";
  input.emit("keypress", "", { name: "escape" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /> 1\./);
  assert.doesNotMatch(rendered, /First user message:/);

  input.emit("keypress", "", { name: "return" });
  const result = await picked;
  assert.equal(result.item.type, "session");
  assert.equal(result.item.session.id, "11111111-2222-3333-4444-555555555555");
});

test("preview rendering clears scrollback so previous session messages are removed", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};
  output.on("data", (chunk) => {
    rendered += chunk.toString("utf8");
  });

  const sessions = [
    { id: "11111111-2222-3333-4444-555555555555", messageCount: 1 },
    { id: "22222222-3333-4444-5555-666666666666", messageCount: 1 },
  ];
  const picker = createSessionPicker({
    configPath: path.join(os.tmpdir(), "agent-session-preview-clear-test.json"),
    defaultHome: () => os.tmpdir(),
    homeOptionName: "claudeHome",
    listSessions: () => sessions,
    listWorkspaces: () => [],
    filterSessions,
    renderInteractivePicker,
    renderWorkspacePicker,
    loadSessionTranscript: (session) => ({
      messages: [{ role: "user", text: `prompt for ${session.id}`, ordinal: 1 }],
      truncated: false,
      totalMessages: 1,
      messageLimit: 100,
      headCount: 20,
      tailCount: 80,
    }),
    workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
  });
  const picked = picker(sessions, {
    input,
    output,
    cwd: "/tmp/payment-api",
    claudeHome: os.tmpdir(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "down" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /\x1b\[3J\x1b\[2J\x1b\[H/);
  assert.match(rendered, /prompt for 11111111-2222-3333-4444-555555555555/);

  rendered = "";
  input.emit("keypress", "", { name: "escape" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "down" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(rendered, /\x1b\[3J\x1b\[2J\x1b\[H/);
  assert.match(rendered, /prompt for 22222222-3333-4444-5555-666666666666/);
  assert.doesNotMatch(rendered, /prompt for 11111111-2222-3333-4444-555555555555/);

  input.emit("keypress", "", { name: "escape" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "escape" });
  const result = await picked;
  assert.equal(result, null);
});

test("workspace right arrow opens configurations and enter applies a configuration item", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  const applied = [];
  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};
  output.on("data", (chunk) => {
    rendered += chunk.toString("utf8");
  });

  const sessions = [
    {
      id: "11111111-2222-3333-4444-555555555555",
      messageCount: 1,
      cwd: "/tmp/payment-api",
    },
  ];
  const picker = createSessionPicker({
    configPath: path.join(os.tmpdir(), "agent-session-configurations-test.json"),
    defaultHome: () => os.tmpdir(),
    homeOptionName: "claudeHome",
    listSessions: ({ cwd }) => sessions.map((session) => ({ ...session, cwd })),
    listWorkspaces: () => [
      {
        cwd: "/tmp/payment-api",
        sessionCount: 1,
        messageCount: 1,
      },
    ],
    filterSessions,
    renderInteractivePicker,
    renderWorkspacePicker,
    renderConfigurationPicker,
    workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
    configurationTitle: "Test configurations",
    configurationActions: [
      {
        name: "Model provider",
        title: "Test model providers",
        loadItems: () => [
          { name: "openai", selected: true },
          { name: "custom", config: { base_url: "https://api.example.com/v1" } },
        ],
        applyItem: (item) => {
          applied.push(item.name);
          return { status: `Selected model provider: ${item.name}` };
        },
      },
    ],
  });
  const picked = picker(sessions, {
    input,
    output,
    cwd: "/tmp/payment-api",
    claudeHome: os.tmpdir(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "right" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /Claude Code workspaces/);

  rendered = "";
  input.emit("keypress", "", { name: "right" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /Test configurations/);
  assert.match(rendered, /> 0\. Model provider/);

  rendered = "";
  input.emit("keypress", "", { name: "return" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /Test model providers/);
  assert.match(rendered, /> 0\. openai/);
  assert.doesNotMatch(rendered, /current/);

  rendered = "";
  input.emit("keypress", "", { name: "down" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(applied, ["custom"]);
  assert.match(rendered, /Test configurations/);
  assert.match(rendered, /Selected model provider: custom/);

  rendered = "";
  input.emit("keypress", "", { name: "escape" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered, /Claude Code workspaces/);

  input.emit("keypress", "", { name: "return" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  const result = await picked;
  assert.equal(result.cwd, "/tmp/payment-api");
  assert.equal(result.item.type, "new");
});

test("Claude configurations show model actions in order with current model names", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-configurations-models-"));
  const claudeHome = path.join(tempDir, ".claude");
  const cwd = path.join(tempDir, "payment-api");
  const projectDir = path.join(claudeHome, "projects", encodeProjectPath(cwd));
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "11111111-2222-3333-4444-555555555555.jsonl"),
    JSON.stringify({
      type: "user",
      timestamp: "2026-04-29T00:00:00.000Z",
      cwd,
      sessionId: "11111111-2222-3333-4444-555555555555",
      message: { role: "user", content: "hello" },
    }),
  );
  fs.writeFileSync(
    path.join(claudeHome, "settings.json"),
    `${JSON.stringify({
      model_provider_selected: "custom",
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.5-air",
      },
      provider: {
        custom: {
          ANTHROPIC_BASE_URL: "https://api.example.com",
          ANTHROPIC_AUTH_TOKEN: "test-token",
        },
      },
    }, null, 2)}\n`,
  );

  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};
  output.on("data", (chunk) => {
    rendered += chunk.toString("utf8");
  });

  const sessions = listSessions({ cwd, claudeHome });
  const picker = pickAndRunClaude(sessions, {
    input,
    output,
    cwd,
    claudeHome,
    configPath: path.join(tempDir, "picker.json"),
    runCommand: () => {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "right" });
  await new Promise((resolve) => setImmediate(resolve));
  rendered = "";
  input.emit("keypress", "", { name: "right" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(rendered, /Claude Code configurations/);
  assert.match(rendered, /> 0\. Model provider\s+custom/);
  assert.match(rendered, /1\. Opus model\s+glm-5\.1/);
  assert.match(rendered, /2\. Sonnet model\s+glm-4\.6/);
  assert.match(rendered, /3\. Haiku model\s+glm-4\.5-air/);

  input.emit("keypress", "", { name: "escape" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  await picker;
});

test("renders picker status fields in fixed columns", () => {
  const fullOutput = renderInteractivePicker({
    sessions: [
      { id: "11111111-2222-3333-4444-555555555555", messageCount: 1 },
      { id: "22222222-3333-4444-5555-666666666666", messageCount: 1 },
      { id: "33333333-4444-5555-6666-777777777777", messageCount: 1 },
    ],
    permissionMode: "full",
    cwd: "/tmp/payment-api",
    rows: 20,
    columns: 100,
  });
  const defaultOutput = renderInteractivePicker({
    sessions: Array.from({ length: 100 }, (_, index) => ({
      id: `${String(index).padStart(8, "0")}-2222-3333-4444-555555555555`,
      messageCount: 1,
      lastUserMessage: "refunds",
    })),
    permissionMode: "default",
    query: "refunds",
    cwd: "/tmp/payment-api",
    rows: 20,
    columns: 100,
  });
  const fullLine = fullOutput.split("\n")[2];
  const defaultLine = defaultOutput.split("\n")[2];

  assert.equal(fullLine, "Permission: full        Matches: 3        Search: ");
  assert.equal(defaultLine, "Permission: default     Matches: 100      Search: refunds");
  assert.equal(fullLine.indexOf("Matches:"), defaultLine.indexOf("Matches:"));
  assert.equal(fullLine.indexOf("Search:"), defaultLine.indexOf("Search:"));
});

test("colors permission modes and selected sessions in the interactive picker", () => {
  const baseOptions = {
    sessions: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        messageCount: 2,
        updatedAt: "2026-04-29T11:00:00.000Z",
        firstUserMessage: "first prompt",
        lastUserMessage: "last prompt",
      },
    ],
    selectedIndex: 1,
    cwd: "/tmp/payment-api",
    now: new Date("2026-04-29T12:00:00.000Z"),
    rows: 20,
    columns: 100,
    color: true,
  };

  const defaultOutput = renderInteractivePicker({ ...baseOptions, permissionMode: "default" });
  const autoOutput = renderInteractivePicker({ ...baseOptions, permissionMode: "auto" });
  const fullOutput = renderInteractivePicker({ ...baseOptions, permissionMode: "full" });

  assert.match(defaultOutput, /Permission: \x1b\[32mdefault\x1b\[0m/);
  assert.match(autoOutput, /Permission: \x1b\[34mauto\x1b\[0m/);
  assert.match(fullOutput, /Permission: \x1b\[31mfull\x1b\[0m/);
  assert.match(defaultOutput, /\x1b\[36m> 1\. 1小时前\s+2 msg\s+first prompt\s+last prompt\x1b\[0m/);
  assert.ok(defaultOutput.split("\n").every((line) => displayWidth(line) <= 100));
});

test("calculates terminal display width and truncates without overflowing", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("\x1b[31mred\x1b[0m"), 3);
  assert.equal(truncateToWidth("abcdef", 4), "a...");
  assert.equal(truncateToWidth("中文内容", 7), "中文...");
});

test("renders picker rows with aligned columns and width-limited prompts", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        messageCount: 2,
        updatedAt: "2026-04-29T11:59:00.000Z",
        firstUserMessage: "short prompt",
        lastUserMessage: "short last prompt",
      },
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        messageCount: 1000,
        updatedAt: "2026-04-25T12:00:00.000Z",
        firstUserMessage: "这是一个很长很长的首条消息，需要根据终端宽度裁剪，不能换行",
        lastUserMessage: "这是一个很长很长的最后一条用户消息，需要根据终端宽度裁剪，不能换行",
      },
    ],
    now: new Date("2026-04-29T12:00:00.000Z"),
    rows: 20,
    columns: 72,
  });
  const lines = output.split("\n").filter((line) => /\d\.\s+(1分钟前|4天前)/.test(line));
  function nthIndexOf(value, search, occurrence) {
    let fromIndex = 0;
    for (let index = 1; index <= occurrence; index += 1) {
      const foundIndex = value.indexOf(search, fromIndex);
      if (foundIndex === -1) {
        return -1;
      }
      if (index === occurrence) {
        return foundIndex;
      }
      fromIndex = foundIndex + search.length;
    }
    return -1;
  }
  const firstPromptStarts = lines.map((line) => {
    const marker = line.includes("short prompt") ? "short prompt" : "这是";
    return displayWidth(line.slice(0, line.indexOf(marker)));
  });
  const lastPromptStarts = lines.map((line) => {
    const marker = line.includes("short last pr") ? "short last pr" : "这是";
    const index = line.includes("short last pr")
      ? line.indexOf(marker)
      : nthIndexOf(line, marker, 2);
    return displayWidth(line.slice(0, index));
  });

  assert.equal(firstPromptStarts[0], firstPromptStarts[1]);
  assert.equal(lastPromptStarts[0], lastPromptStarts[1]);
  assert.match(lines[0], /short prompt/);
  assert.match(lines[0], /short last prompt/);
  assert.ok(lines.every((line) => displayWidth(line) <= 72));
  assert.ok(lines[1].endsWith("..."));
});

test("lists Claude Code workspaces from project session files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-workspaces-"));
  const claudeHome = path.join(tempDir, ".claude");
  const firstCwd = path.join(tempDir, "first workspace");
  const secondCwd = path.join(tempDir, "second workspace");
  const firstProjectDir = path.join(claudeHome, "projects", encodeProjectPath(firstCwd));
  const secondProjectDir = path.join(claudeHome, "projects", encodeProjectPath(secondCwd));

  fs.mkdirSync(firstProjectDir, { recursive: true });
  fs.mkdirSync(secondProjectDir, { recursive: true });
  fs.writeFileSync(
    path.join(firstProjectDir, "11111111-2222-3333-4444-555555555555.jsonl"),
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-29T00:00:00.000Z",
        cwd: firstCwd,
        sessionId: "11111111-2222-3333-4444-555555555555",
        message: { role: "user", content: "first workspace prompt" },
      }),
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(secondProjectDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-29T00:01:00.000Z",
        cwd: secondCwd,
        sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        message: { role: "user", content: "second workspace prompt" },
      }),
    ].join("\n"),
  );

  const workspaces = listWorkspaces({ claudeHome });

  assert.equal(workspaces.length, 2);
  assert.equal(workspaces[0].cwd, secondCwd);
  assert.equal(workspaces[0].sessionCount, 1);
  assert.equal(workspaces[0].messageCount, 1);
  assert.equal(workspaces[0].updatedAt, "2026-04-29T00:01:00.000Z");
  assert.equal(workspaces[0].lastUserMessage, "second workspace prompt");
  assert.equal(workspaces[1].cwd, firstCwd);
});

test("renders searchable workspace picker", () => {
  const output = renderWorkspacePicker({
    workspaces: [
      {
        cwd: "/tmp/first-workspace",
        sessionCount: 2,
        messageCount: 20,
        updatedAt: "2026-04-29T11:59:00.000Z",
        lastUserMessage: "first prompt",
      },
      {
        cwd: "/tmp/second-workspace-with-a-very-long-path-name",
        sessionCount: 1000,
        messageCount: 12345,
        updatedAt: "2026-04-25T12:00:00.000Z",
        lastUserMessage: "second prompt",
      },
    ],
    query: "second",
    selectedIndex: 0,
    now: new Date("2026-04-29T12:00:00.000Z"),
    rows: 20,
    columns: 64,
  });

  assert.match(output, /Claude Code workspaces/);
  assert.match(output, /Search: second/);
  assert.doesNotMatch(output, /↑\/↓ move/);
  assert.doesNotMatch(output, /type search/);
  assert.doesNotMatch(output, /Enter choose/);
  assert.doesNotMatch(output, /← sessions/);
  assert.doesNotMatch(output, /Esc cancel/);
  assert.match(output, /> 0\. 4天前\s+1000 sessions\s+12345 msg/);
  assert.match(output, /second-workspac/);
  assert.ok(output.split("\n").every((line) => displayWidth(line) <= 64));
});

test("colors the selected workspace row in the workspace picker", () => {
  const output = renderWorkspacePicker({
    workspaces: [
      {
        cwd: "/tmp/first-workspace",
        sessionCount: 2,
        messageCount: 20,
        updatedAt: "2026-04-29T11:00:00.000Z",
      },
      {
        cwd: "/tmp/second-workspace",
        sessionCount: 1,
        messageCount: 10,
        updatedAt: "2026-04-29T11:30:00.000Z",
      },
    ],
    selectedIndex: 1,
    now: new Date("2026-04-29T12:00:00.000Z"),
    rows: 20,
    columns: 100,
    color: true,
  });

  assert.match(output, /\x1b\[36m> 1\. 30分钟前\s+1 sessions\s+10 msg\s+\/tmp\/second-workspace\x1b\[0m/);
  assert.doesNotMatch(output, /\x1b\[36m  0\. 1小时前/);
  assert.ok(output.split("\n").every((line) => displayWidth(line) <= 100));
});

test("marks the current folder trusted in Claude config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-trust-"));
  const configPath = path.join(tempDir, ".claude.json");
  const cwd = path.join(tempDir, "project");

  fs.writeFileSync(configPath, JSON.stringify({ projects: {} }, null, 2));
  markProjectTrusted(cwd, configPath);

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.projects[path.resolve(cwd)].hasTrustDialogAccepted, true);
});
