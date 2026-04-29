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

function runInstall(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-install-"));
  const home = path.join(tempDir, "home");
  const bin = path.join(tempDir, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  makeExecutable(path.join(bin, "node"));
  if (options.withClaude !== false) {
    makeExecutable(path.join(bin, "claude"));
  }
  if (options.withCodex !== false) {
    makeExecutable(path.join(bin, "codex"));
  }

  if (options.shellRcName) {
    fs.writeFileSync(path.join(home, options.shellRcName), options.shellRcContent || "");
  }

  const result = spawnSync("/bin/bash", [installScript], {
    cwd: repoDir,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
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
  const installedScript = path.join(home, ".claude-code-session", "claude-sessions.js");
  const installedCodexScript = path.join(home, ".codex-code-session", "codex-sessions.js");
  const installedCodexSupportScript = path.join(home, ".codex-code-session", "claude-sessions.js");
  const zshrc = fs.readFileSync(path.join(home, ".zshrc"), "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(installedScript), true);
  assert.equal(fs.existsSync(installedCodexScript), true);
  assert.equal(fs.existsSync(installedCodexSupportScript), true);
  assert.equal(fs.statSync(installedScript).mode & 0o111, 0o111);
  assert.equal(fs.statSync(installedCodexScript).mode & 0o111, 0o111);
  assert.match(zshrc, /# Claude Code session picker/);
  assert.match(zshrc, /# Codex session picker/);
  assert.match(
    zshrc,
    new RegExp(`alias cc='${installedScript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --pick --trust-current-folder'`),
  );
  assert.match(
    zshrc,
    new RegExp(`alias cx='${installedCodexScript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --pick --trust-current-folder'`),
  );
});

test("install script is idempotent and replaces the managed alias", () => {
  const existingBlock = [
    "# before",
    "# Claude Code session picker",
    "alias cc='/old/path --pick --trust-current-folder'",
    "# Codex session picker",
    "alias cx='/old/codex/path --pick --trust-current-folder'",
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
  assert.doesNotMatch(bashrc, /\/old\/path/);
  assert.doesNotMatch(bashrc, /\/old\/codex\/path/);
  assert.match(bashrc, /# before/);
  assert.match(bashrc, /# after/);
});

test("install script fails when Claude Code CLI is missing", () => {
  const { result } = runInstall({ withClaude: false });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /claude/);
});

test("install script still installs aliases when Codex CLI is missing", () => {
  const { result } = runInstall({ withCodex: false });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /codex/);
});
