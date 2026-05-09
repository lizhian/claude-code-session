package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const usageText = `agent-session - Interactive session pickers for Claude Code, Codex, and OpenCode

Usage:
  agent-session <command> [options]

Commands:
  cc    Claude Code session picker
  cx    Codex session picker
  oc    OpenCode session picker

Options:
  --json                       Output JSON for scripting
  --pick                       Interactive session picker
  --trust-current-folder       Mark current directory as trusted
  --cwd <path>                 Project directory (default: current directory)
  -h, --help                   Show help

When invoked as cc, cx, or oc (via symlink), the corresponding provider runs directly.
`

func main() {
	bin := filepath.Base(os.Args[0])
	args := os.Args[1:]

	// Normalize the binary name: strip possible .exe suffix on Windows.
	bin = trimExt(bin)

	var providerName string
	switch bin {
	case "cc", "claude-code-session":
		providerName = "claude"
	case "cx", "codex-code-session":
		providerName = "codex"
	case "oc", "opencode-code-session":
		providerName = "opencode"
	default:
		// Dispatch via first argument.
		if len(args) == 0 {
			fmt.Print(usageText)
			os.Exit(0)
		}
		switch args[0] {
		case "cc", "claude":
			providerName = "claude"
		case "cx", "codex":
			providerName = "codex"
		case "oc", "opencode":
			providerName = "opencode"
		case "-h", "--help", "help":
			fmt.Print(usageText)
			os.Exit(0)
		default:
			fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n%s", args[0], usageText)
			os.Exit(1)
		}
		args = args[1:]
	}

	if len(args) > 0 && (args[0] == "-h" || args[0] == "--help") {
		switch providerName {
		case "claude":
			fmt.Print(claudeUsage())
		case "codex":
			fmt.Print(codexUsage())
		case "opencode":
			fmt.Print(opencodeUsage())
		}
		os.Exit(0)
	}

	if err := run(providerName, args); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err)
		os.Exit(1)
	}
}

func trimExt(name string) string {
	ext := filepath.Ext(name)
	if ext != "" {
		return name[:len(name)-len(ext)]
	}
	return name
}

func run(providerName string, args []string) error {
	switch providerName {
	case "claude":
		return runClaude(args)
	case "codex":
		return runCodex(args)
	case "opencode":
		return runOpenCode(args)
	default:
		return fmt.Errorf("unknown provider: %s", providerName)
	}
}

// Placeholder functions — will be replaced by real provider implementations.
func runClaude(args []string) error {
	return fmt.Errorf("Claude Code provider not yet implemented (Phase 2)")
}

func runCodex(args []string) error {
	return fmt.Errorf("Codex provider not yet implemented (Phase 3)")
}

func runOpenCode(args []string) error {
	return fmt.Errorf("OpenCode provider not yet implemented (Phase 4)")
}

func claudeUsage() string {
	return `Usage: cc [options]

Claude Code session picker.

Options:
  --json                       Output JSON for scripting
  --pick                       Interactive session picker
  --trust-current-folder       Mark current directory as trusted
  --cwd <path>                 Project directory (default: current directory)
  --claude-home <path>         Claude config directory (default: ~/.claude or CLAUDE_HOME)
  -h, --help                   Show help
`
}

func codexUsage() string {
	return `Usage: cx [options]

Codex session picker.

Options:
  --json                       Output JSON for scripting
  --pick                       Interactive session picker
  --trust-current-folder       Mark current directory as trusted
  --cwd <path>                 Project directory (default: current directory)
  --codex-home <path>          Codex config directory (default: ~/.codex or CODEX_HOME)
  -h, --help                   Show help
`
}

func opencodeUsage() string {
	return `Usage: oc [options]

OpenCode session picker.

Options:
  --json                       Output JSON for scripting
  --pick                       Interactive session picker
  --trust-current-folder       Mark current directory as trusted
  --cwd <path>                 Project directory (default: current directory)
  --opencode-data-home <path>  OpenCode data directory (default: ~/.local/share/opencode)
  -h, --help                   Show help
`
}
