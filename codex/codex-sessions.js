#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  readJsonLines,
  resolveSessionChoice,
} = require("../common/session-utils");
const { pickAndRunProvider, runProviderCli } = require("../common/provider-runner");
const { normalizeTranscriptMessages } = require("../common/session-transcript");
const {
  loadModelProviders,
  selectModelProvider,
} = require("./codex-model-providers");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".agent-session", "codex.json");

function collectJsonlFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }
  return files;
}

function codexSessionFiles(codexHome) {
  return [
    ...collectJsonlFiles(path.join(codexHome, "sessions")),
    ...collectJsonlFiles(path.join(codexHome, "archived_sessions")),
  ];
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
      if (part && typeof part.message === "string") {
        return part.message;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function promptTextFromRecord(record) {
  const payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};

  if (record.type === "event_msg" && payload.type === "user_message") {
    return textFromContent(payload.message || payload.content || payload.text);
  }

  if (record.type === "response_item" && payload.type === "message" && payload.role === "user") {
    return textFromContent(payload.content);
  }

  return "";
}

function transcriptMessageFromRecord(record) {
  const payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};

  if (record.type === "event_msg" && payload.type === "user_message") {
    return {
      role: "user",
      timestamp: recordTimestamp(record),
      text: textFromContent(payload.message || payload.content || payload.text),
    };
  }

  if (record.type === "event_msg" && payload.type === "agent_message") {
    return {
      role: "assistant",
      timestamp: recordTimestamp(record),
      text: textFromContent(payload.message || payload.content || payload.text),
    };
  }

  if (record.type === "response_item" && payload.type === "message") {
    return {
      role: payload.role || "message",
      timestamp: recordTimestamp(record),
      text: textFromContent(payload.content),
    };
  }

  return null;
}

function recordTimestamp(record) {
  if (typeof record.timestamp === "string" && record.timestamp.length > 0) {
    return record.timestamp;
  }

  const payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};
  if (typeof payload.timestamp === "string" && payload.timestamp.length > 0) {
    return payload.timestamp;
  }

  return "";
}

function recordPayload(record) {
  return record && record.payload && typeof record.payload === "object" ? record.payload : {};
}

function recordSessionId(record) {
  const payload = recordPayload(record);
  return record.session_id || record.sessionId || payload.id || payload.session_id || payload.sessionId || "";
}

function recordCwd(record) {
  return record.cwd || recordPayload(record).cwd || "";
}

function recordVersion(record) {
  const payload = recordPayload(record);
  return record.version || payload.version || payload.cli_version || "";
}

function sessionIdFromFile(file) {
  const basename = path.basename(file, ".jsonl");
  const match = basename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : basename;
}

function summarizeSession(file) {
  const { records, parseErrorCount } = readJsonLines(file);
  const timestamps = records.map(recordTimestamp).filter(Boolean);
  const firstRecord = records[0] || {};
  const lastRecord = records[records.length - 1] || {};
  const firstRecordWithCwd = records.find((record) => recordCwd(record)) || {};
  const firstRecordWithVersion = records.find((record) => recordVersion(record)) || {};
  const userMessages = records.map(promptTextFromRecord).filter(Boolean);

  return {
    id: recordSessionId(firstRecord) || recordSessionId(lastRecord) || sessionIdFromFile(file),
    file,
    projectDir: path.dirname(file),
    cwd: recordCwd(firstRecordWithCwd),
    gitBranch: "",
    version: recordVersion(firstRecordWithVersion),
    messageCount: records.length,
    parseErrorCount,
    startedAt: timestamps[0] || "",
    updatedAt: timestamps[timestamps.length - 1] || "",
    firstUserMessage: userMessages[0] || "",
    lastUserMessage: userMessages[userMessages.length - 1] || "",
  };
}

