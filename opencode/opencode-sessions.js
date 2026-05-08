#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  filterSessions,
  formatPicker,
  formatSessions: formatProviderSessions,
  renderConfigurationPicker: renderProviderConfigurationPicker,
  renderInteractivePicker: renderProviderInteractivePicker,
  renderWorkspacePicker: renderProviderWorkspacePicker,
} = require("../common/session-renderer");
const {
  createSessionPicker,
  normalizePermissionMode,
  resolveSessionChoice,
} = require("../common/session-utils");
const { pickAndRunProvider, runProviderCli } = require("../common/provider-runner");
const { normalizeTranscriptMessages } = require("../common/session-transcript");
const {
  loadAiSdkProviders,
  loadConfiguredModelChoices,
  loadConfiguredModelValue,
  loadOpenCodePermissionMode,
  loadProviderModels,
  saveConfiguredModel,
  saveOpenCodePermissionMode,
  saveProviderModels,
} = require("./opencode-provider-models");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".agent-session", "opencode.json");

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

function sqlString(value) {
  return String(value).replace(/'/g, "''");
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

function loadSessionTranscript(session) {
  if (!session || !session.file || !session.id) {
    return normalizeTranscriptMessages([]);
  }

  const sql = `
select
  json_extract(m.data, '$.role') as role,
  json_extract(p.data, '$.text') as text,
  p.time_created as createdMs
from part p
join message m on m.id = p.message_id
where p.session_id = '${sqlString(session.id)}'
  and json_extract(p.data, '$.type') = 'text'
  and json_extract(p.data, '$.text') is not null
order by p.time_created asc, p.id asc;`;
  const result = spawnSync("sqlite3", ["-json", session.file, sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run sqlite3 for OpenCode transcript: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || "").trim() || "Failed to read OpenCode transcript");
  }

  const rows = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
  return normalizeTranscriptMessages(
    rows.map((row) => ({
      role: row.role || "message",
      timestamp: timestampFromMs(row.createdMs),
      text: row.text || "",
    })),
  );
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
  return renderProviderInteractivePicker({
    ...options,
    title: "OpenCode sessions",
    permissionMode: normalizePermissionMode(
      options.permissionMode || options.launchMode,
      OPENCODE_PERMISSION_MODES,
    ),
    permissionModes: OPENCODE_PERMISSION_MODES,
  });
}

function renderWorkspacePicker(options = {}) {
  return renderProviderWorkspacePicker({ ...options, title: "OpenCode workspaces" });
}

function renderConfigurationPicker(options = {}) {
  return renderProviderConfigurationPicker(options);
}

function currentOpenCodeModelColumn(fieldName) {
  try {
    return [loadConfiguredModelValue(fieldName)];
  } catch {
    return [""];
  }
}

function loadNativePermissionMode(options = {}, permissionModes) {
  return normalizePermissionMode(loadOpenCodePermissionMode(options.opencodeConfigPath), permissionModes);
}

function saveNativePermissionMode(permissionMode, options = {}, permissionModes) {
  saveOpenCodePermissionMode(
    normalizePermissionMode(permissionMode, permissionModes),
    options.opencodeConfigPath,
  );
}

function formatSessions(sessions) {
  return formatProviderSessions(sessions, { providerName: "OpenCode" });
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
  const permissionMode = options.permissionMode || options.launchMode;
  const baseArgs = launchArgs(permissionMode);
  const env = launchEnv(permissionMode);
  const session = resolveSessionChoice(sessions, choice);

  if (!session) {
    return { command: "opencode", args: baseArgs, ...(env ? { env } : {}) };
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
  renderConfigurationPicker,
  workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
  permissionModes: OPENCODE_PERMISSION_MODES,
  loadSessionTranscript,
  loadPermissionMode: (context, permissionModes) => loadNativePermissionMode({}, permissionModes),
  savePermissionMode: (permissionMode, context, permissionModes) => saveNativePermissionMode(permissionMode, {}, permissionModes),
  configurationTitle: "OpenCode configurations",
  configurationActions: [
    {
      name: "Provider models",
      title: "OpenCode providers",
      mode: "multiselect",
      loadItems: () => loadAiSdkProviders(),
      loadSubitems: (item) => loadProviderModels(item.name),
      subitemsTitle: (item) => `OpenCode models: ${item.name}`,
      applySubitems: (item, selectedItems) => {
        const result = saveProviderModels(item.name, selectedItems.map((model) => model.name));
        return { status: `Updated models for ${item.name}: ${result.selectedCount} selected` };
      },
      emptyMessage: "No @ai-sdk providers.",
      emptySubitemsMessage: "No models.",
    },
    {
      name: "Default model",
      title: "OpenCode default model",
      columns: () => currentOpenCodeModelColumn("model"),
      loadItems: () => loadConfiguredModelChoices("model"),
      applyItem: (item) => {
        const result = saveConfiguredModel("model", item.name);
        return { status: `Updated default model: ${result.value}` };
      },
      emptyMessage: "No configured models.",
    },
    {
      name: "Small model",
      title: "OpenCode small model",
      columns: () => currentOpenCodeModelColumn("small_model"),
      loadItems: () => loadConfiguredModelChoices("small_model"),
      applyItem: (item) => {
        const result = saveConfiguredModel("small_model", item.name);
        return { status: `Updated small model: ${result.value}` };
      },
      emptyMessage: "No configured models.",
    },
  ],
});

const openCodeProvider = {
  configPath: DEFAULT_CONFIG_PATH,
  defaultHome: defaultOpenCodeDataHome,
  homeOptionName: "opencodeDataHome",
  permissionModes: OPENCODE_PERMISSION_MODES,
  listSessions,
  pickSessionInteractive,
  loadPermissionMode: loadNativePermissionMode,
  selectedItemToCommand,
  buildCommandFromChoice: buildOpenCodeCommand,
  formatPicker,
  formatSessions,
  jsonPayload: ({ cwd, opencodeDataHome, sessions }) => ({
    cwd,
    opencodeDataHome,
    count: sessions.length,
    sessions,
  }),
  summaryLines: ({ cwd, opencodeDataHome, sessions }) => [
    `CWD: ${cwd}`,
    `OpenCode data home: ${opencodeDataHome}`,
    `Sessions: ${sessions.length}`,
  ],
};

async function pickAndRunOpenCode(sessions, options = {}) {
  return pickAndRunProvider(openCodeProvider, sessions, options);
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
    "Usage: node opencode/opencode-sessions.js [--json | --pick] [--cwd <path>] [--opencode-data-home <path>]",
    "",
    "获取指定目录对应的 OpenCode sessions。默认读取当前目录和 ~/.local/share/opencode。",
    "交互模式快捷键：Tab 切换 default/full permission，→ 选择 OpenCode 工作区；在工作区列表中 → 进入 configurations。",
    "权限模式会自动记住，配置保存在 ~/.config/opencode/opencode.json 的 permission_mode_selected。",
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

  await runProviderCli(openCodeProvider, options);
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
  loadSessionTranscript,
  parseArgs,
  pickAndRunOpenCode,
  renderInteractivePicker,
  renderConfigurationPicker,
  renderWorkspacePicker,
  selectedItemToCommand,
};
