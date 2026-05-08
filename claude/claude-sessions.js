#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createSessionPicker,
  filterWorkspaces,
  loadPermissionMode: loadPermissionModeFromConfig,
  normalizePermissionMode,
  readJsonLines,
  resolveSessionChoice,
  savePermissionMode: savePermissionModeToConfig,
} = require("../common/session-utils");
const { pickAndRunProvider, runProviderCli } = require("../common/provider-runner");
const { normalizeTranscriptMessages } = require("../common/session-transcript");
const {
  displayWidth,
  filterSessions,
  formatPicker,
  formatSessionTime,
  formatSessions: formatProviderSessions,
  renderInteractivePicker: renderProviderInteractivePicker,
  renderWorkspacePicker: renderProviderWorkspacePicker,
  truncateToWidth,
} = require("../common/session-renderer");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".agent-session", "claude-code.json");

function encodeProjectPath(cwd) {
  return path.resolve(cwd).replace(/[^A-Za-z0-9._-]/g, "-");
}

function defaultClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

function loadPermissionMode(configPath = DEFAULT_CONFIG_PATH, permissionModes) {
  return loadPermissionModeFromConfig(configPath, permissionModes);
}

function savePermissionMode(permissionMode, configPath = DEFAULT_CONFIG_PATH, permissionModes) {
  savePermissionModeToConfig(permissionMode, configPath, permissionModes);
}

function loadLaunchMode(configPath = DEFAULT_CONFIG_PATH) {
  return loadPermissionMode(configPath);
}

