#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  filterSessions,
  formatPicker,
  formatSessions: formatClaudeSessions,
  loadPermissionMode,
} = require("./claude-sessions");
const {
  askQuestion,
  createSessionPicker,
  normalizePermissionMode,
  runCommand,
} = require("./session-utils");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".opencode-code-session", "config.json");

function defaultOpenCodeDataHome() {
  return process.env.OPENCODE_DATA_HOME || path.join(os.homedir(), ".local", "share", "opencode");
}

function openCodeDbPath(opencodeDataHome) {
  return path.join(opencodeDataHome, "opencode.db");
}

function timestampFromMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return "";
  }
  return new Date(number).toISOString();
}

function sessionRows(dbPath) {
  const sql = `
with user_parts as (
  select
    p.session_id,
    json_extract(p.data, '$.text') as text,
    p.time_created,
    row_number() over (partition by p.session_id order by p.time_created asc, p.id asc) as first_rank,
    row_number() over (partition by p.session_id order by p.time_created desc, p.id desc) as last_rank
  from part p
  join message m on m.id = p.message_id
  where json_extract(m.data, '$.role') = 'user'
    and json_extract(p.data, '$.type') = 'text'
    and json_extract(p.data, '$.text') is not null
),
message_counts as (
  select session_id, count(*) as message_count
  from message
  group by session_id
)
select
  s.id,
  s.directory as cwd,
  s.title,
  s.version,
  s.project_id as projectDir,
  s.time_created as startedMs,
  s.time_updated as updatedMs,
  coalesce(mc.message_count, 0) as messageCount,
  coalesce(first_parts.text, '') as firstUserMessage,
  coalesce(last_parts.text, '') as lastUserMessage
from session s
left join message_counts mc on mc.session_id = s.id
left join user_parts first_parts on first_parts.session_id = s.id and first_parts.first_rank = 1
left join user_parts last_parts on last_parts.session_id = s.id and last_parts.last_rank = 1
order by s.time_updated desc, s.id desc;`;

  const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run sqlite3 for OpenCode sessions: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || "").trim() || "Failed to read OpenCode sqlite database");
  }

  const output = result.stdout.trim();
  return output ? JSON.parse(output) : [];
}

function summarizeSession(row, dbPath) {
  return {
    id: row.id,
    file: dbPath,
    projectDir: row.projectDir || "",
    cwd: row.cwd || "",
    gitBranch: "",
    version: row.version || "",
    messageCount: Number(row.messageCount) || 0,
    parseErrorCount: 0,
    startedAt: timestampFromMs(row.startedMs),
    updatedAt: timestampFromMs(row.updatedMs),
    firstUserMessage: row.firstUserMessage || row.title || "",
    lastUserMessage: row.lastUserMessage || row.firstUserMessage || row.title || "",
  };
}

function listSessions(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const opencodeDataHome = path.resolve(options.opencodeDataHome || defaultOpenCodeDataHome());
  const dbPath = openCodeDbPath(opencodeDataHome);

  if (!fs.existsSync(dbPath)) {
    return [];
  }

  return sessionRows(dbPath)
    .map((row) => summarizeSession(row, dbPath))
    .filter((session) => session.cwd && path.resolve(session.cwd) === cwd);
}

function summarizeWorkspace(cwd, sessions) {
  const sortedSessions = sessions.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const newestSession = sortedSessions[0];
  const firstSession = sortedSessions[sortedSessions.length - 1];

  return {
    cwd,
    projectDir: newestSession.projectDir,
    sessionCount: sortedSessions.length,
    messageCount: sortedSessions.reduce((total, session) => total + session.messageCount, 0),
    startedAt: firstSession.startedAt || "",
    updatedAt: newestSession.updatedAt || "",
    firstUserMessage: firstSession.firstUserMessage || "",
    lastUserMessage: newestSession.lastUserMessage || newestSession.firstUserMessage || "",
  };
}

