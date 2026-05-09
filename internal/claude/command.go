package claude

import (
	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

// launchArgs returns CLI arguments for the given permission mode.
func launchArgs(permissionMode string) []string {
	mode := session.NormalizePermissionMode(permissionMode, nil)
	switch mode {
	case "auto":
		return []string{"--enable-auto-mode"}
	case "full":
		return []string{"--dangerously-skip-permissions"}
	default:
		return nil
	}
}

// selectedItemToCommand builds the launch command from a picker selection.
func selectedItemToCommand(itemType, sessionID, permissionMode, cwd string) (command string, args []string) {
	baseArgs := launchArgs(permissionMode)
	if itemType != "session" || sessionID == "" {
		return "claude", baseArgs
	}
	return "claude", append(baseArgs, "--resume", sessionID)
}

// buildClaudeCommand builds the launch command from a text choice.
func BuildClaudeCommand(sessions []provider.Session, choice, permissionMode string) (command string, args []string) {
	baseArgs := launchArgs(permissionMode)
	s := resolveSessionChoice(sessions, choice)
	if s == nil {
		return "claude", baseArgs
	}
	return "claude", append(baseArgs, "--resume", s.ID)
}
