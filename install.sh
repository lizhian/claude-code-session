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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_script="$script_dir/claude-sessions.js"
install_dir="$HOME/.claude-code-session"
installed_script="$install_dir/claude-sessions.js"
alias_line="alias cc='$installed_script --pick --trust-current-folder'"
marker="# Claude Code session picker"

[[ -f "$source_script" ]] || fail "claude-sessions.js was not found next to install.sh."

if [[ -n "${SHELL:-}" && "$(basename "$SHELL")" == "bash" ]]; then
  shell_rc="$HOME/.bashrc"
else
  shell_rc="$HOME/.zshrc"
fi

mkdir -p "$install_dir"
cp "$source_script" "$installed_script"
chmod 755 "$installed_script"
touch "$shell_rc"

tmp_file="$(mktemp)"
awk -v marker="$marker" '
  $0 == marker {
    getline
    next
  }
  { print }
' "$shell_rc" > "$tmp_file"
mv "$tmp_file" "$shell_rc"

{
  printf '\n%s\n' "$marker"
  printf '%s\n' "$alias_line"
} >> "$shell_rc"

info "Installed claude-sessions.js to $installed_script"
info "Added alias cc to $shell_rc"
info "Run 'source $shell_rc' or open a new terminal, then use: cc"
