const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const VALID_LAUNCH_MODES = new Set(["normal", "trust"]);

function normalizeLaunchMode(launchMode) {
  return VALID_LAUNCH_MODES.has(launchMode) ? launchMode : "normal";
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config && typeof config === "object" && !Array.isArray(config) ? config : {};
  } catch {
    return {};
  }
}

function writeConfig(config, configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function loadLaunchMode(configPath) {
  return normalizeLaunchMode(readConfig(configPath).launchMode);
}

function saveLaunchMode(launchMode, configPath) {
  const config = readConfig(configPath);
  config.launchMode = normalizeLaunchMode(launchMode);
  writeConfig(config, configPath);
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

function searchTerms(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
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
  const terms = searchTerms(query);
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

function toggleLaunchMode(launchMode) {
  return launchMode === "trust" ? "normal" : "trust";
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
    env: { ...process.env, ...(options.env || {}) },
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

function createSessionPicker({
  configPath,
  defaultHome,
  homeOptionName,
  listSessions,
  listWorkspaces,
  filterSessions,
  renderInteractivePicker,
  renderWorkspacePicker,
  workspaceCwd,
}) {
  return function pickSessionInteractive(initialSessions, io = {}) {
    const input = io.input || process.stdin;
    const output = io.output || process.stdout;
    const dataHome = path.resolve(io[homeOptionName] || defaultHome());
    const launchConfigPath = io.configPath || configPath;

    if (!input.isTTY || !output.isTTY) {
      return null;
    }

    let currentCwd = path.resolve(io.cwd || process.cwd());
    let sessions = initialSessions || listSessions({ cwd: currentCwd, [homeOptionName]: dataHome });
    let workspaces = null;
    let view = "sessions";
    let launchMode = normalizeLaunchMode(io.launchMode || loadLaunchMode(launchConfigPath));
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
        return [
          { type: "new", label: "New session" },
          ...filterSessions(sessions, sessionQuery).map((session) => ({ type: "session", session })),
        ];
      }

      function currentWorkspaceItems() {
        if (!workspaces) {
          workspaces = listWorkspaces({ [homeOptionName]: dataHome });
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
              currentCwd = path.resolve(workspaceCwd(item.workspace, currentCwd));
              sessions = listSessions({ cwd: currentCwd, [homeOptionName]: dataHome });
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
          saveLaunchMode(launchMode, launchConfigPath);
          render();
          return;
        }

        if (key.name === "right" && view === "sessions") {
          if (!workspaces) {
            workspaces = listWorkspaces({ [homeOptionName]: dataHome });
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
  };
}

module.exports = {
  askQuestion,
  clampSelectedIndex,
  createSessionPicker,
  filterWorkspaces,
  loadLaunchMode,
  normalizeLaunchMode,
  readJsonLines,
  runCommand,
  saveLaunchMode,
  workspaceItems,
};
