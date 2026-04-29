const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  DEFAULT_CONFIG_PATH,
  buildOpenCodeCommand,
  listSessions,
  listWorkspaces,
  parseArgs,
  renderInteractivePicker,
  renderWorkspacePicker,
  selectedItemToCommand,
} = require("./opencode-sessions");
const { nextPermissionMode } = require("./session-utils");

function sqlite(dbPath, sql) {
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function createOpenCodeDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqlite(
    dbPath,
    [
      "create table project (id text primary key, worktree text not null, vcs text, name text, icon_url text, icon_color text, time_created integer not null, time_updated integer not null, time_initialized integer, sandboxes text not null);",
      "create table session (id text primary key, project_id text not null, parent_id text, slug text not null, directory text not null, title text not null, version text not null, share_url text, summary_additions integer, summary_deletions integer, summary_files integer, summary_diffs text, revert text, permission text, time_created integer not null, time_updated integer not null, time_compacting integer, time_archived integer, workspace_id text);",
      "create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null);",
      "create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null);",
    ].join(" "),
  );
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

function insertSession(dbPath, options) {
  sqlite(
    dbPath,
    [
      `insert or ignore into project (id, worktree, vcs, name, time_created, time_updated, sandboxes) values ('${options.projectId}', '${sqlString(options.cwd)}', 'git', '', ${options.startedAt}, ${options.updatedAt}, '[]');`,
      `insert into session (id, project_id, slug, directory, title, version, time_created, time_updated) values ('${options.id}', '${options.projectId}', '${options.id}', '${sqlString(options.cwd)}', '${sqlString(options.title)}', '${options.version || "1.14.28"}', ${options.startedAt}, ${options.updatedAt});`,
      `insert into message (id, session_id, time_created, time_updated, data) values ('${options.id}_msg_1', '${options.id}', ${options.startedAt + 1}, ${options.startedAt + 1}, '{"role":"user"}');`,
      `insert into part (id, message_id, session_id, time_created, time_updated, data) values ('${options.id}_part_1', '${options.id}_msg_1', '${options.id}', ${options.startedAt + 1}, ${options.startedAt + 1}, '{"type":"text","text":"${sqlString(options.firstPrompt)}"}');`,
      `insert into message (id, session_id, time_created, time_updated, data) values ('${options.id}_msg_2', '${options.id}', ${options.updatedAt}, ${options.updatedAt}, '{"role":"user"}');`,
      `insert into part (id, message_id, session_id, time_created, time_updated, data) values ('${options.id}_part_2', '${options.id}_msg_2', '${options.id}', ${options.updatedAt}, ${options.updatedAt}, '{"type":"text","text":"${sqlString(options.lastPrompt)}"}');`,
    ].join(" "),
  );
}

test("stores default OpenCode config under the OpenCode picker install directory", () => {
  assert.equal(DEFAULT_CONFIG_PATH, path.join(os.homedir(), ".opencode-code-session", "config.json"));
});

test("lists sessions for a cwd from OpenCode sqlite data", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-sessions-"));
  const dataHome = path.join(tempDir, "opencode");
  const dbPath = path.join(dataHome, "opencode.db");
  const cwd = path.join(tempDir, "demo project");

  createOpenCodeDb(dbPath);
  insertSession(dbPath, {
    id: "ses_demo_1",
    projectId: "project_demo",
    cwd,
    title: "Demo OpenCode session",
    startedAt: 1777293293359,
    updatedAt: 1777293393359,
    firstPrompt: "first prompt",
    lastPrompt: "last prompt",
  });

  const sessions = listSessions({ cwd, opencodeDataHome: dataHome });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "ses_demo_1");
  assert.equal(sessions[0].messageCount, 2);
  assert.equal(sessions[0].firstUserMessage, "first prompt");
  assert.equal(sessions[0].lastUserMessage, "last prompt");
  assert.equal(sessions[0].startedAt, "2026-04-27T12:34:53.359Z");
  assert.equal(sessions[0].updatedAt, "2026-04-27T12:36:33.359Z");
  assert.equal(sessions[0].version, "1.14.28");
});

test("lists OpenCode workspaces grouped by directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-workspaces-"));
  const dataHome = path.join(tempDir, "opencode");
  const dbPath = path.join(dataHome, "opencode.db");
  const firstCwd = path.join(tempDir, "first workspace");
  const secondCwd = path.join(tempDir, "second workspace");

  createOpenCodeDb(dbPath);
  insertSession(dbPath, {
    id: "ses_first",
    projectId: "project_first",
    cwd: firstCwd,
    title: "First workspace",
    startedAt: 1777293293359,
    updatedAt: 1777293393359,
    firstPrompt: "first workspace prompt",
    lastPrompt: "first workspace last",
  });
  insertSession(dbPath, {
    id: "ses_second",
    projectId: "project_second",
    cwd: secondCwd,
    title: "Second workspace",
    startedAt: 1777293493359,
    updatedAt: 1777293593359,
    firstPrompt: "second workspace prompt",
    lastPrompt: "second workspace last",
  });

  const workspaces = listWorkspaces({ opencodeDataHome: dataHome });

  assert.equal(workspaces.length, 2);
  assert.equal(workspaces[0].cwd, secondCwd);
  assert.equal(workspaces[0].sessionCount, 1);
  assert.equal(workspaces[0].lastUserMessage, "second workspace last");
  assert.equal(workspaces[1].cwd, firstCwd);
});