function listWorkspaces(options = {}) {
  const opencodeDataHome = path.resolve(options.opencodeDataHome || defaultOpenCodeDataHome());
  const dbPath = openCodeDbPath(opencodeDataHome);

  if (!fs.existsSync(dbPath)) {
    return [];
  }

  const sessionsByCwd = new Map();
  for (const session of sessionRows(dbPath).map((row) => summarizeSession(row, dbPath))) {
    if (!session.cwd) {
      continue;
    }
    const cwd = path.resolve(session.cwd);
    if (!sessionsByCwd.has(cwd)) {
      sessionsByCwd.set(cwd, []);
    }
    sessionsByCwd.get(cwd).push(session);
  }

  return [...sessionsByCwd.entries()]
    .map(([cwd, sessions]) => summarizeWorkspace(cwd, sessions))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function renderInteractivePicker(options = {}) {
  return require("./claude-sessions")
    .renderInteractivePicker({
      ...options,
      permissionMode: normalizePermissionMode(
        options.permissionMode || options.launchMode,
        OPENCODE_PERMISSION_MODES,
      ),
    })
    .replace(/^Claude Code sessions/m, "OpenCode sessions");
}

function renderWorkspacePicker(options = {}) {
  return require("./claude-sessions")
    .renderWorkspacePicker(options)
    .replace(/^Claude Code workspaces/m, "OpenCode workspaces");
}

function formatSessions(sessions) {
  return formatClaudeSessions(sessions).replace("Claude Code session", "OpenCode session");
}

const OPENCODE_PERMISSION_MODES = ["default", "full"];

function launchArgs(permissionMode) {
  return [];
}

function launchEnv(permissionMode) {
  return normalizePermissionMode(permissionMode, OPENCODE_PERMISSION_MODES) === "full"
    ? { OPENCODE_PERMISSION: "\"allow\"" }
    : undefined;
}

function buildOpenCodeCommand(sessions, choice, options = {}) {
  const normalized = String(choice || "").trim();
  const permissionMode = options.permissionMode || options.launchMode;
  const baseArgs = launchArgs(permissionMode);
  const env = launchEnv(permissionMode);

  if (normalized === "" || normalized === "1") {
    return { command: "opencode", args: baseArgs, ...(env ? { env } : {}) };
  }

  const selectedNumber = Number.parseInt(normalized, 10);
  if (!Number.isInteger(selectedNumber) || String(selectedNumber) !== normalized) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  const session = sessions[selectedNumber - 2];
  if (!session) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  return { command: "opencode", args: [...baseArgs, "--session", session.id], ...(env ? { env } : {}) };
}

function selectedItemToCommand(item, options = {}) {
  const permissionMode = options.permissionMode || options.launchMode;
  const baseArgs = launchArgs(permissionMode);
  const env = launchEnv(permissionMode);
  if (!item || item.type === "new") {
    return { command: "opencode", args: baseArgs, cwd: options.cwd, ...(env ? { env } : {}) };
  }
  return { command: "opencode", args: [...baseArgs, "--session", item.session.id], cwd: options.cwd, ...(env ? { env } : {}) };
}

const pickSessionInteractive = createSessionPicker({
  configPath: DEFAULT_CONFIG_PATH,
  defaultHome: defaultOpenCodeDataHome,
  homeOptionName: "opencodeDataHome",
  listSessions,
  listWorkspaces,
  filterSessions,
  renderInteractivePicker,
  renderWorkspacePicker,
  workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
  permissionModes: OPENCODE_PERMISSION_MODES,
});

async function pickAndRunOpenCode(sessions, options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const permissionMode = normalizePermissionMode(
    options.permissionMode || options.launchMode || loadPermissionMode(configPath, OPENCODE_PERMISSION_MODES),
    OPENCODE_PERMISSION_MODES,
  );
  const picked = await pickSessionInteractive(sessions, options);
  if (picked) {
    const { command, args, cwd, env } = selectedItemToCommand(picked.item, {
      permissionMode: picked.permissionMode,
      cwd: picked.cwd,
    });
    runCommand(command, args, { cwd, env });
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.exitCode = 130;
    return;
  }

  console.log(formatPicker(sessions));
  console.log("");

  const answer = await askQuestion("选择 session 编号，直接回车创建 New session: ");
  const { command, args, env } = buildOpenCodeCommand(sessions, answer, { ...options, permissionMode });
  runCommand(command, args, { cwd: options.cwd, env });
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    opencodeDataHome: defaultOpenCodeDataHome(),
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
    } else if (arg === "--opencode-data-home") {
      options.opencodeDataHome = argv[++index];
    } else if (arg.startsWith("--opencode-data-home=")) {
      options.opencodeDataHome = arg.slice("--opencode-data-home=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.cwd) {
    throw new Error("--cwd requires a path");
  }
  if (!options.opencodeDataHome) {
    throw new Error("--opencode-data-home requires a path");
  }

  return options;
}

function usage() {
  return [
    "Usage: node opencode-sessions.js [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]",
    "",
    "获取指定目录对应的 OpenCode sessions。默认读取当前目录和 ~/.local/share/opencode。",
    "交互模式快捷键：Tab 切换 default/full permission，→ 选择 OpenCode 工作区，← 返回 session 列表。",
    "权限模式会自动记住，配置保存在 ~/.opencode-code-session/config.json。",
    "",
    "Options:",
    "  --json                       输出 JSON，方便 jq 或其他脚本处理",
    "  --pick                       交互选择 New session 或恢复某个 session",
    "  --trust-current-folder       兼容安装别名；OpenCode full permission 通过 OPENCODE_PERMISSION 控制权限",
    "  --cwd <path>                 指定要查询的项目目录，默认是当前目录",
    "  --opencode-data-home <path>  指定 OpenCode 数据目录，默认是 ~/.local/share/opencode 或 OPENCODE_DATA_HOME",
    "  -h, --help                   显示帮助",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  const cwd = path.resolve(options.cwd);
  const opencodeDataHome = path.resolve(options.opencodeDataHome);
  const sessions = listSessions({ cwd, opencodeDataHome });

  if (options.pick) {
    await pickAndRunOpenCode(sessions, {
      cwd,
      opencodeDataHome,
      trustCurrentFolder: options.trustCurrentFolder,
    });
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          cwd,
          opencodeDataHome,
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
  console.log(`OpenCode data home: ${opencodeDataHome}`);
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
  buildOpenCodeCommand,
  formatSessions,
  listSessions,
  listWorkspaces,
  parseArgs,
  pickAndRunOpenCode,
  renderInteractivePicker,
  renderWorkspacePicker,
  selectedItemToCommand,
};
