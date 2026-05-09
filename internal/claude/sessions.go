package claude

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

const defaultClaudeHomeSubdir = ".claude"

func defaultClaudeHome() string {
	if env := os.Getenv("CLAUDE_HOME"); env != "" {
		return env
	}
	return filepath.Join(session.HomeDir(), defaultClaudeHomeSubdir)
}

func encodeProjectPath(cwd string) string {
	return session.EncodeProjectPath(cwd)
}

// textFromContent extracts plain text from a content field that can be
// a string or an array of content parts.
func textFromContent(content interface{}) string {
	switch c := content.(type) {
	case string:
		return c
	case []interface{}:
		var parts []string
		for _, item := range c {
			switch v := item.(type) {
			case string:
				parts = append(parts, v)
			case map[string]interface{}:
				if t, ok := v["text"].(string); ok {
					parts = append(parts, t)
				}
			}
		}
		return strings.Join(parts, " ")
	default:
		return ""
	}
}

// promptTextFromRecord extracts the user prompt text from a JSONL record.
func promptTextFromRecord(record map[string]interface{}) string {
	// Handle "last-prompt" type.
	if record["type"] == "last-prompt" {
		if lp, ok := record["lastPrompt"].(string); ok {
			return lp
		}
		return ""
	}

	// Must be a user message.
	typ, _ := record["type"].(string)
	if typ != "user" {
		return ""
	}
	if isMeta, _ := record["isMeta"].(bool); isMeta {
		return ""
	}

	msg, ok := record["message"].(map[string]interface{})
	if !ok {
		return ""
	}
	if role, _ := msg["role"].(string); role != "user" {
		return ""
	}

	return textFromContent(msg["content"])
}

// transcriptMessageFromRecord extracts a transcript message from a JSONL record.
func transcriptMessageFromRecord(record map[string]interface{}) *provider.TranscriptMessage {
	msg, ok := record["message"].(map[string]interface{})
	if !ok {
		return nil
	}
	if msg == nil {
		return nil
	}

	role, _ := msg["role"].(string)
	if role == "" {
		if typ, _ := record["type"].(string); typ == "user" || typ == "assistant" {
			role = typ
		}
	}
	if role == "" {
		return nil
	}

	text := textFromContent(msg["content"])
	if text == "" {
		return nil
	}

	timestamp, _ := record["timestamp"].(string)
	return &provider.TranscriptMessage{
		Role:      role,
		Timestamp: timestamp,
		Text:      text,
	}
}

func summarizeSession(file, projectDir string) provider.Session {
	result, err := session.ReadJSONLines(file)
	if err != nil {
		return provider.Session{
			File:       file,
			ProjectDir: projectDir,
		}
	}

	records := result.Records

	// Extract timestamps.
	var timestamps []string
	for _, r := range records {
		if t, ok := r["timestamp"].(string); ok && t != "" {
			timestamps = append(timestamps, t)
		}
	}

	// Extract session metadata from first/last records.
	firstRecord := map[string]interface{}{}
	lastRecord := map[string]interface{}{}
	if len(records) > 0 {
		firstRecord = records[0]
		lastRecord = records[len(records)-1]
	}

	// Extract user messages.
	var userMessages []string
	for _, r := range records {
		if text := promptTextFromRecord(r); text != "" {
			userMessages = append(userMessages, text)
		}
	}

	// Session ID: from record or filename.
	id, _ := firstRecord["sessionId"].(string)
	if id == "" {
		id, _ = lastRecord["sessionId"].(string)
	}
	if id == "" {
		id = strings.TrimSuffix(filepath.Base(file), ".jsonl")
	}

	cwd, _ := firstRecord["cwd"].(string)
	if cwd == "" {
		cwd, _ = lastRecord["cwd"].(string)
	}
	gitBranch, _ := firstRecord["gitBranch"].(string)
	if gitBranch == "" {
		gitBranch, _ = lastRecord["gitBranch"].(string)
	}
	version, _ := firstRecord["version"].(string)
	if version == "" {
		version, _ = lastRecord["version"].(string)
	}

	startedAt := ""
	if len(timestamps) > 0 {
		startedAt = timestamps[0]
	}
	updatedAt := ""
	if len(timestamps) > 0 {
		updatedAt = timestamps[len(timestamps)-1]
	}

	firstUserMessage := ""
	if len(userMessages) > 0 {
		firstUserMessage = userMessages[0]
	}
	lastUserMessage := ""
	if len(userMessages) > 0 {
		lastUserMessage = userMessages[len(userMessages)-1]
	}

	return provider.Session{
		ID:               id,
		File:             file,
		ProjectDir:       projectDir,
		Cwd:              cwd,
		GitBranch:        gitBranch,
		Version:          version,
		MessageCount:     len(records),
		ParseErrorCount:  result.ParseErrorCount,
		StartedAt:        startedAt,
		UpdatedAt:        updatedAt,
		FirstUserMessage: firstUserMessage,
		LastUserMessage:  lastUserMessage,
	}
}

