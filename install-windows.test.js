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
  assert.doesNotMatch(script, /Fail "claude is required/);
  assert.match(script, /Get-Command codex/);
  assert.match(script, /Write-Warning "codex/);
  assert.match(script, /Get-Command opencode/);
  assert.match(script, /Write-Warning "opencode/);
  assert.match(script, /No supported agent CLI found/);
  assert.match(script, /Get-Command sqlite3/);
  assert.match(script, /Write-Warning "sqlite3/);
  assert.match(script, /claude-sessions\.js/);
  assert.match(script, /session-utils\.js/);
  assert.match(script, /session-renderer\.js/);
  assert.match(script, /codex-sessions\.js/);
  assert.match(script, /opencode-sessions\.js/);
  assert.match(script, /CommonSourceDir/);
  assert.match(script, /CommonInstallDir/);
  assert.doesNotMatch(script, /CodexSupportScript/);
  assert.doesNotMatch(script, /OpenCodeSupportScript/);
});

test("Windows installer gates copies and functions by detected agents", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /\$HasClaude = \[bool\]\(Get-Command claude/);
  assert.match(script, /\$HasCodex = \[bool\]\(Get-Command codex/);
  assert.match(script, /\$HasOpenCode = \[bool\]\(Get-Command opencode/);
  assert.match(script, /if \(\$HasClaude\)/);
  assert.match(script, /if \(\$HasCodex\)/);
  assert.match(script, /if \(\$HasOpenCode\)/);
});

test("Windows installer installs under the shared install directory", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /\.agent-session/);
  assert.doesNotMatch(script, /\.claude-code-session/);
  assert.doesNotMatch(script, /\.codex-code-session/);
  assert.doesNotMatch(script, /\.opencode-code-session/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /\$HOME/);
});

test("Windows installer adds idempotent cc, cx, and oc functions to PowerShell profile", () => {
  const script = fs.readFileSync(installScript, "utf8");

  assert.match(script, /Claude Code session picker BEGIN/);
  assert.match(script, /Claude Code session picker END/);
  assert.match(script, /Codex session picker BEGIN/);
  assert.match(script, /Codex session picker END/);
  assert.match(script, /OpenCode session picker BEGIN/);
  assert.match(script, /OpenCode session picker END/);
  assert.match(script, /function cc/);
  assert.match(script, /function cx/);
  assert.match(script, /function oc/);
  assert.match(script, /node \$script:ClaudeCodeSessionScript --pick --trust-current-folder @args/);
  assert.match(script, /node \$script:CodexSessionScript --pick --trust-current-folder @args/);
  assert.match(script, /node \$script:OpenCodeSessionScript --pick --trust-current-folder @args/);
});
