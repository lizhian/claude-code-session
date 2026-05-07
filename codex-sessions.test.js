const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_CONFIG_PATH,
  buildCodexCommand,
  loadSessionTranscript,
  listSessions,
  listWorkspaces,
  markProjectTrusted,
  parseArgs,
  renderInteractivePicker,
  renderWorkspacePicker,
} = require("./codex/codex-sessions");

function writeCodexSession(file, options) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      JSON.stringify({
        timestamp: options.startedAt,
        type: "session_meta",
        payload: {
          id: options.id,
          timestamp: options.startedAt,
          cwd: options.cwd,
          cli_version: options.version || "0.126.0-alpha.8",
        },
      }),
      JSON.stringify({
        timestamp: options.firstPromptAt || options.startedAt,
        type: "event_msg",
        payload: { type: "user_message", message: options.firstPrompt },
      }),
      JSON.stringify({
        timestamp: options.updatedAt,
        type: "event_msg",
        payload: { type: "user_message", message: options.lastPrompt },
      }),
    ].join("\n"),
  );
}

test("stores default Codex config under the Codex picker install directory", () => {
  assert.equal(DEFAULT_CONFIG_PATH, path.join(os.homedir(), ".agent-session", "codex.json"));
});

test("lists sessions for a cwd from Codex jsonl files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sessions-"));
  const codexHome = path.join(tempDir, ".codex");
  const cwd = path.join(tempDir, "demo project");
  const sessionDir = path.join(codexHome, "sessions", "2026", "04", "29");
  const sessionId = "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4";
  const sessionFile = path.join(sessionDir, `rollout-2026-04-29T22-56-25-${sessionId}.jsonl`);

  writeCodexSession(sessionFile, {
    id: sessionId,
    cwd,
    startedAt: "2026-04-29T14:56:25.542Z",
    updatedAt: "2026-04-29T15:00:00.000Z",
    firstPrompt: "first prompt",
    lastPrompt: "last prompt",
  });

  const sessions = listSessions({ cwd, codexHome });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].messageCount, 3);
  assert.equal(sessions[0].firstUserMessage, "first prompt");
  assert.equal(sessions[0].lastUserMessage, "last prompt");
  assert.equal(sessions[0].startedAt, "2026-04-29T14:56:25.542Z");
  assert.equal(sessions[0].updatedAt, "2026-04-29T15:00:00.000Z");
  assert.equal(sessions[0].file, sessionFile);
});

test("loads full Codex transcript text from a session file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-transcript-"));
  const sessionFile = path.join(tempDir, "session.jsonl");
  fs.writeFileSync(
    sessionFile,
    [
      JSON.stringify({
        timestamp: "2026-04-29T14:56:25.542Z",
        type: "event_msg",
        payload: { type: "user_message", message: "first prompt" },
      }),
      JSON.stringify({
        timestamp: "2026-04-29T14:57:25.542Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "assistant reply" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-29T15:00:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "last prompt" },
      }),
    ].join("\n"),
  );

  assert.deepEqual(loadSessionTranscript({ file: sessionFile }).messages, [
    { role: "user", timestamp: "2026-04-29T14:56:25.542Z", text: "first prompt", ordinal: 1 },
    { role: "user", timestamp: "2026-04-29T15:00:00.000Z", text: "last prompt", ordinal: 2 },
  ]);
});

test("lists Codex workspaces grouped by cwd", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-workspaces-"));
  const codexHome = path.join(tempDir, ".codex");
  const firstCwd = path.join(tempDir, "first workspace");
  const secondCwd = path.join(tempDir, "second workspace");

  writeCodexSession(
    path.join(codexHome, "sessions", "2026", "04", "29", "rollout-1-019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4.jsonl"),
    {
      id: "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4",
      cwd: firstCwd,
      startedAt: "2026-04-29T14:00:00.000Z",
      updatedAt: "2026-04-29T14:10:00.000Z",
      firstPrompt: "first workspace prompt",
      lastPrompt: "first workspace last",
    },
  );
  writeCodexSession(
    path.join(codexHome, "sessions", "2026", "04", "29", "rollout-2-019dd9bf-68ec-7cf2-a818-97d1b3a8a873.jsonl"),
    {
      id: "019dd9bf-68ec-7cf2-a818-97d1b3a8a873",
      cwd: secondCwd,
      startedAt: "2026-04-29T15:00:00.000Z",
      updatedAt: "2026-04-29T15:10:00.000Z",
      firstPrompt: "second workspace prompt",
      lastPrompt: "second workspace last",
    },
  );

  const workspaces = listWorkspaces({ codexHome });

  assert.equal(workspaces.length, 2);
  assert.equal(workspaces[0].cwd, secondCwd);
  assert.equal(workspaces[0].sessionCount, 1);
  assert.equal(workspaces[0].lastUserMessage, "second workspace last");
  assert.equal(workspaces[1].cwd, firstCwd);
});

