#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

info() {
  printf '%s\n' "$1"
}

# --- Detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) GOOS="darwin" ;;
  Linux)  GOOS="linux" ;;
  *)      fail "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64)         GOARCH="amd64" ;;
  arm64|aarch64)        GOARCH="arm64" ;;
  *)                    fail "Unsupported architecture: $ARCH" ;;
esac

SUFFIX="${GOOS}-${GOARCH}"
if [[ "$GOOS" == "windows" ]]; then
  SUFFIX="${SUFFIX}.exe"
fi

# --- Configuration ---
REPO="lizhian/agent-session"
INSTALL_DIR="$HOME/.agent-session/bin"
BINARY_NAME="agent-session"
BINARY_PATH="$INSTALL_DIR/$BINARY_NAME"

# Allow overriding the version to install.
# Defaults to the latest GitHub release.
VERSION="${INSTALL_VERSION:-latest}"

if [[ "$VERSION" == "latest" ]]; then
  info "Fetching latest release from ${REPO}..."
  RELEASE_URL="https://github.com/${REPO}/releases/latest/download/agent-session-${SUFFIX}"
else
  RELEASE_URL="https://github.com/${REPO}/releases/download/${VERSION}/agent-session-${SUFFIX}"
fi

CHECKSUM_URL="$(dirname "$RELEASE_URL")/checksums.txt"

# --- Check for existing agent CLIs ---
has_claude=false
has_codex=false
has_opencode=false

if command -v claude >/dev/null 2>&1; then
  has_claude=true
else
  printf 'Warning: claude was not found in PATH. Skipping cc alias.\n' >&2
fi

if command -v codex >/dev/null 2>&1; then
  has_codex=true
else
  printf 'Warning: codex was not found in PATH. Skipping cx alias.\n' >&2
fi

if command -v opencode >/dev/null 2>&1; then
  has_opencode=true
else
  printf 'Warning: opencode was not found in PATH. Skipping oc alias.\n' >&2
fi

if [[ "$has_claude" != true && "$has_codex" != true && "$has_opencode" != true ]]; then
  fail "No supported agent CLI found in PATH. Install claude, codex, or opencode first."
fi

# --- Download ---
info "Downloading agent-session (${SUFFIX})..."
mkdir -p "$INSTALL_DIR"

HTTP_CODE=$(curl -fsSL -w "%{http_code}" -o "$BINARY_PATH" "$RELEASE_URL") || true

if [[ "$HTTP_CODE" != "200" ]]; then
  rm -f "$BINARY_PATH"
  fail "Failed to download from $RELEASE_URL (HTTP $HTTP_CODE). Check that the release exists."
fi

chmod 755 "$BINARY_PATH"
info "Installed agent-session to $BINARY_PATH"

# --- Verify checksum ---
CHECKSUM_FILE="$(mktemp)"
if curl -fsSL -o "$CHECKSUM_FILE" "$CHECKSUM_URL" 2>/dev/null; then
  EXPECTED="$(grep "agent-session-${SUFFIX}$" "$CHECKSUM_FILE" | awk '{print $1}')"
  if [[ -n "$EXPECTED" ]]; then
    ACTUAL="$(shasum -a 256 "$BINARY_PATH" | awk '{print $1}')"
    if [[ "$ACTUAL" != "$EXPECTED" ]]; then
      rm -f "$BINARY_PATH"
      fail "Checksum mismatch: expected $EXPECTED, got $ACTUAL"
    fi
    info "Checksum verified."
  fi
fi
rm -f "$CHECKSUM_FILE"

# --- Create symlinks ---
ln -sf "$BINARY_PATH" "$INSTALL_DIR/cc"
ln -sf "$BINARY_PATH" "$INSTALL_DIR/cx"
ln -sf "$BINARY_PATH" "$INSTALL_DIR/oc"

# --- Add to PATH in shell rc ---
if [[ -n "${SHELL:-}" && "$(basename "$SHELL")" == "bash" ]]; then
  shell_rc="$HOME/.bashrc"
else
  shell_rc="$HOME/.zshrc"
fi

marker="# agent-session PATH"
touch "$shell_rc"

# Remove old agent-session markers.
tmp_file="$(mktemp)"
awk -v marker="$marker" '
  $0 == marker { getline; next }
  { print }
' "$shell_rc" > "$tmp_file"
mv "$tmp_file" "$shell_rc"

if [[ ":${PATH}:" != *":$INSTALL_DIR:"* ]]; then
  printf '\n%s\nexport PATH="%s:\$PATH"\n' "$marker" "$INSTALL_DIR" >> "$shell_rc"
  info "Added $INSTALL_DIR to PATH in $shell_rc"
fi

# --- Remove old JS aliases if present ---
js_markers=("# Claude Code session picker" "# Codex session picker" "# OpenCode session picker")
js_tmp="$(mktemp)"
awk_script=""
for m in "${js_markers[@]}"; do
  awk_script="${awk_script}  \$0 == \"${m}\" { getline; next }
"
done
awk "${awk_script}
{ print }" "$shell_rc" > "$js_tmp"
mv "$js_tmp" "$shell_rc"

available_aliases=""
if [[ "$has_claude" == true ]]; then
  available_aliases="cc"
fi
if [[ "$has_codex" == true ]]; then
  if [[ -n "$available_aliases" ]]; then
    available_aliases+=", "
  fi
  available_aliases+="cx"
fi
if [[ "$has_opencode" == true ]]; then
  if [[ -n "$available_aliases" ]]; then
    available_aliases+=", "
  fi
  available_aliases+="oc"
fi

info ""
info "Done! Run 'source $shell_rc' or open a new terminal, then use: $available_aliases"
info "Binary: $BINARY_PATH ($(du -h "$BINARY_PATH" | cut -f1))"
