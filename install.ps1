$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Error $Message
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "node is required but was not found in PATH."
}

$HasClaude = [bool](Get-Command claude -ErrorAction SilentlyContinue)
$HasCodex = [bool](Get-Command codex -ErrorAction SilentlyContinue)
$HasOpenCode = [bool](Get-Command opencode -ErrorAction SilentlyContinue)

if (-not $HasClaude) {
  Write-Warning "claude was not found in PATH. Skipping cc function."
}

if (-not $HasCodex) {
  Write-Warning "codex was not found in PATH. Skipping cx function."
}

if (-not $HasOpenCode) {
  Write-Warning "opencode was not found in PATH. Skipping oc function."
}

if (-not ($HasClaude -or $HasCodex -or $HasOpenCode)) {
  Fail "No supported agent CLI found in PATH. Install claude, codex, or opencode first."
}

if ($HasOpenCode -and -not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) {
  Write-Warning "sqlite3 was not found in PATH. The oc function requires sqlite3 to read OpenCode sessions."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CommonSourceDir = Join-Path $ScriptDir "common"
$ClaudeSourceDir = Join-Path $ScriptDir "claude"
$CodexSourceDir = Join-Path $ScriptDir "codex"
$OpenCodeSourceDir = Join-Path $ScriptDir "opencode"
$SourceScript = Join-Path $ClaudeSourceDir "claude-sessions.js"
$CodexSourceScript = Join-Path $CodexSourceDir "codex-sessions.js"
$OpenCodeSourceScript = Join-Path $OpenCodeSourceDir "opencode-sessions.js"
$InstallDir = Join-Path $HOME ".agent-session"
$CommonInstallDir = Join-Path $InstallDir "common"
$ClaudeInstallDir = Join-Path $InstallDir "claude"
$CodexInstallDir = Join-Path $InstallDir "codex"
$OpenCodeInstallDir = Join-Path $InstallDir "opencode"
$InstalledScript = Join-Path $ClaudeInstallDir "claude-sessions.js"
$CodexInstalledScript = Join-Path $CodexInstallDir "codex-sessions.js"
$OpenCodeInstalledScript = Join-Path $OpenCodeInstallDir "opencode-sessions.js"

if (-not (Test-Path (Join-Path $CommonSourceDir "session-utils.js"))) {
  Fail "common/session-utils.js was not found next to install.ps1."
}

if (-not (Test-Path (Join-Path $CommonSourceDir "session-renderer.js"))) {
  Fail "common/session-renderer.js was not found next to install.ps1."
}

if ($HasClaude -and -not (Test-Path $SourceScript)) {
  Fail "claude/claude-sessions.js was not found next to install.ps1."
}

if ($HasCodex -and -not (Test-Path $CodexSourceScript)) {
  Fail "codex/codex-sessions.js was not found next to install.ps1."
}

if ($HasOpenCode -and -not (Test-Path $OpenCodeSourceScript)) {
  Fail "opencode/opencode-sessions.js was not found next to install.ps1."
}

New-Item -ItemType Directory -Path $CommonInstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $CommonSourceDir "*.js") -Destination $CommonInstallDir -Force

if ($HasClaude) {
  New-Item -ItemType Directory -Path $ClaudeInstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $ClaudeSourceDir "*.js") -Destination $ClaudeInstallDir -Force
}

if ($HasCodex) {
  New-Item -ItemType Directory -Path $CodexInstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $CodexSourceDir "*.js") -Destination $CodexInstallDir -Force
}

if ($HasOpenCode) {
  New-Item -ItemType Directory -Path $OpenCodeInstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $OpenCodeSourceDir "*.js") -Destination $OpenCodeInstallDir -Force
}

$ProfilePath = $PROFILE.CurrentUserAllHosts
$ProfileDir = Split-Path -Parent $ProfilePath
if (-not (Test-Path $ProfileDir)) {
  New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}
if (-not (Test-Path $ProfilePath)) {
  New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
}

