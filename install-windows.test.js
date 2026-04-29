const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoDir = __dirname;
const installScript = path.join(repoDir, "install.ps1");

test("Windows installer contains required environment checks", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /Get-Command node/);
  assert.match(script, /Get-Command claude/);
  assert.match(script, /claude-sessions\.js/);
});

test("Windows installer installs under the shared install directory", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /\.claude-code-session/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /\$HOME/);
});

test("Windows installer adds an idempotent cc function to PowerShell profile", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /Claude Code session picker BEGIN/);
  assert.match(script, /Claude Code session picker END/);
  assert.match(script, /function cc/);
  assert.match(script, /node \$script:ClaudeCodeSessionScript --pick --trust-current-folder @args/);
});