function loadSessionTranscript(session) {
  if (!session || !session.file) {
    return normalizeTranscriptMessages([]);
  }

  const { records } = readJsonLines(session.file);
  return normalizeTranscriptMessages(records.map(transcriptMessageFromRecord).filter(Boolean));
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function listSessions(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());

  return codexSessionFiles(codexHome)
    .map((file) => summarizeSession(file))
    .filter((session) => session.cwd && path.resolve(session.cwd) === cwd)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
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
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const sessionsByCwd = new Map();

  for (const session of codexSessionFiles(codexHome).map((file) => summarizeSession(file))) {
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
  return renderProviderInteractivePicker({ ...options, title: "Codex sessions" });
}

function renderWorkspacePicker(options = {}) {
  return renderProviderWorkspacePicker({ ...options, title: "Codex workspaces" });
}

function renderConfigurationPicker(options = {}) {
  return renderProviderConfigurationPicker(options);
}

function formatSessions(sessions) {
  return formatProviderSessions(sessions, { providerName: "Codex" });
}

function launchArgs(permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  if (mode === "auto") {
    return ["--full-auto"];
  }
  if (mode === "full") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  return [];
}

function buildCodexCommand(sessions, choice, options = {}) {
  const baseArgs = launchArgs(options.permissionMode || options.launchMode);
  const session = resolveSessionChoice(sessions, choice);

  if (!session) {
    return { command: "codex", args: baseArgs };
  }

  return { command: "codex", args: [...baseArgs, "resume", session.id] };
}

function selectedItemToCommand(item, options = {}) {
  const baseArgs = launchArgs(options.permissionMode || options.launchMode);
  if (!item || item.type === "new") {
    return { command: "codex", args: baseArgs, cwd: options.cwd };
  }
  return { command: "codex", args: [...baseArgs, "resume", item.session.id], cwd: options.cwd };
}

function tomlBasicString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function markProjectTrusted(cwd = process.cwd(), configPath = path.join(defaultCodexHome(), "config.toml")) {
  const resolvedCwd = path.resolve(cwd);
  const sectionHeader = `[projects."${tomlBasicString(resolvedCwd)}"]`;
  let config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

  const sectionPattern = new RegExp(
    `(^|\\n)\\[projects\\."${sectionHeader
      .slice(11, -2)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\]\\n([\\s\\S]*?)(?=\\n\\[|$)`,
    "m",
  );

  if (sectionPattern.test(config)) {
    config = config.replace(sectionPattern, (match, prefix, body) => {
      const updatedBody = /(^|\n)trust_level\s*=/.test(body)
        ? body.replace(/(^|\n)trust_level\s*=.*(?=\n|$)/, '$1trust_level = "trusted"')
        : `${body.replace(/\s*$/, "\n")}trust_level = "trusted"\n`;
      return `${prefix}${sectionHeader}\n${updatedBody}`;
    });
  } else {
    if (config.length > 0 && !config.endsWith("\n")) {
      config += "\n";
    }
    config += `\n${sectionHeader}\ntrust_level = "trusted"\n`;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, config, { mode: 0o600 });
}

const pickSessionInteractive = createSessionPicker({
  configPath: DEFAULT_CONFIG_PATH,
  defaultHome: defaultCodexHome,
  homeOptionName: "codexHome",
  listSessions,
  listWorkspaces,
  filterSessions,
  renderInteractivePicker,
  renderWorkspacePicker,
  renderConfigurationPicker,
  workspaceCwd: (workspace, currentCwd) => workspace.cwd || currentCwd,
  loadSessionTranscript,
  configurationTitle: "Codex configurations",
  configurationActions: [
    {
      name: "Model provider",
      title: "Codex model providers",
      loadItems: ({ dataHome }) => loadModelProviders(dataHome).providers,
      applyItem: (item, { dataHome }) => {
        const result = selectModelProvider(item.name, dataHome);
        return {
          status: result.sameProvider
            ? `Updated model provider auth: ${item.name}`
            : `Selected model provider: ${item.name}`,
        };
      },
      emptyMessage: "No model providers.",
    },
  ],
});

const codexProvider = {
  configPath: DEFAULT_CONFIG_PATH,
  defaultHome: defaultCodexHome,
  homeOptionName: "codexHome",
  listSessions,
  pickSessionInteractive,
  selectedItemToCommand,
  buildCommandFromChoice: buildCodexCommand,
  trustCurrentFolder: (cwd, options) => {
    markProjectTrusted(cwd, path.join(options.codexHome || defaultCodexHome(), "config.toml"));
  },
  formatPicker,
  formatSessions,
  jsonPayload: ({ cwd, codexHome, sessions }) => ({
    cwd,
    codexHome,
    count: sessions.length,
    sessions,
  }),
  summaryLines: ({ cwd, codexHome, sessions }) => [
    `CWD: ${cwd}`,
    `Codex home: ${codexHome}`,
    `Sessions: ${sessions.length}`,
  ],
};

async function pickAndRunCodex(sessions, options = {}) {
  return pickAndRunProvider(codexProvider, sessions, options);
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    codexHome: defaultCodexHome(),
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
    } else if (arg === "--codex-home") {
      options.codexHome = argv[++index];
    } else if (arg.startsWith("--codex-home=")) {
      options.codexHome = arg.slice("--codex-home=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.cwd) {
    throw new Error("--cwd requires a path");
  }
  if (!options.codexHome) {
    throw new Error("--codex-home requires a path");
  }

  return options;
}

function usage() {
  return [
    "Usage: node codex/codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]",
    "",
    "获取指定目录对应的 Codex sessions。默认读取当前目录和 ~/.codex。",
    "交互模式快捷键：Tab 切换 default/auto/full permission，→ 选择 Codex 工作区；在工作区列表中 → 进入 configurations，Enter 进入选中工作区的 sessions。",
    "权限模式会自动记住，配置保存在 ~/.agent-session/codex.json。",
    "",
    "Options:",
    "  --json                 输出 JSON，方便 jq 或其他脚本处理",
    "  --pick                 交互选择 New session 或恢复某个 session",
    "  --trust-current-folder 标记当前目录为 Codex 已信任，避免重复信任确认",
    "  --cwd <path>           指定要查询的项目目录，默认是当前目录",
    "  --codex-home <path>    指定 Codex 配置目录，默认是 ~/.codex 或 CODEX_HOME",
    "  -h, --help             显示帮助",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  await runProviderCli(codexProvider, options);
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
  buildCodexCommand,
  formatSessions,
  listSessions,
  listWorkspaces,
  loadSessionTranscript,
  markProjectTrusted,
  parseArgs,
  pickAndRunCodex,
  renderInteractivePicker,
  renderConfigurationPicker,
  renderWorkspacePicker,
  summarizeSession,
};
