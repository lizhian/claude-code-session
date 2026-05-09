package codex

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// SyncResult holds the result of a codex-threadripper sync attempt.
type SyncResult struct {
	Skipped bool   // true if codex-threadripper was not found
	Synced  bool   // true if sync succeeded
	Error   string // error message if sync failed
}

// syncCodexThreads runs codex-threadripper to sync threads after a provider switch.
// If codex-threadripper is not found, it returns {Skipped: true}.
func syncCodexThreads(providerName, codexHome, cwd string) SyncResult {
	cmd := "codex-threadripper"

	// Check if command exists.
	if _, err := exec.LookPath(cmd); err != nil {
		return SyncResult{Skipped: true}
	}

	dataHome, _ := filepath.Abs(codexHome)
	args := []string{"--codex-home", dataHome, "--provider", providerName, "sync"}

	execCmd := exec.Command(cmd, args...)
	if cwd != "" {
		execCmd.Dir = cwd
	}
	execCmd.Env = append(os.Environ(), "CODEX_HOME="+dataHome)

	output, err := execCmd.CombinedOutput()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			reason := firstOutputLine(string(output))
			if reason == "" {
				reason = fmt.Sprintf("exit %d", exitErr.ExitCode())
			}
			return SyncResult{Error: truncateStatus(reason)}
		}
		return SyncResult{Error: truncateStatus(err.Error())}
	}

	return SyncResult{Synced: true}
}

// firstOutputLine returns the first non-empty trimmed line of output.
func firstOutputLine(value string) string {
	for _, line := range strings.Split(value, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// truncateStatus truncates a status string to maxLength.
func truncateStatus(value string, maxLength ...int) string {
	ml := 120
	if len(maxLength) > 0 {
		ml = maxLength[0]
	}
	text := strings.TrimSpace(strings.ReplaceAll(value, "\n", " "))
	text = strings.Join(strings.Fields(text), " ")
	if len(text) <= ml {
		return text
	}
	return text[:ml-3] + "..."
}
