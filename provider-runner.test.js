const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { pickAndRunProvider, runProviderCli } = require("./common/provider-runner");

function captureOutput() {
  const chunks = [];
  return {
    stream: {
      isTTY: false,
      write: (chunk) => {
        chunks.push(chunk);
      },
    },
    text: () => chunks.join(""),
  };
}

function fakeProvider(overrides = {}) {
  return {
    configPath: path.join(os.tmpdir(), "agent-session-provider-runner.json"),
    defaultHome: () => "/tmp/provider-home",
    homeOptionName: "providerHome",
    listSessions: () => [{ id: "session-1", messageCount: 2, updatedAt: "2026-05-08T00:00:00.000Z" }],
    pickSessionInteractive: () => null,
    selectedItemToCommand: (item, options) => ({
      command: "provider",
      args: ["resume", item.session.id, options.permissionMode],
      cwd: options.cwd,
    }),
    buildCommandFromChoice: (sessions, choice, options) => ({
      command: "provider",
      args: [choice || "0", options.permissionMode],
    }),
    formatPicker: () => "0. new\n1. session-1",
    formatSessions: () => "formatted sessions",
    jsonPayload: ({ cwd, providerHome, sessions }) => ({ cwd, providerHome, count: sessions.length, sessions }),
    summaryLines: ({ cwd, providerHome, sessions }) => [
      `CWD: ${cwd}`,
      `Provider home: ${providerHome}`,
      `Sessions: ${sessions.length}`,
    ],
    ...overrides,
  };
}

test("runProviderCli writes provider JSON payload", async () => {
  const output = captureOutput();

  await runProviderCli(fakeProvider(), {
    cwd: "/tmp/project",
    providerHome: "/tmp/home",
    json: true,
    output: output.stream,
  });

  assert.deepEqual(JSON.parse(output.text()), {
    cwd: "/tmp/project",
    providerHome: "/tmp/home",
    count: 1,
    sessions: [{ id: "session-1", messageCount: 2, updatedAt: "2026-05-08T00:00:00.000Z" }],
  });
});

test("runProviderCli writes provider summary and formatted sessions", async () => {
  const output = captureOutput();

  await runProviderCli(fakeProvider(), {
    cwd: "/tmp/project",
    providerHome: "/tmp/home",
    output: output.stream,
  });

  assert.equal(
    output.text(),
    [
      "CWD: /tmp/project",
      "Provider home: /tmp/home",
      "Sessions: 1",
      "",
      "formatted sessions",
      "",
    ].join("\n"),
  );
});

test("pickAndRunProvider runs selected interactive session and trusts picked cwd", async () => {
  const commands = [];
  const trusted = [];
  const provider = fakeProvider({
    pickSessionInteractive: () => ({
      item: { type: "session", session: { id: "session-2" } },
      permissionMode: "full",
      cwd: "/tmp/picked",
    }),
    trustCurrentFolder: (cwd) => trusted.push(cwd),
  });

  await pickAndRunProvider(provider, [{ id: "session-2" }], {
    cwd: "/tmp/project",
    trustCurrentFolder: true,
    runCommand: (command, args, options) => commands.push({ command, args, options }),
  });

  assert.deepEqual(trusted, ["/tmp/picked"]);
  assert.deepEqual(commands, [
    {
      command: "provider",
      args: ["resume", "session-2", "full"],
      options: { cwd: "/tmp/picked", env: undefined },
    },
  ]);
});

test("pickAndRunProvider falls back to numbered prompt outside TTY", async () => {
  const output = captureOutput();
  const commands = [];
  const trusted = [];
  const provider = fakeProvider({
    trustCurrentFolder: (cwd) => trusted.push(cwd),
  });

  await pickAndRunProvider(provider, [{ id: "session-1", messageCount: 1 }], {
    cwd: "/tmp/project",
    permissionMode: "auto",
    trustCurrentFolder: true,
    output: output.stream,
    askQuestion: async () => "1",
    runCommand: (command, args, options) => commands.push({ command, args, options }),
  });

  assert.match(output.text(), /0\. new\n1\. session-1\n\n/);
  assert.deepEqual(trusted, ["/tmp/project"]);
  assert.deepEqual(commands, [
    {
      command: "provider",
      args: ["1", "auto"],
      options: { cwd: "/tmp/project", env: undefined },
    },
  ]);
});

test("runProviderCli applies trust before pick and pick applies selected workspace trust", async () => {
  const trusted = [];
  const commands = [];
  const provider = fakeProvider({
    pickSessionInteractive: () => ({
      item: { type: "session", session: { id: "session-3" } },
      permissionMode: "default",
      cwd: "/tmp/workspace",
    }),
    trustCurrentFolder: (cwd) => trusted.push(cwd),
  });

  await runProviderCli(provider, {
    cwd: "/tmp/project",
    pick: true,
    trustCurrentFolder: true,
    runCommand: (command, args, options) => commands.push({ command, args, options }),
  });

  assert.deepEqual(trusted, ["/tmp/project", "/tmp/workspace"]);
  assert.equal(commands[0].command, "provider");
  assert.deepEqual(commands[0].args, ["resume", "session-3", "default"]);
});
