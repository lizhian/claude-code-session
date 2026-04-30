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
$SourceScript = Join-Path $ScriptDir "claude-sessions.js"
$UtilsSourceScript = Join-Path $ScriptDir "session-utils.js"
$CodexSourceScript = Join-Path $ScriptDir "codex-sessions.js"
$OpenCodeSourceScript = Join-Path $ScriptDir "opencode-sessions.js"
$InstallDir = Join-Path $HOME ".claude-code-session"
$CodexInstallDir = Join-Path $HOME ".codex-code-session"
$OpenCodeInstallDir = Join-Path $HOME ".opencode-code-session"
$InstalledScript = Join-Path $InstallDir "claude-sessions.js"
$InstalledUtilsScript = Join-Path $InstallDir "session-utils.js"
$CodexInstalledScript = Join-Path $CodexInstallDir "codex-sessions.js"
$CodexSupportScript = Join-Path $CodexInstallDir "claude-sessions.js"
$CodexUtilsScript = Join-Path $CodexInstallDir "session-utils.js"
$OpenCodeInstalledScript = Join-Path $OpenCodeInstallDir "opencode-sessions.js"
$OpenCodeSupportScript = Join-Path $OpenCodeInstallDir "claude-sessions.js"
$OpenCodeUtilsScript = Join-Path $OpenCodeInstallDir "session-utils.js"

if (-not (Test-Path $SourceScript)) {
  Fail "claude-sessions.js was not found next to install.ps1."
}

if (-not (Test-Path $UtilsSourceScript)) {
  Fail "session-utils.js was not found next to install.ps1."
}

if ($HasCodex -and -not (Test-Path $CodexSourceScript)) {
  Fail "codex-sessions.js was not found next to install.ps1."
}

if ($HasOpenCode -and -not (Test-Path $OpenCodeSourceScript)) {
  Fail "opencode-sessions.js was not found next to install.ps1."
}

if ($HasClaude) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path $SourceScript -Destination $InstalledScript -Force
  Copy-Item -Path $UtilsSourceScript -Destination $InstalledUtilsScript -Force
}

if ($HasCodex) {
  New-Item -ItemType Directory -Path $CodexInstallDir -Force | Out-Null
  Copy-Item -Path $CodexSourceScript -Destination $CodexInstalledScript -Force
  Copy-Item -Path $SourceScript -Destination $CodexSupportScript -Force
  Copy-Item -Path $UtilsSourceScript -Destination $CodexUtilsScript -Force
}

if ($HasOpenCode) {
  New-Item -ItemType Directory -Path $OpenCodeInstallDir -Force | Out-Null
  Copy-Item -Path $OpenCodeSourceScript -Destination $OpenCodeInstalledScript -Force
  Copy-Item -Path $SourceScript -Destination $OpenCodeSupportScript -Force
  Copy-Item -Path $UtilsSourceScript -Destination $OpenCodeUtilsScript -Force
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
  Write-Host "Installed claude-sessions.js to $InstalledScript"
  Write-Host "Added cc function to $ProfilePath"
  $AvailableAliases += "cc"
}
if ($HasCodex) {
  Write-Host "Installed codex-sessions.js to $CodexInstalledScript"
  Write-Host "Added cx function to $ProfilePath"
  $AvailableAliases += "cx"
}
if ($HasOpenCode) {
  Write-Host "Installed opencode-sessions.js to $OpenCodeInstalledScript"
  Write-Host "Added oc function to $ProfilePath"
  $AvailableAliases += "oc"
}
Write-Host "Restart PowerShell or run: . `$PROFILE. Then use: $($AvailableAliases -join ', ')"
