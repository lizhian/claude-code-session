#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

info() {
  printf '%s\n' "$1"
}

command -v node >/dev/null 2>&1 || fail "node is required but was not found in PATH."
command -v claude >/dev/null 2>&1 || fail "claude is required but was not found in PATH."
command -v codex >/dev/null 2>&1 || printf 'Warning: codex was not found in PATH. The cx alias is installed but requires Codex CLI.\n' >&2

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_script="$script_dir/claude-sessions.js"
codex_source_script="$script_dir/codex-sessions.js"
install_dir="$HOME/.claude-code-session"
codex_install_dir="$HOME/.codex-code-session"
installed_script="$install_dir/claude-sessions.js"
codex_installed_script="$codex_install_dir/codex-sessions.js"
codex_support_script="$codex_install_dir/claude-sessions.js"
alias_line="alias cc='$installed_script --pick --trust-current-folder'"
codex_alias_line="alias cx='$codex_installed_script --pick --trust-current-folder'"
marker="# Claude Code session picker"
codex_marker="# Codex session picker"

[[ -f "$source_script" ]] || fail "claude-sessions.js was not found next to install.sh."
[[ -f "$codex_source_script" ]] || fail "codex-sessions.js was not found next to install.sh."

if [[ -n "${SHELL:-}" && "$(basename "$SHELL")" == "bash" ]]; then
  shell_rc="$HOME/.bashrc"
else
  shell_rc="$HOME/.zshrc"
fi

mkdir -p "$install_dir"
mkdir -p "$codex_install_dir"
cp "$source_script" "$installed_script"
cp "$codex_source_script" "$codex_installed_script"
cp "$source_script" "$codex_support_script"
chmod 755 "$installed_script"
chmod 755 "$codex_installed_script"
chmod 755 "$codex_support_script"
touch "$shell_rc"

tmp_file="$(mktemp)"
awk -v marker="$marker" -v codex_marker="$codex_marker" '
  $0 == marker || $0 == codex_marker {
    getline
    next
  }
  { print }
' "$shell_rc" > "$tmp_file"
mv "$tmp_file" "$shell_rc"

{
  printf '\n%s\n' "$marker"
  printf '%s\n' "$alias_line"
  printf '\n%s\n' "$codex_marker"
  printf '%s\n' "$codex_alias_line"
} >> "$shell_rc"

info "Installed claude-sessions.js to $installed_script"
info "Installed codex-sessions.js to $codex_installed_script"
info "Added alias cc to $shell_rc"
info "Added alias cx to $shell_rc"
info "Run 'source $shell_rc' or open a new terminal, then use: cc or cx"
