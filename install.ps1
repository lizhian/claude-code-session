$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Error $Message
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "node is required but was not found in PATH."
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Fail "claude is required but was not found in PATH."
}

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  Write-Warning "codex was not found in PATH. The cx function is installed but requires Codex CLI."
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceScript = Join-Path $ScriptDir "claude-sessions.js"
$CodexSourceScript = Join-Path $ScriptDir "codex-sessions.js"
$InstallDir = Join-Path $HOME ".claude-code-session"
$CodexInstallDir = Join-Path $HOME ".codex-code-session"
$InstalledScript = Join-Path $InstallDir "claude-sessions.js"
$CodexInstalledScript = Join-Path $CodexInstallDir "codex-sessions.js"
$CodexSupportScript = Join-Path $CodexInstallDir "claude-sessions.js"

if (-not (Test-Path $SourceScript)) {
  Fail "claude-sessions.js was not found next to install.ps1."
}

if (-not (Test-Path $CodexSourceScript)) {
  Fail "codex-sessions.js was not found next to install.ps1."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $CodexInstallDir -Force | Out-Null
Copy-Item -Path $SourceScript -Destination $InstalledScript -Force
Copy-Item -Path $CodexSourceScript -Destination $CodexInstalledScript -Force
Copy-Item -Path $SourceScript -Destination $CodexSupportScript -Force

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
$EscapedInstalledScript = $InstalledScript.Replace("`", "``").Replace('"', '`"')
$EscapedCodexInstalledScript = $CodexInstalledScript.Replace("`", "``").Replace('"', '`"')
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

$ExistingProfile = Get-Content -Raw -Path $ProfilePath
$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?^$([regex]::Escape($EndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($ExistingProfile, $Pattern, "")
$CodexPattern = "(?ms)^$([regex]::Escape($CodexBeginMarker)).*?^$([regex]::Escape($CodexEndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($UpdatedProfile, $CodexPattern, "")
if ($UpdatedProfile.Length -gt 0 -and -not $UpdatedProfile.EndsWith("`n")) {
  $UpdatedProfile += "`n"
}
$UpdatedProfile += "`n$AliasBlock`n`n$CodexAliasBlock`n"
Set-Content -Path $ProfilePath -Value $UpdatedProfile -Encoding UTF8

Write-Host "Installed claude-sessions.js to $InstalledScript"
Write-Host "Installed codex-sessions.js to $CodexInstalledScript"
Write-Host "Added cc function to $ProfilePath"
Write-Host "Added cx function to $ProfilePath"
Write-Host "Restart PowerShell or run: . `$PROFILE"
