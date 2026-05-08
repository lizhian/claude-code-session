const path = require("node:path");
const { formatPicker } = require("./session-renderer");
const {
  askQuestion,
  loadPermissionMode,
  normalizePermissionMode,
  runCommand,
} = require("./session-utils");

function writeLine(options, value = "") {
  if (options.output && typeof options.output.write === "function") {
    options.output.write(`${value}\n`);
    return;
  }
  console.log(value);
}

function providerContext(provider, options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const dataHome = path.resolve(options[provider.homeOptionName] || provider.defaultHome());
  return {
    cwd,
    [provider.homeOptionName]: dataHome,
  };
}

function trustCurrentFolder(provider, cwd, options) {
  if (options.trustCurrentFolder && provider.trustCurrentFolder) {
    provider.trustCurrentFolder(cwd, options);
  }
}

function storedPermissionMode(provider, options, context, permissionModes) {
  if (typeof provider.loadPermissionMode === "function") {
    return provider.loadPermissionMode({ ...options, ...context }, permissionModes);
  }
  return loadPermissionMode(options.configPath || provider.configPath, permissionModes);
}

async function pickAndRunProvider(provider, sessions, options = {}) {
  const permissionModes = provider.permissionModes;
  const context = providerContext(provider, options);
  const permissionMode = normalizePermissionMode(
    options.permissionMode || options.launchMode || storedPermissionMode(provider, options, context, permissionModes),
    permissionModes,
  );
  const picked = await provider.pickSessionInteractive(sessions, options);
  if (picked) {
    trustCurrentFolder(provider, picked.cwd, options);
    const { command, args, cwd, env } = provider.selectedItemToCommand(picked.item, {
      ...options,
      permissionMode: picked.permissionMode,
      cwd: picked.cwd,
    });
    (options.runCommand || runCommand)(command, args, { cwd, env });
    return;
  }

  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  if (input.isTTY && output.isTTY) {
    process.exitCode = 130;
    return;
  }

  writeLine(options, (provider.formatPicker || formatPicker)(sessions));
  writeLine(options);

  const answer = await (options.askQuestion || askQuestion)("选择 session 编号，直接回车创建 New session: ");
  trustCurrentFolder(provider, options.cwd, options);
  const { command, args, env } = provider.buildCommandFromChoice(sessions, answer, {
    ...options,
    permissionMode,
  });
  (options.runCommand || runCommand)(command, args, { cwd: options.cwd, env });
}

async function runProviderCli(provider, options = {}) {
  const context = providerContext(provider, options);
  const runOptions = { ...options, ...context };
  const sessions = provider.listSessions(context);

  trustCurrentFolder(provider, context.cwd, runOptions);

  if (runOptions.pick) {
    await pickAndRunProvider(provider, sessions, runOptions);
    return;
  }

  if (runOptions.json) {
    writeLine(
      runOptions,
      JSON.stringify(provider.jsonPayload({ ...context, sessions, options: runOptions }), null, 2),
    );
    return;
  }

  for (const line of provider.summaryLines({ ...context, sessions, options: runOptions })) {
    writeLine(runOptions, line);
  }
  writeLine(runOptions);
  writeLine(runOptions, provider.formatSessions(sessions));
}

module.exports = {
  pickAndRunProvider,
  runProviderCli,
};
