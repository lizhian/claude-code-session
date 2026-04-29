const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_CONFIG_PATH,
  buildClaudeCommand,
  loadLaunchMode,
  displayWidth,
  encodeProjectPath,
  filterSessions,
  formatPicker,
  formatSessionTime,
  formatSessions,
  listWorkspaces,
  markProjectTrusted,
  renderInteractivePicker,
  renderWorkspacePicker,
  saveLaunchMode,
  shortSessionId,
  truncateToWidth,
  listSessions,
} = require("./claude-sessions");

test("stores default config under the install directory", () => {
  assert.equal(DEFAULT_CONFIG_PATH, path.join(os.homedir(), ".claude-code-session", "config.json"));
});

test("encodes absolute paths the way Claude Code stores project directories", () => {
  assert.equal(encodeProjectPath("/Users/lizhian/临时"), "-Users-lizhian---");
  assert.equal(
    encodeProjectPath("/Users/lizhian/Documents/Codex/2026-04-29/claude-code-session"),
    "-Users-lizhian-Documents-Codex-2026-04-29-claude-code-session",
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

  assert.match(output, /SESSION ID/);
  assert.match(output, /FIRST USER MESSAGE/);
  assert.match(output, /LAST USER MESSAGE/);
  assert.match(output, /11111111-2222-3333-4444-555555555555/);
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

  assert.match(output, /1\. New session/);
  assert.match(output, /2\. 11111111/);
  assert.doesNotMatch(output, /11111111-2222-3333-4444-555555555555/);
  assert.match(output, /3小时前/);
  assert.match(output, /first prompt/);
  assert.match(output, /last prompt/);
});

test("builds claude command for new session and resume choices", () => {
  const sessions = [{ id: "11111111-2222-3333-4444-555555555555" }];

  assert.deepEqual(buildClaudeCommand(sessions, "1"), { command: "claude", args: [] });
  assert.deepEqual(buildClaudeCommand(sessions, ""), { command: "claude", args: [] });
  assert.deepEqual(buildClaudeCommand(sessions, "2"), {
    command: "claude",
    args: ["--resume", "11111111-2222-3333-4444-555555555555"],
  });
  assert.deepEqual(buildClaudeCommand(sessions, "1", { launchMode: "trust" }), {
    command: "claude",
    args: ["--dangerously-skip-permissions"],
  });
  assert.deepEqual(buildClaudeCommand(sessions, "2", { launchMode: "trust" }), {
    command: "claude",
    args: ["--dangerously-skip-permissions", "--resume", "11111111-2222-3333-4444-555555555555"],
  });
});

test("loads normal launch mode when config is missing or invalid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-config-"));
  const configPath = path.join(tempDir, "config.json");

  assert.equal(loadLaunchMode(configPath), "normal");

  fs.writeFileSync(configPath, "{not json");
  assert.equal(loadLaunchMode(configPath), "normal");

  fs.writeFileSync(configPath, JSON.stringify({ launchMode: "invalid" }));
  assert.equal(loadLaunchMode(configPath), "normal");
});

test("saves launch mode so the next picker run can use it as default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-session-config-"));
  const configPath = path.join(tempDir, "nested", "config.json");

  saveLaunchMode("trust", configPath);
  assert.equal(loadLaunchMode(configPath), "trust");

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.extra = "keep me";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  saveLaunchMode("normal", configPath);
  const updatedConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(updatedConfig.launchMode, "normal");
  assert.equal(updatedConfig.extra, "keep me");
});

test("rejects invalid picker choices", () => {
  assert.throws(
    () => buildClaudeCommand([{ id: "11111111-2222-3333-4444-555555555555" }], "3"),
    /Invalid choice/,
  );
});

test("formats session ids and relative times for the picker", () => {
  const now = new Date("2026-04-29T12:00:00.000Z");

  assert.equal(shortSessionId("11111111-2222-3333-4444-555555555555"), "11111111");
  assert.equal(formatSessionTime("2026-04-29T11:59:00.000Z", now), "1分钟前");
  assert.equal(formatSessionTime("2026-04-29T09:00:00.000Z", now), "3小时前");
  assert.equal(formatSessionTime("2026-04-28T12:00:00.000Z", now), "1天前");
  assert.equal(formatSessionTime("2026-04-25T12:00:00.000Z", now), "2026-04-25");
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
    launchMode: "trust",
    cwd: "/tmp/payment-api",
    now: new Date("2026-04-29T12:00:00.000Z"),
    rows: 20,
  });

  assert.match(output, /Workspace: \/tmp\/payment-api/);
  assert.match(output, /Launch: 信任模式/);
  assert.match(output, /Tab switch/);
  assert.match(output, /→ workspaces/);
  assert.match(output, /Search: last/);
  assert.match(output, /> 2\. 11111111/);
  assert.match(output, /first prompt/);
  assert.match(output, /last prompt/);
  assert.match(output, /3小时前/);
  assert.doesNotMatch(output, /11111111-2222-3333-4444-555555555555/);
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
  const lines = output.split("\n").filter((line) => /\d\.\s+(11111111|aaaaaaaa)/.test(line));
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
  assert.match(lines[0], /short last pr\.\.\./);
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
        updatedAt: "2026-04-29T11:59:00.000Z",
        lastUserMessage: "first prompt",
      },
      {
        cwd: "/tmp/second-workspace-with-a-very-long-path-name",
        sessionCount: 1000,
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
  assert.match(output, /← sessions/);
  assert.match(output, /> 1\. 2026-04-25  1000 sessions/);
  assert.match(output, /second-workspace/);
  assert.ok(output.split("\n").every((line) => displayWidth(line) <= 64));
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
