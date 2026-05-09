package codex

import (
	"github.com/lizhian/agent-session/internal/session"
)

// launchArgs returns CLI arguments for the given permission mode.
func launchArgs(permissionMode string) []string {
	mode := session.NormalizePermissionMode(permissionMode, nil)
	switch mode {
	case "auto":
		return []string{"--full-auto"}
	case "full":
		return []string{"--dangerously-bypass-approvals-and-sandbox"}
	default:
		return nil
	}
}
