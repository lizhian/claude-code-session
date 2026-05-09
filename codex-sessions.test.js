const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  DEFAULT_CONFIG_PATH,
  buildCodexCommand,
  dedupeTranscriptMessages,
  loadSessionTranscript,
  listSessions,
  listWorkspaces,
  markProjectTrusted,
  parseArgs,
  pickAndRunCodex,
  renderInteractivePicker,
  renderWorkspacePicker,
  syncCodexThreads,
} = require("./codex/codex-sessions");

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

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

function writeCodexProviderConfig(codexHome, selectedProviderName = "openai") {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "model = \"gpt-5\"",
      `model_provider_selected = ${JSON.stringify(selectedProviderName)}`,
      "",
      "[model_providers.openai]",
      "auth_json = '''{\"OPENAI_API_KEY\":\"default-key\"}'''",
      "",
      "[model_providers.custom]",
      "base_url = \"https://api.example.com/v1\"",
      "auth_json = '''{\"OPENAI_API_KEY\":\"custom-key\"}'''",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(codexHome, "auth.json"), `${JSON.stringify({ OPENAI_API_KEY: "fresh-key" })}\n`);
}

async function openCodexProviderItems(input) {
  await nextTick();
  input.emit("keypress", "", { name: "right" });
  await nextTick();
  input.emit("keypress", "", { name: "right" });
  await nextTick();
  input.emit("keypress", "", { name: "return" });
  await nextTick();
}

