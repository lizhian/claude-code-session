#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const {
  filterSessions,
  formatPicker,
  formatSessions: formatClaudeSessions,
  loadLaunchMode,
  saveLaunchMode,
} = require("./claude-sessions");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".codex-code-session", "config.json");
const VALID_LAUNCH_MODES = new Set(["normal", "trust"]);

function normalizeLaunchMode(launchMode) {
  return VALID_LAUNCH_MODES.has(launchMode) ? launchMode : "normal";
}

function readJsonLines(file) {
  const raw = fs.readFileSync(file, "utf8");
  const records = [];
  let parseErrorCount = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      records.push(JSON.parse(line));
    } catch {
      parseErrorCount += 1;
    }
  }

  return { records, parseErrorCount };
}

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
  return require("./claude-sessions")
    .renderInteractivePicker(options)
    .replace(/^Claude Code sessions/m, "Codex sessions")
    .replace(/→ workspaces/g, "→ workspaces");
}

function renderWorkspacePicker(options = {}) {
  return require("./claude-sessions")
    .renderWorkspacePicker(options)
    .replace(/^Claude Code workspaces/m, "Codex workspaces");
}

function formatSessions(sessions) {
  return formatClaudeSessions(sessions).replace("Claude Code session", "Codex session");
}

function toggleLaunchMode(launchMode) {
  return launchMode === "trust" ? "normal" : "trust";
}

function launchArgs(launchMode) {
  return launchMode === "trust" ? ["--dangerously-bypass-approvals-and-sandbox"] : [];
}

function buildCodexCommand(sessions, choice, options = {}) {
  const normalized = String(choice || "").trim();
  const baseArgs = launchArgs(options.launchMode);

  if (normalized === "" || normalized === "1") {
    return { command: "codex", args: baseArgs };
  }

  const selectedNumber = Number.parseInt(normalized, 10);
  if (!Number.isInteger(selectedNumber) || String(selectedNumber) !== normalized) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  const session = sessions[selectedNumber - 2];
  if (!session) {
    throw new Error(`Invalid choice: ${choice}`);
  }

  return { command: "codex", args: [...baseArgs, "resume", session.id] };
}

function selectedItemToCommand(item, options = {}) {
  const baseArgs = launchArgs(options.launchMode);
  if (!item || item.type === "new") {
    return { command: "codex", args: baseArgs, cwd: options.cwd };
  }
  return { command: "codex", args: [...baseArgs, "resume", item.session.id], cwd: options.cwd };
}

function pickerItems(sessions, query) {
  return [
    { type: "new", label: "New session" },
    ...filterSessions(sessions, query).map((session) => ({ type: "session", session })),
  ];
}

function workspaceSearchText(workspace) {
  return [
    workspace.cwd,
    workspace.projectDir,
    workspace.updatedAt,
    workspace.startedAt,
    workspace.firstUserMessage,
    workspace.lastUserMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterWorkspaces(workspaces, query) {
  const terms = String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return workspaces;
  }

  return workspaces.filter((workspace) => {
    const searchText = workspaceSearchText(workspace);
    return terms.every((term) => searchText.includes(term));
  });
}

function workspaceItems(workspaces, query) {
  return filterWorkspaces(workspaces, query).map((workspace) => ({ type: "workspace", workspace }));
}

function clampSelectedIndex(selectedIndex, itemCount) {
  if (itemCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, selectedIndex), itemCount - 1);
}

function askQuestion(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    cwd: options.cwd || process.cwd(),
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code || 0;
  });
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

