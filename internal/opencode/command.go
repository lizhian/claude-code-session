package opencode

import (
	"github.com/lizhian/agent-session/internal/session"
)

// launchArgs returns CLI arguments for the given permission mode.
// OpenCode has no permission CLI flags.
func launchArgs(permissionMode string) []string {
	return nil
}

// launchEnv returns environment variables for the given permission mode.
func launchEnv(permissionMode string) map[string]string {
	mode := session.NormalizePermissionMode(permissionMode, session.OpenCodePermissionModes)
	if mode == "full" {
		return map[string]string{"OPENCODE_PERMISSION": "\"allow\""}
	}
	return nil
}
