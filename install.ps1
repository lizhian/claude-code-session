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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceScript = Join-Path $ScriptDir "claude-sessions.js"
$InstallDir = Join-Path $HOME ".claude-code-session"
$InstalledScript = Join-Path $InstallDir "claude-sessions.js"

if (-not (Test-Path $SourceScript)) {
  Fail "claude-sessions.js was not found next to install.ps1."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path $SourceScript -Destination $InstalledScript -Force

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
$EscapedInstalledScript = $InstalledScript.Replace("`", "``").Replace('"', '`"')
$AliasBlock = @'
# Claude Code session picker BEGIN
$script:ClaudeCodeSessionScript = "__CLAUDE_CODE_SESSION_SCRIPT__"
function cc {
  node $script:ClaudeCodeSessionScript --pick --trust-current-folder @args
}
# Claude Code session picker END
'@
$AliasBlock = $AliasBlock.Replace("__CLAUDE_CODE_SESSION_SCRIPT__", $EscapedInstalledScript)

$ExistingProfile = Get-Content -Raw -Path $ProfilePath
$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?^$([regex]::Escape($EndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($ExistingProfile, $Pattern, "")
if ($UpdatedProfile.Length -gt 0 -and -not $UpdatedProfile.EndsWith("`n")) {
  $UpdatedProfile += "`n"
}
$UpdatedProfile += "`n$AliasBlock`n"
Set-Content -Path $ProfilePath -Value $UpdatedProfile -Encoding UTF8

Write-Host "Installed claude-sessions.js to $InstalledScript"
Write-Host "Added cc function to $ProfilePath"
Write-Host "Restart PowerShell or run: . `$PROFILE"