test("returns an empty list when the OpenCode sqlite database is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-missing-db-"));

  assert.deepEqual(listSessions({ cwd: tempDir, opencodeDataHome: path.join(tempDir, "missing") }), []);
  assert.deepEqual(listWorkspaces({ opencodeDataHome: path.join(tempDir, "missing") }), []);
});

test("reports sqlite3 execution failures clearly", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-missing-sqlite-"));
  const dataHome = path.join(tempDir, "opencode");
  fs.mkdirSync(dataHome, { recursive: true });
  fs.writeFileSync(path.join(dataHome, "opencode.db"), "");

  const originalPath = process.env.PATH;
  process.env.PATH = tempDir;
  try {
    assert.throws(
      () => listSessions({ cwd: tempDir, opencodeDataHome: dataHome }),
      /Failed to run sqlite3 for OpenCode sessions/,
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("builds opencode command for new session and resume choices", () => {
  const sessions = [{ id: "ses_demo_1" }];

  assert.deepEqual(buildOpenCodeCommand(sessions, "0"), { command: "opencode", args: [] });
  assert.deepEqual(buildOpenCodeCommand(sessions, ""), { command: "opencode", args: [] });
  assert.deepEqual(buildOpenCodeCommand(sessions, "1"), {
    command: "opencode",
    args: ["--session", "ses_demo_1"],
  });
  assert.deepEqual(buildOpenCodeCommand(sessions, "0", { permissionMode: "auto" }), {
    command: "opencode",
    args: [],
  });
  assert.deepEqual(buildOpenCodeCommand(sessions, "0", { permissionMode: "full" }), {
    command: "opencode",
    args: [],
    env: { OPENCODE_PERMISSION: "\"allow\"" },
  });
  assert.deepEqual(buildOpenCodeCommand(sessions, "1", { permissionMode: "full" }), {
    command: "opencode",
    args: ["--session", "ses_demo_1"],
    env: { OPENCODE_PERMISSION: "\"allow\"" },
  });
});

test("builds interactive opencode command without unsupported trust flags", () => {
  assert.deepEqual(selectedItemToCommand({ type: "new" }, { permissionMode: "full", cwd: "/tmp/project" }), {
    command: "opencode",
    args: [],
    cwd: "/tmp/project",
    env: { OPENCODE_PERMISSION: "\"allow\"" },
  });
  assert.deepEqual(
    selectedItemToCommand(
      { type: "session", session: { id: "ses_demo_1" } },
      { permissionMode: "full", cwd: "/tmp/project" },
    ),
    {
      command: "opencode",
      args: ["--session", "ses_demo_1"],
      cwd: "/tmp/project",
      env: { OPENCODE_PERMISSION: "\"allow\"" },
    },
  );
});

test("builds normal interactive opencode command without trust environment", () => {
  assert.deepEqual(selectedItemToCommand({ type: "new" }, { cwd: "/tmp/project" }), {
    command: "opencode",
    args: [],
    cwd: "/tmp/project",
  });
});

test("cycles OpenCode picker permissions without auto mode", () => {
  assert.equal(nextPermissionMode("default", ["default", "full"]), "full");
  assert.equal(nextPermissionMode("full", ["default", "full"]), "default");
});

test("renders OpenCode picker titles without changing picker behavior", () => {
  const output = renderInteractivePicker({
    sessions: [
      {
        id: "ses_demo_1",
        messageCount: 2,
        updatedAt: "2026-04-27T21:56:33.359Z",
        firstUserMessage: "first prompt",
        lastUserMessage: "last prompt",
      },
    ],
    selectedIndex: 1,
    permissionMode: "auto",
    cwd: "/tmp/demo",
    now: new Date("2026-04-27T22:56:33.359Z"),
  });

  assert.match(output, /OpenCode sessions/);
  assert.match(output, /Permission: default/);
  assert.match(output, /> 1\. ses_demo/);
});

test("renders OpenCode workspace picker title", () => {
  const output = renderWorkspacePicker({
    workspaces: [
      {
        cwd: "/tmp/demo",
        sessionCount: 1,
        updatedAt: "2026-04-27T21:56:33.359Z",
      },
    ],
    now: new Date("2026-04-27T22:56:33.359Z"),
  });

  assert.match(output, /OpenCode workspaces/);
});

test("parses OpenCode-specific data home option", () => {
  assert.deepEqual(parseArgs(["--opencode-data-home", "/tmp/opencode", "--cwd=/tmp/project"]), {
    cwd: "/tmp/project",
    opencodeDataHome: "/tmp/opencode",
    json: false,
    pick: false,
    trustCurrentFolder: false,
    help: false,
  });
});