function saveLaunchMode(launchMode, configPath = DEFAULT_CONFIG_PATH) {
  savePermissionMode(launchMode, configPath);
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
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function promptTextFromRecord(record) {
  if (record.type === "last-prompt" && typeof record.lastPrompt === "string") {
    return record.lastPrompt;
  }

  if (record.type !== "user" || record.isMeta || !record.message || record.message.role !== "user") {
    return "";
  }

  const content = record.message.content;
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
      if (part && part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function transcriptMessageFromRecord(record) {
  const message = record && record.message && typeof record.message === "object" ? record.message : {};
  const role = message.role || (record.type === "user" || record.type === "assistant" ? record.type : "");
  if (!role) {
    return null;
  }

  const text = textFromContent(message.content);
  if (!text) {
    return null;
  }

  return {
    role,
    timestamp: record.timestamp || "",
    text,
  };
}

function loadSessionTranscript(session) {
  if (!session || !session.file) {
    return normalizeTranscriptMessages([]);
  }

  const { records } = readJsonLines(session.file);
  return normalizeTranscriptMessages(records.map(transcriptMessageFromRecord).filter(Boolean));
}

function summarizeSession(file, projectDir) {
  const { records, parseErrorCount } = readJsonLines(file);
  const timestamps = records
    .map((record) => record.timestamp)
    .filter((timestamp) => typeof timestamp === "string" && timestamp.length > 0);
  const firstRecord = records[0] || {};
  const lastRecord = records[records.length - 1] || {};
  const userMessages = records.map(promptTextFromRecord).filter(Boolean);
  const idFromFile = path.basename(file, ".jsonl");

  return {
    id: firstRecord.sessionId || lastRecord.sessionId || idFromFile,
    file,
    projectDir,
    cwd: firstRecord.cwd || lastRecord.cwd || "",
    gitBranch: firstRecord.gitBranch || lastRecord.gitBranch || "",
    version: firstRecord.version || lastRecord.version || "",
    messageCount: records.length,
    parseErrorCount,
    startedAt: timestamps[0] || "",
    updatedAt: timestamps[timestamps.length - 1] || "",
    firstUserMessage: userMessages[0] || "",
    lastUserMessage: userMessages[userMessages.length - 1] || "",
  };
}

function listSessions(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const claudeHome = path.resolve(options.claudeHome || defaultClaudeHome());
  const projectDir = path.join(claudeHome, "projects", encodeProjectPath(cwd));

  if (!fs.existsSync(projectDir)) {
    return [];
  }

  return fs
    .readdirSync(projectDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => summarizeSession(path.join(projectDir, name), projectDir))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function listProjectSessions(projectDir) {
  if (!fs.existsSync(projectDir)) {
    return [];
  }

  return fs
    .readdirSync(projectDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => summarizeSession(path.join(projectDir, name), projectDir))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function summarizeWorkspace(projectDir) {
  const sessions = listProjectSessions(projectDir);
  if (sessions.length === 0) {
    return null;
  }

  const newestSession = sessions[0];
  const firstSession = sessions[sessions.length - 1];
  const cwd = newestSession.cwd || sessions.find((session) => session.cwd)?.cwd || projectDir;

  return {
    cwd,
    projectDir,
    sessionCount: sessions.length,
    messageCount: sessions.reduce((total, session) => total + session.messageCount, 0),
    startedAt: firstSession.startedAt || "",
    updatedAt: newestSession.updatedAt || "",
    firstUserMessage: firstSession.firstUserMessage || "",
    lastUserMessage: newestSession.lastUserMessage || newestSession.firstUserMessage || "",
  };
}

function listWorkspaces(options = {}) {
  const claudeHome = path.resolve(options.claudeHome || defaultClaudeHome());
  const projectsDir = path.join(claudeHome, "projects");

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  return fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => summarizeWorkspace(path.join(projectsDir, entry.name)))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function formatSessions(sessions) {
  return formatProviderSessions(sessions, { providerName: "Claude Code" });
}

function renderInteractivePicker(options) {
  return renderProviderInteractivePicker({ ...options, title: "Claude Code sessions" });
}

function renderWorkspacePicker(options) {
  return renderProviderWorkspacePicker({ ...options, title: "Claude Code workspaces" });
}

function launchArgs(permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  if (mode === "auto") {
    return ["--enable-auto-mode"];
  }
  if (mode === "full") {
    return ["--dangerously-skip-permissions"];
  }
  return [];
}

function buildClaudeCommand(sessions, choice, options = {}) {
  const baseArgs = launchArgs(options.permissionMode || options.launchMode);
  const session = resolveSessionChoice(sessions, choice);

  if (!session) {
    return { command: "claude", args: baseArgs };
  }

  return { command: "claude", args: [...baseArgs, "--resume", session.id] };
}

function selectedItemToCommand(item, options = {}) {
  const baseArgs = launchArgs(options.permissionMode || options.launchMode);
  if (!item || item.type === "new") {
    return { command: "claude", args: baseArgs, cwd: options.cwd };
  }
  return { command: "claude", args: [...baseArgs, "--resume", item.session.id], cwd: options.cwd };
}

function markProjectTrusted(cwd = process.cwd(), configPath = path.join(os.homedir(), ".claude.json")) {
  const resolvedCwd = path.resolve(cwd);
  let config = {};

  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    config = {};
  }
  if (!config.projects || typeof config.projects !== "object" || Array.isArray(config.projects)) {
    config.projects = {};
  }
  if (!config.projects[resolvedCwd] || typeof config.projects[resolvedCwd] !== "object") {
    config.projects[resolvedCwd] = {};
  }

  config.projects[resolvedCwd].hasTrustDialogAccepted = true;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

const pickSessionInteractive = createSessionPicker({
  configPath: DEFAULT_CONFIG_PATH,
  defaultHome: defaultClaudeHome,
  homeOptionName: "claudeHome",
  listSessions,
  listWorkspaces,
  filterSessions,
  renderInteractivePicker,
  renderWorkspacePicker,
  workspaceCwd: (workspace, currentCwd) => workspace.cwd || workspace.projectDir || currentCwd,
  loadSessionTranscript,
});

const claudeProvider = {
  configPath: DEFAULT_CONFIG_PATH,
  defaultHome: defaultClaudeHome,
  homeOptionName: "claudeHome",
  listSessions,
  pickSessionInteractive,
  selectedItemToCommand,
  buildCommandFromChoice: buildClaudeCommand,
  trustCurrentFolder: (cwd) => markProjectTrusted(cwd),
  formatPicker,
  formatSessions,
  jsonPayload: ({ cwd, claudeHome, sessions }) => ({
    cwd,
    claudeHome,
    projectDir: path.join(claudeHome, "projects", encodeProjectPath(cwd)),
    count: sessions.length,
    sessions,
  }),
  summaryLines: ({ cwd, claudeHome, sessions }) => [
    `CWD: ${cwd}`,
    `Claude project dir: ${path.join(claudeHome, "projects", encodeProjectPath(cwd))}`,
    `Sessions: ${sessions.length}`,
  ],
};

async function pickAndRunClaude(sessions, options = {}) {
  return pickAndRunProvider(claudeProvider, sessions, options);
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    claudeHome: process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"),
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
    } else if (arg === "--claude-home") {
      options.claudeHome = argv[++index];
    } else if (arg.startsWith("--claude-home=")) {
      options.claudeHome = arg.slice("--claude-home=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.cwd) {
    throw new Error("--cwd requires a path");
  }
  if (!options.claudeHome) {
    throw new Error("--claude-home requires a path");
  }

  return options;
}

function usage() {
  return [
    "Usage: node claude/claude-sessions.js [--json | --pick] [--cwd <path>] [--claude-home <path>]",
    "",
    "获取指定目录对应的 Claude Code sessions。默认读取当前目录和 ~/.claude。",
    "交互模式快捷键：Tab 切换 default/auto/full permission，→ 选择 Claude Code 工作区，← 返回 session 列表。",
    "权限模式会自动记住，配置保存在 ~/.agent-session/claude-code.json。",
    "",
    "Options:",
    "  --json                 输出 JSON，方便 jq 或其他脚本处理",
    "  --pick                 交互选择 New session 或恢复某个 session",
    "  --trust-current-folder 标记当前目录为 Claude Code 已信任，避免重复信任确认",
    "  --cwd <path>           指定要查询的项目目录，默认是当前目录",
    "  --claude-home <path>   指定 Claude 配置目录，默认是 ~/.claude 或 CLAUDE_HOME",
    "  -h, --help             显示帮助",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  await runProviderCli(claudeProvider, options);
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
  buildClaudeCommand,
  displayWidth,
  encodeProjectPath,
  filterSessions,
  formatPicker,
  formatSessionTime,
  formatSessions,
  filterWorkspaces,
  loadLaunchMode,
  loadPermissionMode,
  listSessions,
  listWorkspaces,
  loadSessionTranscript,
  markProjectTrusted,
  parseArgs,
  promptTextFromRecord,
  pickAndRunClaude,
  renderInteractivePicker,
  renderWorkspacePicker,
  saveLaunchMode,
  savePermissionMode,
  summarizeSession,
  truncateToWidth,
};
