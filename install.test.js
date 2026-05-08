const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repoDir = __dirname;
const installScript = path.join(repoDir, "install.sh");

function makeExecutable(file) {
  fs.writeFileSync(file, "#!/usr/bin/env sh\nexit 0\n");
  fs.chmodSync(file, 0o755);
}

function linkSystemCommand(bin, name) {
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  assert.equal(result.status, 0, `${name} was not found`);
  const target = result.stdout.trim();
  fs.symlinkSync(target, path.join(bin, name));
}

function runInstall(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-install-"));
  const home = path.join(tempDir, "home");
  const bin = path.join(tempDir, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  if (options.isolatedPath) {
    for (const command of ["awk", "basename", "chmod", "cp", "dirname", "mkdir", "mktemp", "mv", "touch"]) {
      linkSystemCommand(bin, command);
    }
  }

  makeExecutable(path.join(bin, "node"));
  if (options.withClaude !== false) {
    makeExecutable(path.join(bin, "claude"));
  }
  if (options.withCodex !== false) {
    makeExecutable(path.join(bin, "codex"));
  }
  if (options.withOpenCode !== false) {
    makeExecutable(path.join(bin, "opencode"));
  }
  if (options.withSqlite !== false) {
    makeExecutable(path.join(bin, "sqlite3"));
  }

  if (options.shellRcName) {
    fs.writeFileSync(path.join(home, options.shellRcName), options.shellRcContent || "");
  }

  const result = spawnSync("/bin/bash", [installScript], {
    cwd: repoDir,
    env: {
      ...process.env,
      HOME: home,
      PATH: options.isolatedPath ? bin : `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      SHELL: options.shell || "/bin/zsh",
    },
    encoding: "utf8",
  });

  return { result, home, bin };
}

test("install script copies the picker and adds a zsh alias", () => {
  const { result, home } = runInstall({
    shell: "/bin/zsh",
    shellRcName: ".zshrc",
    shellRcContent: "# existing config\n",
  });
  const installDir = path.join(home, ".agent-session");
  const installedScript = path.join(installDir, "claude", "claude-sessions.js");
  const installedUtilsScript = path.join(installDir, "common", "session-utils.js");
  const installedRendererScript = path.join(installDir, "common", "session-renderer.js");
  const installedCodexScript = path.join(installDir, "codex", "codex-sessions.js");
  const installedCodexProvidersScript = path.join(installDir, "codex", "codex-model-providers.js");
  const installedOpenCodeScript = path.join(installDir, "opencode", "opencode-sessions.js");
  const installedOpenCodeProvidersScript = path.join(installDir, "opencode", "opencode-provider-models.js");
  const zshrc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(installedScript), true);
  assert.equal(fs.existsSync(installedUtilsScript), true);
  assert.equal(fs.existsSync(installedRendererScript), true);
  assert.equal(fs.existsSync(installedCodexScript), true);
  assert.equal(fs.existsSync(installedCodexProvidersScript), true);
  assert.equal(fs.existsSync(installedOpenCodeScript), true);
  assert.equal(fs.existsSync(installedOpenCodeProvidersScript), true);
  assert.equal(fs.statSync(installedScript).mode & 0o111, 0o111);
  assert.equal(fs.statSync(installedCodexScript).mode & 0o111, 0o111);
  assert.equal(fs.statSync(installedOpenCodeScript).mode & 0o111, 0o111);
  assert.match(zshrc, /# Claude Code session picker/);
  assert.match(zshrc, /# Codex session picker/);
  assert.match(zshrc, /# OpenCode session picker/);
  assert.match(
    zshrc,
    new RegExp(`alias cc='${installedScript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --pick --trust-current-folder'`),
  );
  assert.match(
    zshrc,
    new RegExp(`alias cx='${installedCodexScript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --pick --trust-current-folder'`),
  );
  assert.match(
    zshrc,
    new RegExp(`alias oc='${installedOpenCodeScript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --pick --trust-current-folder'`),
  );
});

test("install script is idempotent and replaces the managed alias", () => {
  const existingBlock = [
    "# before",
    "# Claude Code session picker",
    "alias cc='/old/path --pick --trust-current-folder'",
    "# Codex session picker",
    "alias cx='/old/codex/path --pick --trust-current-folder'",
    "# OpenCode session picker",
    "alias oc='/old/opencode/path --pick --trust-current-folder'",
    "# after",
    "",
  ].join("\n");
  const { result, home } = runInstall({
    shell: "/bin/bash",
    shellRcName: ".bashrc",
    shellRcContent: existingBlock,
  });
  const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal((bashrc.match(/# Claude Code session picker/g) || []).length, 1);
  assert.equal((bashrc.match(/# Codex session picker/g) || []).length, 1);
  assert.equal((bashrc.match(/# OpenCode session picker/g) || []).length, 1);
  assert.doesNotMatch(bashrc, /\/old\/path/);
  assert.doesNotMatch(bashrc, /\/old\/codex\/path/);
  assert.doesNotMatch(bashrc, /\/old\/opencode\/path/);
  assert.match(bashrc, /# before/);
  assert.match(bashrc, /# after/);
});

test("install script installs only agents found in PATH", () => {
  const { result, home } = runInstall({
    withClaude: false,
    withOpenCode: false,
    shellRcName: ".zshrc",
    shellRcContent: [
      "# Claude Code session picker",
      "alias cc='/old/path --pick --trust-current-folder'",
      "# OpenCode session picker",
      "alias oc='/old/opencode/path --pick --trust-current-folder'",
      "",
    ].join("\n"),
  });
  const installDir = path.join(home, ".agent-session");
  const installedScript = path.join(installDir, "claude", "claude-sessions.js");
  const installedCodexScript = path.join(installDir, "codex", "codex-sessions.js");
  const installedOpenCodeScript = path.join(installDir, "opencode", "opencode-sessions.js");
  const installedUtilsScript = path.join(installDir, "common", "session-utils.js");
  const zshrc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(installedScript), false);
  assert.equal(fs.existsSync(installedCodexScript), true);
  assert.equal(fs.existsSync(installedOpenCodeScript), false);
  assert.equal(fs.existsSync(installedUtilsScript), true);
  assert.doesNotMatch(zshrc, /# Claude Code session picker/);
  assert.match(zshrc, /# Codex session picker/);
  assert.doesNotMatch(zshrc, /# OpenCode session picker/);
  assert.doesNotMatch(zshrc, /alias cc=/);
  assert.match(zshrc, /alias cx=/);
  assert.doesNotMatch(zshrc, /alias oc=/);
  assert.match(result.stderr, /claude/);
  assert.match(result.stderr, /opencode/);
});

test("install script skips the Codex alias when Codex CLI is missing", () => {
  const { result } = runInstall({ withCodex: false });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /codex/);
});

test("install script skips the OpenCode alias when OpenCode CLI is missing", () => {
  const { result } = runInstall({ withOpenCode: false });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /opencode/);
});

test("install script fails when no supported agent CLI is found", () => {
  const { result } = runInstall({ withClaude: false, withCodex: false, withOpenCode: false });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /claude, codex, or opencode/);
});

test("install script still installs aliases when sqlite3 is missing", () => {
  const { result } = runInstall({ withSqlite: false, isolatedPath: true });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /sqlite3/);
});