function pickSessionInteractive(initialSessions, io = {}) {
  const input = io.input || process.stdin;
  const output = io.output || process.stdout;
  const codexHome = path.resolve(io.codexHome || defaultCodexHome());
  const configPath = io.configPath || DEFAULT_CONFIG_PATH;

  if (!input.isTTY || !output.isTTY) {
    return null;
  }

  let currentCwd = path.resolve(io.cwd || process.cwd());
  let sessions = initialSessions || listSessions({ cwd: currentCwd, codexHome });
  let workspaces = null;
  let view = "sessions";
  let launchMode = normalizeLaunchMode(io.launchMode || loadLaunchMode(configPath));
  let sessionQuery = "";
  let workspaceQuery = "";
  let sessionSelectedIndex = 0;
  let workspaceSelectedIndex = 0;
  let previousQueryHadText = false;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  output.write("\x1b[?25l");

  return new Promise((resolve) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
      output.write("\x1b[2J\x1b[H");
    }

    function currentSessionItems() {
      return pickerItems(sessions, sessionQuery);
    }

    function currentWorkspaceItems() {
      if (!workspaces) {
        workspaces = listWorkspaces({ codexHome });
      }
      return workspaceItems(workspaces, workspaceQuery);
    }

    function render() {
      output.write("\x1b[2J\x1b[H");

      if (view === "workspaces") {
        const itemCount = currentWorkspaceItems().length;
        workspaceSelectedIndex = clampSelectedIndex(workspaceSelectedIndex, itemCount);
        output.write(
          renderWorkspacePicker({
            workspaces: workspaces || [],
            query: workspaceQuery,
            selectedIndex: workspaceSelectedIndex,
            rows: output.rows || 24,
            columns: output.columns || 100,
          }),
        );
        return;
      }

      const itemCount = currentSessionItems().length;
      sessionSelectedIndex = clampSelectedIndex(sessionSelectedIndex, itemCount);
      output.write(
        renderInteractivePicker({
          sessions,
          query: sessionQuery,
          selectedIndex: sessionSelectedIndex,
          launchMode,
          cwd: currentCwd,
          rows: output.rows || 24,
          columns: output.columns || 100,
        }),
      );
    }

    function onKeypress(str, key = {}) {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (view === "workspaces") {
          const items = currentWorkspaceItems();
          const item = items[clampSelectedIndex(workspaceSelectedIndex, items.length)];
          if (item && item.workspace) {
            currentCwd = path.resolve(item.workspace.cwd || currentCwd);
            sessions = listSessions({ cwd: currentCwd, codexHome });
            view = "sessions";
            sessionQuery = "";
            sessionSelectedIndex = 0;
            previousQueryHadText = false;
            render();
          }
          return;
        }

        const items = currentSessionItems();
        const item = items[clampSelectedIndex(sessionSelectedIndex, items.length)];
        cleanup();
        resolve({
          item: item || { type: "new", label: "New session" },
          launchMode,
          cwd: currentCwd,
        });
        return;
      }

      if (key.name === "tab") {
        launchMode = toggleLaunchMode(launchMode);
        saveLaunchMode(launchMode, configPath);
        render();
        return;
      }

      if (key.name === "right" && view === "sessions") {
        if (!workspaces) {
          workspaces = listWorkspaces({ codexHome });
        }
        view = "workspaces";
        workspaceSelectedIndex = 0;
        previousQueryHadText = Boolean(workspaceQuery);
        render();
        return;
      }

      if (key.name === "left" && view === "workspaces") {
        view = "sessions";
        previousQueryHadText = Boolean(sessionQuery);
        render();
        return;
      }

      if (key.name === "up") {
        if (view === "workspaces") {
          workspaceSelectedIndex = Math.max(0, workspaceSelectedIndex - 1);
        } else {
          sessionSelectedIndex = Math.max(0, sessionSelectedIndex - 1);
        }
        render();
        return;
      }

      if (key.name === "down") {
        if (view === "workspaces") {
          workspaceSelectedIndex = Math.min(
            Math.max(0, currentWorkspaceItems().length - 1),
            workspaceSelectedIndex + 1,
          );
        } else {
          sessionSelectedIndex = Math.min(
            Math.max(0, currentSessionItems().length - 1),
            sessionSelectedIndex + 1,
          );
        }
        render();
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        if (view === "workspaces") {
          workspaceQuery = workspaceQuery.slice(0, -1);
        } else {
          sessionQuery = sessionQuery.slice(0, -1);
        }
        const query = view === "workspaces" ? workspaceQuery : sessionQuery;
        if (!query) {
          previousQueryHadText = false;
          if (view === "workspaces") {
            workspaceSelectedIndex = 0;
          } else {
            sessionSelectedIndex = 0;
          }
        }
        render();
        return;
      }

      if (str && str >= " " && !key.ctrl && !key.meta) {
        if (view === "workspaces") {
          workspaceQuery += str;
          if (!previousQueryHadText && filterWorkspaces(workspaces || [], workspaceQuery).length > 0) {
            workspaceSelectedIndex = 0;
          }
        } else {
          sessionQuery += str;
          if (!previousQueryHadText && filterSessions(sessions, sessionQuery).length > 0) {
            sessionSelectedIndex = 1;
          }
        }
        previousQueryHadText = true;
        render();
      }
    }

    input.on("keypress", onKeypress);
    render();
  });
}

async function pickAndRunCodex(sessions, options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const launchMode = normalizeLaunchMode(options.launchMode || loadLaunchMode(configPath));
  const picked = await pickSessionInteractive(sessions, options);
  if (picked) {
    if (options.trustCurrentFolder) {
      markProjectTrusted(picked.cwd, path.join(options.codexHome || defaultCodexHome(), "config.toml"));
    }
    const { command, args, cwd } = selectedItemToCommand(picked.item, {
      launchMode: picked.launchMode,
      cwd: picked.cwd,
    });
    runCommand(command, args, { cwd });
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.exitCode = 130;
    return;
  }

  console.log(formatPicker(sessions));
  console.log("");

  const answer = await askQuestion("选择 session 编号，直接回车创建 New session: ");
  if (options.trustCurrentFolder) {
    markProjectTrusted(options.cwd, path.join(options.codexHome || defaultCodexHome(), "config.toml"));
  }
  const { command, args } = buildCodexCommand(sessions, answer, { ...options, launchMode });
  runCommand(command, args, { cwd: options.cwd });
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
    "Usage: node codex-sessions.js [--json | --pick] [--cwd <path>] [--codex-home <path>]",
    "",
    "获取指定目录对应的 Codex sessions。默认读取当前目录和 ~/.codex。",
    "交互模式快捷键：Tab 切换普通/信任启动模式，→ 选择 Codex 工作区，← 返回 session 列表。",
    "启动模式会自动记住，配置保存在 ~/.codex-code-session/config.json。",
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

  const cwd = path.resolve(options.cwd);
  const codexHome = path.resolve(options.codexHome);
  const sessions = listSessions({ cwd, codexHome });

  if (options.trustCurrentFolder) {
    markProjectTrusted(cwd, path.join(codexHome, "config.toml"));
  }

  if (options.pick) {
    await pickAndRunCodex(sessions, { cwd, codexHome, trustCurrentFolder: options.trustCurrentFolder });
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          cwd,
          codexHome,
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
  console.log(`Codex home: ${codexHome}`);
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
  buildCodexCommand,
  formatSessions,
  listSessions,
  listWorkspaces,
  markProjectTrusted,
  parseArgs,
  pickAndRunCodex,
  renderInteractivePicker,
  renderWorkspacePicker,
  summarizeSession,
};
