package pi

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

func defaultPiHome() string {
	if env := os.Getenv("PI_CODING_AGENT_DIR"); env != "" {
		return env
	}
	return filepath.Join(session.HomeDir(), ".pi", "agent")
}

func defaultPiSessionDir(piHome string) string {
	if env := os.Getenv("PI_CODING_AGENT_SESSION_DIR"); env != "" {
		return env
	}
	return filepath.Join(piHome, "sessions")
}

func piSessionFiles(sessionDir string) []string {
	return collectJSONLFiles(sessionDir)
}

func collectJSONLFiles(rootDir string) []string {
	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return nil
	}
	var files []string
	for _, entry := range entries {
		path := filepath.Join(rootDir, entry.Name())
		if entry.IsDir() {
			files = append(files, collectJSONLFiles(path)...)
		} else if strings.HasSuffix(entry.Name(), ".jsonl") {
			files = append(files, path)
		}
	}
	return files
}

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
				if typ, _ := v["type"].(string); typ != "" && typ != "text" {
					continue
				}
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

func recordMessage(record map[string]interface{}) map[string]interface{} {
	if msg, ok := record["message"].(map[string]interface{}); ok {
		return msg
	}
	return nil
}

func promptTextFromRecord(record map[string]interface{}) string {
	if typ, _ := record["type"].(string); typ != "message" {
		return ""
	}
	msg := recordMessage(record)
	if msg == nil {
		return ""
	}
	if role, _ := msg["role"].(string); role != "user" {
		return ""
	}
	return textFromContent(msg["content"])
}

func transcriptMessageFromRecord(record map[string]interface{}) *provider.TranscriptMessage {
	if typ, _ := record["type"].(string); typ != "message" {
		return nil
	}
	msg := recordMessage(record)
	if msg == nil {
		return nil
	}
	role, _ := msg["role"].(string)
	if role != "user" && role != "assistant" {
		return nil
	}
	text := textFromContent(msg["content"])
	if text == "" {
		return nil
	}
	return &provider.TranscriptMessage{Role: role, Timestamp: recordTimestamp(record), Text: text}
}

func recordTimestamp(record map[string]interface{}) string {
	if t, ok := record["timestamp"].(string); ok && t != "" {
		return t
	}
	if msg := recordMessage(record); msg != nil {
		if t, ok := msg["timestamp"].(string); ok && t != "" {
			return t
		}
	}
	return ""
}

func recordSessionID(record map[string]interface{}) string {
	if id, ok := record["id"].(string); ok && id != "" {
		return id
	}
	if id, ok := record["session_id"].(string); ok && id != "" {
		return id
	}
	if id, ok := record["sessionId"].(string); ok && id != "" {
		return id
	}
	return ""
}

func recordCwd(record map[string]interface{}) string {
	if cwd, ok := record["cwd"].(string); ok && cwd != "" {
		return cwd
	}
	return ""
}

func recordVersion(record map[string]interface{}) string {
	if v, ok := record["version"].(float64); ok {
		return fmt.Sprintf("%.0f", v)
	}
	if v, ok := record["version"].(string); ok && v != "" {
		return v
	}
	return ""
}

func sessionIDFromFile(file string) string {
	base := strings.TrimSuffix(filepath.Base(file), ".jsonl")
	if idx := strings.LastIndex(base, "_"); idx >= 0 && idx < len(base)-1 {
		return base[idx+1:]
	}
	return base
}

func summarizeSession(file string) provider.Session {
	result, err := session.ReadJSONLines(file)
	if err != nil {
		return provider.Session{File: file, ProjectDir: filepath.Dir(file)}
	}

	var timestamps []string
	var userMessages []string
	id := ""
	cwd := ""
	version := ""

	for _, r := range result.Records {
		if t := recordTimestamp(r); t != "" {
			timestamps = append(timestamps, t)
		}
		if id == "" {
			id = recordSessionID(r)
		}
		if cwd == "" {
			cwd = recordCwd(r)
		}
		if version == "" {
			version = recordVersion(r)
		}
		if text := promptTextFromRecord(r); text != "" {
			userMessages = append(userMessages, text)
		}
	}

	if id == "" {
		id = sessionIDFromFile(file)
	}

	startedAt := ""
	updatedAt := ""
	if len(timestamps) > 0 {
		startedAt = timestamps[0]
		updatedAt = timestamps[len(timestamps)-1]
	}

	firstUserMessage := ""
	lastUserMessage := ""
	if len(userMessages) > 0 {
		firstUserMessage = userMessages[0]
		lastUserMessage = userMessages[len(userMessages)-1]
	}

	return provider.Session{
		ID:               id,
		File:             file,
		ProjectDir:       filepath.Dir(file),
		Cwd:              cwd,
		Version:          version,
		MessageCount:     len(result.Records),
		ParseErrorCount:  result.ParseErrorCount,
		StartedAt:        startedAt,
		UpdatedAt:        updatedAt,
		FirstUserMessage: firstUserMessage,
		LastUserMessage:  lastUserMessage,
	}
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

func listSessions(cwd, sessionDir string) []provider.Session {
	cwd = filepath.Clean(cwd)
	var filtered []provider.Session
	for _, file := range piSessionFiles(sessionDir) {
		s := summarizeSession(file)
		if s.Cwd != "" && filepath.Clean(s.Cwd) == cwd {
			if s.MessageCount <= 1 && s.FirstUserMessage == "" && s.LastUserMessage == "" {
				continue
			}
			filtered = append(filtered, s)
		}
	}
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].UpdatedAt > filtered[j].UpdatedAt
	})
	return filtered
}

func listWorkspaces(sessionDir string) []provider.Workspace {
	sessionsByCwd := make(map[string][]provider.Session)
	for _, file := range piSessionFiles(sessionDir) {
		s := summarizeSession(file)
		if s.Cwd == "" {
			continue
		}
		cwd := filepath.Clean(s.Cwd)
		sessionsByCwd[cwd] = append(sessionsByCwd[cwd], s)
	}

	var workspaces []provider.Workspace
	for cwd, sessions := range sessionsByCwd {
		sort.Slice(sessions, func(i, j int) bool {
			return sessions[i].UpdatedAt > sessions[j].UpdatedAt
		})
		newest := sessions[0]
		first := sessions[len(sessions)-1]

		totalMessages := 0
		for _, s := range sessions {
			totalMessages += s.MessageCount
		}

		lastMsg := newest.LastUserMessage
		if lastMsg == "" {
			lastMsg = newest.FirstUserMessage
		}

		workspaces = append(workspaces, provider.Workspace{
			Cwd:              cwd,
			ProjectDir:       newest.ProjectDir,
			SessionCount:     len(sessions),
			MessageCount:     totalMessages,
			StartedAt:        first.StartedAt,
			UpdatedAt:        newest.UpdatedAt,
			FirstUserMessage: first.FirstUserMessage,
			LastUserMessage:  lastMsg,
		})
	}

	sort.Slice(workspaces, func(i, j int) bool {
		return workspaces[i].UpdatedAt > workspaces[j].UpdatedAt
	})
	return workspaces
}
