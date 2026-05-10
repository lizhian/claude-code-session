$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Error $Message
  exit 1
}

# --- Detect platform ---
$GOOS = "windows"
$GOARCH = "amd64"
if ($Env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
  $GOARCH = "arm64"
}

$Suffix = "windows-${GOARCH}.exe"

# --- Configuration ---
$Repo = "lizhian/agent-session"
$InstallDir = Join-Path $HOME ".agent-session" "bin"
$BinaryName = "agent-session.exe"
$BinaryPath = Join-Path $InstallDir $BinaryName

$Version = if ($Env:INSTALL_VERSION) { $Env:INSTALL_VERSION } else { "latest" }

$ReleaseUrl = if ($Version -eq "latest") {
  "https://github.com/$Repo/releases/latest/download/agent-session-$Suffix"
} else {
  "https://github.com/$Repo/releases/download/$Version/agent-session-$Suffix"
}

$ChecksumUrl = if ($Version -eq "latest") {
  "https://github.com/$Repo/releases/latest/download/checksums.txt"
} else {
  "https://github.com/$Repo/releases/download/$Version/checksums.txt"
}

# --- Check for existing agent CLIs ---
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

# --- Download ---
Write-Host "Downloading agent-session ($Suffix)..."
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

try {
  Invoke-WebRequest -Uri $ReleaseUrl -OutFile $BinaryPath -UseBasicParsing
} catch {
  Remove-Item -Path $BinaryPath -Force -ErrorAction SilentlyContinue
  Fail "Failed to download from $ReleaseUrl. Check that the release exists."
}

Write-Host "Installed agent-session to $BinaryPath"

# --- Verify checksum ---
$ChecksumFile = Join-Path $Env:TEMP "agent-session-checksums.txt"
try {
  Invoke-WebRequest -Uri $ChecksumUrl -OutFile $ChecksumFile -UseBasicParsing
  $ExpectedLine = Get-Content $ChecksumFile | Where-Object { $_ -match "agent-session-$Suffix`$" }
  if ($ExpectedLine) {
    $Expected = ($ExpectedLine -split '\s+')[0]
    $Actual = (Get-FileHash -Path $BinaryPath -Algorithm SHA256).Hash.ToLower()
    if ($Actual -ne $Expected) {
      Remove-Item -Path $BinaryPath -Force
      Fail "Checksum mismatch: expected $Expected, got $Actual"
    }
    Write-Host "Checksum verified."
  }
} catch {
  # Checksum verification is optional; ignore failures.
} finally {
  Remove-Item -Path $ChecksumFile -Force -ErrorAction SilentlyContinue
}

# --- Create symlinks (hardlinks on Windows) ---
$CcPath = Join-Path $InstallDir "cc.exe"
$CxPath = Join-Path $InstallDir "cx.exe"
$OcPath = Join-Path $InstallDir "oc.exe"

# Remove old links if they exist.
Remove-Item -Path $CcPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $CxPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $OcPath -Force -ErrorAction SilentlyContinue

# Create hardlinks (no admin rights needed on same volume).
New-Item -ItemType HardLink -Path $CcPath -Target $BinaryPath -Force | Out-Null
New-Item -ItemType HardLink -Path $CxPath -Target $BinaryPath -Force | Out-Null
New-Item -ItemType HardLink -Path $OcPath -Target $BinaryPath -Force | Out-Null

# --- Add to PATH in PowerShell profile ---
$ProfilePath = $PROFILE.CurrentUserAllHosts
$ProfileDir = Split-Path -Parent $ProfilePath
if (-not (Test-Path $ProfileDir)) {
  New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}
if (-not (Test-Path $ProfilePath)) {
  New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
}

$BeginMarker = "# agent-session BEGIN"
$EndMarker = "# agent-session END"

$ExistingProfile = Get-Content -Raw -Path $ProfilePath
$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?^$([regex]::Escape($EndMarker))\r?\n?"
$UpdatedProfile = [regex]::Replace($ExistingProfile, $Pattern, "")

# Also remove old JS-based markers.
$JsBeginMarkers = @("# Claude Code session picker BEGIN", "# Codex session picker BEGIN", "# OpenCode session picker BEGIN")
$JsEndMarkers = @("# Claude Code session picker END", "# Codex session picker END", "# OpenCode session picker END")
for ($i = 0; $i -lt $JsBeginMarkers.Count; $i++) {
  $JsPattern = "(?ms)^$([regex]::Escape($JsBeginMarkers[$i])).*?^$([regex]::Escape($JsEndMarkers[$i]))\r?\n?"
  $UpdatedProfile = [regex]::Replace($UpdatedProfile, $JsPattern, "")
}

if ($UpdatedProfile.Length -gt 0 -and -not $UpdatedProfile.EndsWith("`n")) {
  $UpdatedProfile += "`n"
}

$EscapedInstallDir = $InstallDir.Replace("`", "``").Replace('"', '`"')
$PathBlock = @"
# agent-session BEGIN
`$env:PATH = "$EscapedInstallDir;`$env:PATH"

function cc { & "$EscapedInstallDir\agent-session.exe" cc @args }
function cx { & "$EscapedInstallDir\agent-session.exe" cx @args }
function oc { & "$EscapedInstallDir\agent-session.exe" oc @args }
# agent-session END
"@

$UpdatedProfile += "`n$PathBlock`n"
Set-Content -Path $ProfilePath -Value $UpdatedProfile -Encoding UTF8

$AvailableAliases = @()
if ($HasClaude)  { $AvailableAliases += "cc" }
if ($HasCodex)   { $AvailableAliases += "cx" }
if ($HasOpenCode) { $AvailableAliases += "oc" }

Write-Host ""
Write-Host "Done! Restart PowerShell or run: . `$PROFILE"
Write-Host "Then use: $($AvailableAliases -join ', ')"
$Size = (Get-Item $BinaryPath).Length / 1MB
Write-Host "Binary: $BinaryPath ($([math]::Round($Size, 1)) MB)"
