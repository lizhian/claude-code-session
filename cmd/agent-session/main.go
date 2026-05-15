package main

import (
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/lizhian/agent-session/internal/claude"
	"github.com/lizhian/agent-session/internal/codex"
	"github.com/lizhian/agent-session/internal/opencode"
	"github.com/lizhian/agent-session/internal/pi"
	"github.com/lizhian/agent-session/internal/picker"
	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

const usageText = `agent-session - Interactive session pickers for Claude Code, Codex, OpenCode, and Pi Coding Agent

Usage:
  agent-session <command> [options]

Commands:
  c     Claude Code session picker
  cx    Codex session picker
  oc    OpenCode session picker
  p     Pi Coding Agent session picker

Options:
  --cwd <path>                 Project directory (default: current directory)
  -h, --help                   Show help

When invoked as c, cx, oc, or p (via symlink), the interactive picker opens by default.
Legacy compatibility: cc still dispatches to Claude Code.
`

func main() {
	args := os.Args[1:]

	providerName, args, showUsage, err := resolveProviderInvocation(filepath.Base(os.Args[0]), args)
	if showUsage {
		fmt.Print(usageText)
		os.Exit(0)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s\n\n%s", err, usageText)
		os.Exit(1)
	}

	if len(args) > 0 && (args[0] == "-h" || args[0] == "--help") {
		switch providerName {
		case "claude":
			fmt.Print(claudeUsage())
		case "codex":
			fmt.Print(codexUsage())
		case "opencode":
			fmt.Print(opencodeUsage())
		case "pi":
			fmt.Print(piUsage())
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

func resolveProviderInvocation(bin string, args []string) (providerName string, remainingArgs []string, showUsage bool, err error) {
	// Normalize the binary name: strip possible .exe suffix on Windows.
	switch trimExt(bin) {
	case "c", "cc", "claude-code-session":
		return "claude", args, false, nil
	case "cx", "codex-code-session":
		return "codex", args, false, nil
	case "oc", "opencode-code-session":
		return "opencode", args, false, nil
	case "p", "pi-code-session":
		return "pi", args, false, nil
	}

	if len(args) == 0 {
		return "", args, true, nil
	}

	switch args[0] {
	case "c", "cc", "claude":
		return "claude", args[1:], false, nil
	case "cx", "codex":
		return "codex", args[1:], false, nil
	case "oc", "opencode":
		return "opencode", args[1:], false, nil
	case "p", "pi":
		return "pi", args[1:], false, nil
	case "-h", "--help", "help":
		return "", args, true, nil
	default:
		return "", args, false, fmt.Errorf("Unknown command: %s", args[0])
	}
}

func run(providerName string, args []string) error {
	switch providerName {
	case "claude":
		return runClaude(args)
	case "codex":
		return runCodex(args)
	case "opencode":
		return runOpenCode(args)
	case "pi":
		return runPi(args)
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

	if opts["help"] == "true" {
		fmt.Print(claudeUsage())
		return nil
	}

	sessions := p.ListSessions(ctx)

	// Trust current folder.
	if err := p.TrustCurrentFolder(cwd, ctx); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to trust folder: %s\n", err)
	}

	// Interactive picker.
	permissionMode := p.LoadPermissionMode(ctx)
	m := picker.NewModel(p, sessions, cwd, permissionMode, 100, 24, true)
	pgm := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())
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
	_ = p.TrustCurrentFolder(pickResult.Cwd, ctx)

	return session.RunCommand(cmd.Command, cmd.Args, cmd.Cwd, cmd.Env)
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

	if opts["help"] == "true" {
		fmt.Print(codexUsage())
		return nil
	}

	sessions := p.ListSessions(ctx)

	// Trust current folder.
	_ = p.TrustCurrentFolder(cwd, ctx)

	// Interactive picker.
	permissionMode := p.LoadPermissionMode(ctx)
	m := picker.NewModel(p, sessions, cwd, permissionMode, 100, 24, true)
	pgm := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())
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
	_ = p.TrustCurrentFolder(pickResult.Cwd, ctx)
	return session.RunCommand(cmd.Command, cmd.Args, cmd.Cwd, cmd.Env)
}

func runOpenCode(args []string) error {
	opts, err := opencode.ParseArgs(args)
	if err != nil {
		return err
	}

	p := opencode.New()
	cwd := opts["cwd"]
	home := session.ResolvePath(opts["opencodeDataHome"], p.DefaultHome())
	ctx := provider.Context{Cwd: cwd, DataHome: home, HomeOptionName: p.HomeOptionName()}

	if opts["help"] == "true" {
		fmt.Print(opencodeUsage())
		return nil
	}

	sessions := p.ListSessions(ctx)

	// Interactive picker.
	permissionMode := p.LoadPermissionMode(ctx)
	m := picker.NewModel(p, sessions, cwd, permissionMode, 100, 24, true)
	pgm := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())
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
	return session.RunCommand(cmd.Command, cmd.Args, cmd.Cwd, cmd.Env)
}

func runPi(args []string) error {
	opts, err := pi.ParseArgs(args)
	if err != nil {
		return err
	}

	p := pi.NewWithPaths(opts["piHome"], opts["piSessionDir"])
	cwd := opts["cwd"]
	ctx := provider.Context{
		Cwd:            cwd,
		DataHome:       opts["piHome"],
		HomeOptionName: p.HomeOptionName(),
		Options:        map[string]string{"piSessionDir": opts["piSessionDir"]},
	}

	if opts["help"] == "true" {
		fmt.Print(piUsage())
		return nil
	}

	sessions := p.ListSessions(ctx)

	permissionMode := p.LoadPermissionMode(ctx)
	m := picker.NewModel(p, sessions, cwd, permissionMode, 100, 24, true)
	pgm := tea.NewProgram(m, tea.WithAltScreen(), tea.WithMouseCellMotion())
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
	return session.RunCommand(cmd.Command, cmd.Args, cmd.Cwd, cmd.Env)
}

func claudeUsage() string {
	return `Usage: c [options]

Claude Code session picker.

Options:
  --cwd <path>                 Project directory (default: current directory)
  --claude-home <path>         Claude config directory (default: ~/.claude or CLAUDE_HOME)
  -h, --help                   Show help
`
}

func codexUsage() string {
	return `Usage: cx [options]

Codex session picker.

Options:
  --cwd <path>                 Project directory (default: current directory)
  --codex-home <path>          Codex config directory (default: ~/.codex or CODEX_HOME)
  -h, --help                   Show help
`
}

func opencodeUsage() string {
	return `Usage: oc [options]

OpenCode session picker.

Options:
  --cwd <path>                 Project directory (default: current directory)
  --opencode-data-home <path>  OpenCode data directory (default: ~/.local/share/opencode)
  -h, --help                   Show help
`
}

func piUsage() string {
	return `Usage: p [options]

Pi Coding Agent session picker.

Options:
  --cwd <path>                 Project directory (default: current directory)
  --pi-home <path>             Pi Coding Agent config directory (default: ~/.pi/agent or PI_CODING_AGENT_DIR)
  --pi-session-dir <path>      Pi Coding Agent session directory (default: <pi-home>/sessions or PI_CODING_AGENT_SESSION_DIR)
  -h, --help                   Show help
`
}