test("builds codex command for new session and resume choices", () => {
  const sessions = [{ id: "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4" }];

  assert.deepEqual(buildCodexCommand(sessions, "0"), { command: "codex", args: [] });
  assert.deepEqual(buildCodexCommand(sessions, ""), { command: "codex", args: [] });
  assert.deepEqual(buildCodexCommand(sessions, "1"), {
    command: "codex",
    args: ["resume", "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4"],
  });
  assert.deepEqual(buildCodexCommand(sessions, "0", { permissionMode: "auto" }), {
    command: "codex",
    args: ["--full-auto"],
  });
  assert.deepEqual(buildCodexCommand(sessions, "1", { permissionMode: "auto" }), {
    command: "codex",
    args: ["--full-auto", "resume", "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4"],
  });
  assert.deepEqual(buildCodexCommand(sessions, "0", { permissionMode: "full" }), {
    command: "codex",
    args: ["--dangerously-bypass-approvals-and-sandbox"],
  });
  assert.deepEqual(buildCodexCommand(sessions, "1", { permissionMode: "full" }), {
    command: "codex",
    args: ["--dangerously-bypass-approvals-and-sandbox", "resume", "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4"],
  });
});

test("renders Codex picker titles without changing picker behavior", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4",
        messageCount: 3,
        updatedAt: "2026-04-29T15:00:00.000Z",
        firstUserMessage: "first prompt",
        lastUserMessage: "last prompt",
      },
    ],
    selectedIndex: 1,
    cwd: "/tmp/demo",
    now: new Date("2026-04-29T16:00:00.000Z"),
  });

  assert.match(output, /^Codex sessions  019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4$/m);
  assert.match(output, /> 1\. 1小时前/);
  assert.doesNotMatch(output, /019dd9bd  /);
});

test("renders Codex workspace picker title", () => {
  const output = renderWorkspacePicker({
    workspaces: [
      {
        cwd: "/tmp/demo",
        sessionCount: 1,
        updatedAt: "2026-04-29T15:00:00.000Z",
      },
    ],
    now: new Date("2026-04-29T16:00:00.000Z"),
  });

  assert.match(output, /Codex workspaces/);
});

test("parses Codex-specific home option", () => {
  assert.deepEqual(parseArgs(["--codex-home", "/tmp/codex", "--cwd=/tmp/project"]), {
    cwd: "/tmp/project",
    codexHome: "/tmp/codex",
    json: false,
    pick: false,
    trustCurrentFolder: false,
    help: false,
  });
});

test("marks the current folder trusted in Codex config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-trust-"));
  const configPath = path.join(tempDir, "config.toml");
  const cwd = path.join(tempDir, "project");

  fs.writeFileSync(configPath, "model = \"gpt-5\"\n");
  markProjectTrusted(cwd, configPath);

  const config = fs.readFileSync(configPath, "utf8");
  assert.match(config, /model = "gpt-5"/);
  assert.match(config, new RegExp(`\\[projects\\."${cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\]`));
  assert.match(config, /trust_level = "trusted"/);
});

test("updates an existing Codex trusted project section idempotently", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-trust-existing-"));
  const configPath = path.join(tempDir, "config.toml");
  const cwd = path.join(tempDir, "project");

  fs.writeFileSync(
    configPath,
    [
      "model = \"gpt-5\"",
      "",
      `[projects."${cwd}"]`,
      "trust_level = \"untrusted\"",
      "extra = \"keep\"",
      "",
    ].join("\n"),
  );
  markProjectTrusted(cwd, configPath);

  const config = fs.readFileSync(configPath, "utf8");
  assert.equal((config.match(new RegExp(`\\[projects\\."${cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\]`, "g")) || []).length, 1);
  assert.match(config, /trust_level = "trusted"/);
  assert.match(config, /extra = "keep"/);
});
