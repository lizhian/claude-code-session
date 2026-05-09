package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/lizhian/agent-session/internal/claude"
	"github.com/lizhian/agent-session/internal/codex"
	"github.com/lizhian/agent-session/internal/picker"
	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/render"
	"github.com/lizhian/agent-session/internal/session"
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

func runClaude(args []string) error {
	opts, err := claude.ParseArgs(args)
	if err != nil {
		return err
	}

	p := claude.New()
	cwd := opts["cwd"]
	home := session.ResolvePath(opts["claudeHome"], p.DefaultHome())
	ctx := provider.Context{Cwd: cwd, DataHome: home, HomeOptionName: p.HomeOptionName()}

	sessions := p.ListSessions(ctx)

	if opts["help"] == "true" {
		fmt.Print(claudeUsage())
		return nil
	}

	// --trust-current-folder (non-interactive).
	if opts["trustCurrentFolder"] == "true" && opts["pick"] != "true" && opts["json"] != "true" {
		if err := p.TrustCurrentFolder(cwd, ctx); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to trust folder: %s\n", err)
		}
	}

	// --json mode.
	if opts["json"] == "true" {
		payload := claude.JsonPayload(cwd, home, sessions)
		data, _ := json.MarshalIndent(payload, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	// --pick mode.
	if opts["pick"] == "true" {
		permissionMode := p.LoadPermissionMode(ctx)

		// Trust current folder if requested.
		if opts["trustCurrentFolder"] == "true" {
			if err := p.TrustCurrentFolder(cwd, ctx); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to trust folder: %s\n", err)
			}
		}

		m := picker.NewModel(p, sessions, cwd, permissionMode, 100, 24, true)
		pgm := tea.NewProgram(m, tea.WithAltScreen())
		resultModel, err := pgm.Run()
		if err != nil {
			return err
		}

		pm := resultModel.(picker.Model)
		if pm.Result() == nil {
			os.Exit(130)
			return nil
		}

		pickResult := pm.Result()
		cmd := p.SelectedItemToCommand(pickResult.Item, pickResult.PermissionMode, pickResult.Cwd)

		// Trust current folder after picking.
		if opts["trustCurrentFolder"] == "true" {
			_ = p.TrustCurrentFolder(pickResult.Cwd, ctx)
		}

		return session.RunCommand(cmd.Command, cmd.Args, cmd.Cwd, cmd.Env)
	}

	// Default: summary + session table.
	for _, line := range claude.SummaryLines(cwd, home, sessions) {
		fmt.Println(line)
	}
	fmt.Println()
	fmt.Println(render.FormatSessions(sessions, "Claude Code"))
	return nil
}

func runCodex(args []string) error {
	opts, err := codex.ParseArgs(args)
	if err != nil {
		return err
	}

	p := codex.New()
	cwd := opts["cwd"]
	home := session.ResolvePath(opts["codexHome"], p.DefaultHome())
	ctx := provider.Context{Cwd: cwd, DataHome: home, HomeOptionName: p.HomeOptionName()}

	sessions := p.ListSessions(ctx)

	if opts["help"] == "true" {
		fmt.Print(codexUsage())
		return nil
	}

	if opts["trustCurrentFolder"] == "true" && opts["pick"] != "true" && opts["json"] != "true" {
		if err := p.TrustCurrentFolder(cwd, ctx); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to trust folder: %s\n", err)
		}
	}

	if opts["json"] == "true" {
		payload := codex.JsonPayload(cwd, home, sessions)
		data, _ := json.MarshalIndent(payload, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	if opts["pick"] == "true" {
		permissionMode := p.LoadPermissionMode(ctx)
		if opts["trustCurrentFolder"] == "true" {
			_ = p.TrustCurrentFolder(cwd, ctx)
		}

		m := picker.NewModel(p, sessions, cwd, permissionMode, 100, 24, true)
		pgm := tea.NewProgram(m, tea.WithAltScreen())
		resultModel, err := pgm.Run()
		if err != nil {
			return err
		}

		pm := resultModel.(picker.Model)
		if pm.Result() == nil {
			os.Exit(130)
			return nil
		}

		pickResult := pm.Result()
		cmd := p.SelectedItemToCommand(pickResult.Item, pickResult.PermissionMode, pickResult.Cwd)
		if opts["trustCurrentFolder"] == "true" {
			_ = p.TrustCurrentFolder(pickResult.Cwd, ctx)
		}
		return session.RunCommand(cmd.Command, cmd.Args, cmd.Cwd, cmd.Env)
	}

	for _, line := range codex.SummaryLines(cwd, home, sessions) {
		fmt.Println(line)
	}
	fmt.Println()
	fmt.Println(render.FormatSessions(sessions, "Codex"))
	return nil
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

// pickItemFromInteractivePicker runs the interactive picker and returns the result.
// Used as a fallback for non-TTY mode.
func runNonInteractivePicker(p provider.Provider, sessions []provider.Session, opts map[string]string) error {
	fmt.Println(render.FormatPicker(sessions, time.Now()))
	fmt.Println()

	cwd := opts["cwd"]
	ctx := provider.Context{Cwd: cwd, DataHome: p.DefaultHome()}
	permissionMode := p.LoadPermissionMode(ctx)

	fmt.Print("选择 session 编号，直接回车创建 New session: ")
	var choice string
	fmt.Scanln(&choice)

	if opts["trustCurrentFolder"] == "true" {
		_ = p.TrustCurrentFolder(cwd, ctx)
	}

	// Build command from choice.
	switch pp := p.(type) {
	case *claude.ClaudeProvider:
		cmd, args := claude.BuildClaudeCommand(sessions, strings.TrimSpace(choice), permissionMode)
		return session.RunCommand(cmd, args, cwd, nil)
	default:
		_ = pp
		return fmt.Errorf("non-interactive picker not supported for this provider")
	}
}