func listSessions(cwd, claudeHome string) []provider.Session {
	projectDir := filepath.Join(claudeHome, "projects", encodeProjectPath(cwd))
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil
	}

	var sessions []provider.Session
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		sessions = append(sessions, summarizeSession(filepath.Join(projectDir, entry.Name()), projectDir))
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt > sessions[j].UpdatedAt
	})

	// Filter out empty sessions: only an init record with no user messages.
	filtered := make([]provider.Session, 0, len(sessions))
	for _, s := range sessions {
		if s.MessageCount <= 1 && s.FirstUserMessage == "" && s.LastUserMessage == "" {
			continue
		}
		filtered = append(filtered, s)
	}
	return filtered
}

func listProjectSessions(projectDir string) []provider.Session {
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil
	}

	var sessions []provider.Session
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		sessions = append(sessions, summarizeSession(filepath.Join(projectDir, entry.Name()), projectDir))
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt > sessions[j].UpdatedAt
	})

	filtered := make([]provider.Session, 0, len(sessions))
	for _, s := range sessions {
		if s.MessageCount <= 1 && s.FirstUserMessage == "" && s.LastUserMessage == "" {
			continue
		}
		filtered = append(filtered, s)
	}
	return filtered
}

func summarizeWorkspace(projectDir string) *provider.Workspace {
	sessions := listProjectSessions(projectDir)
	if len(sessions) == 0 {
		return nil
	}

	newest := sessions[0]
	first := sessions[len(sessions)-1]

	cwd := newest.Cwd
	if cwd == "" {
		for _, s := range sessions {
			if s.Cwd != "" {
				cwd = s.Cwd
				break
			}
		}
	}
	if cwd == "" {
		cwd = projectDir
	}

	totalMessages := 0
	for _, s := range sessions {
		totalMessages += s.MessageCount
	}

	return &provider.Workspace{
		Cwd:              cwd,
		ProjectDir:       projectDir,
		SessionCount:     len(sessions),
		MessageCount:     totalMessages,
		StartedAt:        first.StartedAt,
		UpdatedAt:        newest.UpdatedAt,
		FirstUserMessage: first.FirstUserMessage,
		LastUserMessage:  newest.LastUserMessage,
	}
}

func listWorkspaces(claudeHome string) []provider.Workspace {
	projectsDir := filepath.Join(claudeHome, "projects")
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil
	}

	var workspaces []provider.Workspace
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		ws := summarizeWorkspace(filepath.Join(projectsDir, entry.Name()))
		if ws != nil {
			workspaces = append(workspaces, *ws)
		}
	}

	sort.Slice(workspaces, func(i, j int) bool {
		return workspaces[i].UpdatedAt > workspaces[j].UpdatedAt
	})
	return workspaces
}

func loadSessionTranscript(s provider.Session) session.TranscriptResult {
	if s.File == "" {
		return session.NormalizeTranscriptMessages(nil, 0, 0)
	}
	result, err := session.ReadJSONLines(s.File)
	if err != nil {
		return session.NormalizeTranscriptMessages(nil, 0, 0)
	}

	var messages []provider.TranscriptMessage
	for _, r := range result.Records {
		if msg := transcriptMessageFromRecord(r); msg != nil {
			messages = append(messages, *msg)
		}
	}
	return session.NormalizeTranscriptMessages(messages, 0, 0)
}

// resolveSessionChoice picks a session by 1-based numeric index or returns nil for "new".
func resolveSessionChoice(sessions []provider.Session, choice string) *provider.Session {
	choice = strings.TrimSpace(choice)
	if choice == "" || choice == "0" {
		return nil
	}
	var idx int
	if _, err := fmt.Sscanf(choice, "%d", &idx); err != nil || idx < 1 || idx > len(sessions) {
		return nil
	}
	return &sessions[idx-1]
}