async function finishPicker(input, picker) {
  input.emit("keypress", "", { name: "escape" });
  await nextTick();
  input.emit("keypress", "", { name: "return" });
  await nextTick();
  input.emit("keypress", "", { name: "return" });
  await picker;
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

test("deduplicates Codex transcript user records written as response_item and event_msg", () => {
  assert.deepEqual(
    dedupeTranscriptMessages([
      { role: "user", timestamp: "2026-05-08T03:49:45.468Z", text: "same prompt\n" },
      { role: "user", timestamp: "2026-05-08T03:49:45.468Z", text: "same prompt" },
      { role: "assistant", timestamp: "2026-05-08T03:49:46.000Z", text: "reply" },
      { role: "user", timestamp: "2026-05-08T03:50:00.000Z", text: "next prompt" },
    ]),
    [
      { role: "user", timestamp: "2026-05-08T03:49:45.468Z", text: "same prompt\n" },
      { role: "assistant", timestamp: "2026-05-08T03:49:46.000Z", text: "reply" },
      { role: "user", timestamp: "2026-05-08T03:50:00.000Z", text: "next prompt" },
    ],
  );
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

test("syncs Codex threads with the selected provider and Codex home", () => {
  const codexHome = path.join(os.tmpdir(), "codex-threadripper-home");
  const cwd = path.join(os.tmpdir(), "codex-threadripper-cwd");
  const calls = [];

  const result = syncCodexThreads("custom", codexHome, {
    cwd,
    commandExists: (command) => command === "codex-threadripper",
    runSync: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(result, { synced: true });
  assert.deepEqual(calls, [
    {
      command: "codex-threadripper",
      args: ["--codex-home", codexHome, "--provider", "custom", "sync"],
      options: {
        cwd,
        env: { CODEX_HOME: codexHome },
      },
    },
  ]);
});

test("skips Codex thread sync when codex-threadripper is not installed", () => {
  let ran = false;

  const result = syncCodexThreads("custom", "/tmp/codex", {
    commandExists: () => false,
    runSync: () => {
      ran = true;
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { skipped: true, reason: "missing-command" });
  assert.equal(ran, false);
});

test("reports Codex thread sync failures with a concise reason", () => {
  const result = syncCodexThreads("custom", "/tmp/codex", {
    commandExists: () => true,
    runSync: () => ({
      status: 1,
      stderr: ` ${"sync failed ".repeat(20)}\nsecond line`,
      stdout: "",
    }),
  });

  assert.equal(result.synced, false);
  assert.match(result.error, /^sync failed sync failed/);
  assert.ok(result.error.length <= 120);
  assert.doesNotMatch(result.error, /second line/);
});

test("Codex provider switch runs codex-threadripper sync once", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-threadripper-"));
  const codexHome = path.join(tempDir, ".codex");
  const cwd = path.join(tempDir, "payment-api");
  const input = new PassThrough();
  const output = new PassThrough();
  const calls = [];

  writeCodexSession(path.join(codexHome, "sessions", "2026", "04", "29", "rollout-1.jsonl"), {
    id: "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4",
    cwd,
    startedAt: "2026-04-29T14:56:25.542Z",
    updatedAt: "2026-04-29T15:00:00.000Z",
    firstPrompt: "first prompt",
    lastPrompt: "last prompt",
  });
  writeCodexProviderConfig(codexHome, "openai");

  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};

  const picker = pickAndRunCodex(listSessions({ cwd, codexHome }), {
    input,
    output,
    cwd,
    codexHome,
    configPath: path.join(tempDir, "picker.json"),
    runCommand: () => {},
    codexThreadripper: {
      commandExists: () => true,
      runSync: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  });

  await openCodexProviderItems(input);
  input.emit("keypress", "", { name: "down" });
  await nextTick();
  input.emit("keypress", "", { name: "return" });
  await nextTick();
  await finishPicker(input, picker);

  assert.deepEqual(calls, [
    {
      command: "codex-threadripper",
      args: ["--codex-home", codexHome, "--provider", "custom", "sync"],
      options: {
        cwd,
        env: { CODEX_HOME: codexHome },
      },
    },
  ]);
});

test("Codex provider auth refresh does not run codex-threadripper sync", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-threadripper-same-"));
  const codexHome = path.join(tempDir, ".codex");
  const cwd = path.join(tempDir, "payment-api");
  const input = new PassThrough();
  const output = new PassThrough();
  const calls = [];

  writeCodexSession(path.join(codexHome, "sessions", "2026", "04", "29", "rollout-1.jsonl"), {
    id: "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4",
    cwd,
    startedAt: "2026-04-29T14:56:25.542Z",
    updatedAt: "2026-04-29T15:00:00.000Z",
    firstPrompt: "first prompt",
    lastPrompt: "last prompt",
  });
  writeCodexProviderConfig(codexHome, "openai");

  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};

  const picker = pickAndRunCodex(listSessions({ cwd, codexHome }), {
    input,
    output,
    cwd,
    codexHome,
    configPath: path.join(tempDir, "picker.json"),
    runCommand: () => {},
    codexThreadripper: {
      commandExists: () => true,
      runSync: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  });

  await openCodexProviderItems(input);
  input.emit("keypress", "", { name: "return" });
  await nextTick();
  await finishPicker(input, picker);

  assert.deepEqual(calls, []);
});

test("Codex configurations show the current model provider", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-configurations-provider-"));
  const codexHome = path.join(tempDir, ".codex");
  const cwd = path.join(tempDir, "payment-api");
  const sessionDir = path.join(codexHome, "sessions", "2026", "04", "29");
  const sessionId = "019dd9bd-c3c2-7de0-9c85-adcd2e6b21e4";
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";

  writeCodexSession(path.join(sessionDir, `rollout-2026-04-29T22-56-25-${sessionId}.jsonl`), {
    id: sessionId,
    cwd,
    startedAt: "2026-04-29T14:56:25.542Z",
    updatedAt: "2026-04-29T15:00:00.000Z",
    firstPrompt: "first prompt",
    lastPrompt: "last prompt",
  });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "model_provider_selected = \"axonhub\"",
      "",
      "[model_providers.axonhub]",
      "name = \"axonhub\"",
      "base_url = \"https://api.example.com/v1\"",
      "",
    ].join("\n"),
  );

  input.isTTY = true;
  output.isTTY = true;
  output.rows = 24;
  output.columns = 100;
  input.setRawMode = () => {};
  output.on("data", (chunk) => {
    rendered += chunk.toString("utf8");
  });

  const sessions = listSessions({ cwd, codexHome });
  const picker = pickAndRunCodex(sessions, {
    input,
    output,
    cwd,
    codexHome,
    configPath: path.join(tempDir, "picker.json"),
    runCommand: () => {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "right" });
  await new Promise((resolve) => setImmediate(resolve));
  rendered = "";
  input.emit("keypress", "", { name: "right" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(rendered, /Codex configurations/);
  assert.match(rendered, /> 0\. Model provider\s+axonhub/);

  input.emit("keypress", "", { name: "escape" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit("keypress", "", { name: "return" });
  await picker;
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