$BeginMarker = "# Claude Code session picker BEGIN"
$EndMarker = "# Claude Code session picker END"
$CodexBeginMarker = "# Codex session picker BEGIN"
$CodexEndMarker = "# Codex session picker END"
$OpenCodeBeginMarker = "# OpenCode session picker BEGIN"
$OpenCodeEndMarker = "# OpenCode session picker END"
$EscapedInstalledScript = $InstalledScript.Replace("`", "``").Replace('"', '`"')
$EscapedCodexInstalledScript = $CodexInstalledScript.Replace("`", "``").Replace('"', '`"')
$EscapedOpenCodeInstalledScript = $OpenCodeInstalledScript.Replace("`", "``").Replace('"', '`"')
$AliasBlock = @'
# Claude Code session picker BEGIN
$script:ClaudeCodeSessionScript = "__CLAUDE_CODE_SESSION_SCRIPT__"
function cc {
  node $script:ClaudeCodeSessionScript --pick --trust-current-folder @args
}
# Claude Code session picker END
'@
$AliasBlock = $AliasBlock.Replace("__CLAUDE_CODE_SESSION_SCRIPT__", $EscapedInstalledScript)
$CodexAliasBlock = @'
# Codex session picker BEGIN
$script:CodexSessionScript = "__CODEX_SESSION_SCRIPT__"
function cx {
  node $script:CodexSessionScript --pick --trust-current-folder @args
}
# Codex session picker END
'@
$CodexAliasBlock = $CodexAliasBlock.Replace("__CODEX_SESSION_SCRIPT__", $EscapedCodexInstalledScript)
$OpenCodeAliasBlock = @'
# OpenCode session picker BEGIN
$script:OpenCodeSessionScript = "__OPENCODE_SESSION_SCRIPT__"
function oc {
  node $script:OpenCodeSessionScript --pick --trust-current-folder @args
}
# OpenCode session picker END
'@
$OpenCodeAliasBlock = $OpenCodeAliasBlock.Replace("__OPENCODE_SESSION_SCRIPT__", $EscapedOpenCodeInstalledScript)

$ExistingProfile = Get-Content -Raw -Path $ProfilePath
$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?^$([regex]::Escape($EndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($ExistingProfile, $Pattern, "")
$CodexPattern = "(?ms)^$([regex]::Escape($CodexBeginMarker)).*?^$([regex]::Escape($CodexEndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($UpdatedProfile, $CodexPattern, "")
$OpenCodePattern = "(?ms)^$([regex]::Escape($OpenCodeBeginMarker)).*?^$([regex]::Escape($OpenCodeEndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($UpdatedProfile, $OpenCodePattern, "")
if ($UpdatedProfile.Length -gt 0 -and -not $UpdatedProfile.EndsWith("`n")) {
  $UpdatedProfile += "`n"
}
$ProfileBlocks = @()
if ($HasClaude) {
  $ProfileBlocks += $AliasBlock
}
if ($HasCodex) {
  $ProfileBlocks += $CodexAliasBlock
}
if ($HasOpenCode) {
  $ProfileBlocks += $OpenCodeAliasBlock
}
$UpdatedProfile += "`n$($ProfileBlocks -join "`n`n")`n"
Set-Content -Path $ProfilePath -Value $UpdatedProfile -Encoding UTF8

$AvailableAliases = @()
if ($HasClaude) {
  Write-Host "Installed claude/claude-sessions.js to $InstalledScript"
  Write-Host "Added cc function to $ProfilePath"
  $AvailableAliases += "cc"
}
if ($HasCodex) {
  Write-Host "Installed codex/codex-sessions.js to $CodexInstalledScript"
  Write-Host "Added cx function to $ProfilePath"
  $AvailableAliases += "cx"
}
if ($HasOpenCode) {
  Write-Host "Installed opencode/opencode-sessions.js to $OpenCodeInstalledScript"
  Write-Host "Added oc function to $ProfilePath"
  $AvailableAliases += "oc"
}
Write-Host "Restart PowerShell or run: . `$PROFILE. Then use: $($AvailableAliases -join ', ')"
