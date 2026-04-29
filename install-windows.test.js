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
  assert.match(script, /Get-Command codex/);
  assert.match(script, /Write-Warning "codex/);
  assert.match(script, /claude-sessions\.js/);
  assert.match(script, /codex-sessions\.js/);
  assert.match(script, /CodexSupportScript/);
});

test("Windows installer installs under the shared install directory", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /\.claude-code-session/);
  assert.match(script, /\.codex-code-session/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /\$HOME/);
});

test("Windows installer adds idempotent cc and cx functions to PowerShell profile", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /Claude Code session picker BEGIN/);
  assert.match(script, /Claude Code session picker END/);
  assert.match(script, /Codex session picker BEGIN/);
  assert.match(script, /Codex session picker END/);
  assert.match(script, /function cc/);
  assert.match(script, /function cx/);
  assert.match(script, /node \$script:ClaudeCodeSessionScript --pick --trust-current-folder @args/);
  assert.match(script, /node \$script:CodexSessionScript --pick --trust-current-folder @args/);
});
