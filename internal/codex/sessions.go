package codex

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

func defaultCodexHome() string {
	if env := os.Getenv("CODEX_HOME"); env != "" {
		return env
	}
	return filepath.Join(session.HomeDir(), ".codex")
}

// collectJSONLFiles recursively finds all .jsonl files under rootDir.
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

// codexSessionFiles returns all JSONL files from sessions/ and archived_sessions/.
func codexSessionFiles(codexHome string) []string {
	var files []string
	files = append(files, collectJSONLFiles(filepath.Join(codexHome, "sessions"))...)
	files = append(files, collectJSONLFiles(filepath.Join(codexHome, "archived_sessions"))...)
	return files
}

// textFromContent extracts text from a content field that can be a string or array.
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
				} else if m, ok := v["message"].(string); ok {
					parts = append(parts, m)
				}
			}
		}
		return strings.Join(parts, " ")
	default:
		return ""
	}
}

// promptTextFromRecord extracts the user prompt text from a Codex JSONL record.
func promptTextFromRecord(record map[string]interface{}) string {
	payload, _ := record["payload"].(map[string]interface{})
	if payload == nil {
		payload = map[string]interface{}{}
	}
	typ, _ := record["type"].(string)
	payloadType, _ := payload["type"].(string)

	if typ == "event_msg" && payloadType == "user_message" {
		if msg, ok := payload["message"]; ok {
			return textFromContent(msg)
		}
		if content, ok := payload["content"]; ok {
			return textFromContent(content)
		}
		if text, ok := payload["text"]; ok {
			return textFromContent(text)
		}
		return ""
	}

	if typ == "response_item" && payloadType == "message" {
		if role, _ := payload["role"].(string); role == "user" {
			return textFromContent(payload["content"])
		}
	}

	return ""
}

// transcriptMessageFromRecord extracts a transcript message from a Codex record.
func transcriptMessageFromRecord(record map[string]interface{}) *provider.TranscriptMessage {
	payload, _ := record["payload"].(map[string]interface{})
	if payload == nil {
		return nil
	}
	typ, _ := record["type"].(string)
	payloadType, _ := payload["type"].(string)
	ts := recordTimestamp(record)

	if typ == "event_msg" && payloadType == "user_message" {
		text := textFromContent(payload["message"])
		if text == "" {
			text = textFromContent(payload["content"])
		}
		if text == "" {
			text = textFromContent(payload["text"])
		}
		if text == "" {
			return nil
		}
		return &provider.TranscriptMessage{Role: "user", Timestamp: ts, Text: text}
	}

	if typ == "event_msg" && payloadType == "agent_message" {
		text := textFromContent(payload["message"])
		if text == "" {
			text = textFromContent(payload["content"])
		}
		if text == "" {
			text = textFromContent(payload["text"])
		}
		if text == "" {
			return nil
		}
		return &provider.TranscriptMessage{Role: "assistant", Timestamp: ts, Text: text}
	}

	if typ == "response_item" && payloadType == "message" {
		role, _ := payload["role"].(string)
		if role == "" {
			role = "message"
		}
		text := textFromContent(payload["content"])
		if text == "" {
			return nil
		}
		return &provider.TranscriptMessage{Role: role, Timestamp: ts, Text: text}
	}

	return nil
}

func recordTimestamp(record map[string]interface{}) string {
	if t, ok := record["timestamp"].(string); ok && t != "" {
		return t
	}
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		if t, ok := payload["timestamp"].(string); ok && t != "" {
			return t
		}
	}
	return ""
}

func recordPayload(record map[string]interface{}) map[string]interface{} {
	if payload, ok := record["payload"].(map[string]interface{}); ok {
		return payload
	}
	return map[string]interface{}{}
}

func recordSessionId(record map[string]interface{}) string {
	if id, ok := record["session_id"].(string); ok && id != "" {
		return id
	}
	if id, ok := record["sessionId"].(string); ok && id != "" {
		return id
	}
	payload := recordPayload(record)
	if id, ok := payload["id"].(string); ok && id != "" {
		return id
	}
	if id, ok := payload["session_id"].(string); ok && id != "" {
		return id
	}
	if id, ok := payload["sessionId"].(string); ok && id != "" {
		return id
	}
	return ""
}

func recordCwd(record map[string]interface{}) string {
	if cwd, ok := record["cwd"].(string); ok && cwd != "" {
		return cwd
	}
	payload := recordPayload(record)
	if cwd, ok := payload["cwd"].(string); ok && cwd != "" {
		return cwd
	}
	return ""
}

func recordVersion(record map[string]interface{}) string {
	if v, ok := record["version"].(string); ok && v != "" {
		return v
	}
	payload := recordPayload(record)
	if v, ok := payload["version"].(string); ok && v != "" {
		return v
	}
	if v, ok := payload["cli_version"].(string); ok && v != "" {
		return v
	}
	return ""
}

func sessionIdFromFile(file string) string {
	base := strings.TrimSuffix(filepath.Base(file), ".jsonl")
	// Try to extract UUID pattern.
	parts := strings.Split(base, "-")
	isUUID := len(parts) >= 5
	if isUUID {
		// Check if it looks like a UUID (8-4-4-4-12 hex).
		if len(base) >= 36 {
			return base[:36]
		}
	}
	return base
}

func summarizeSession(file string) provider.Session {
	result, err := session.ReadJSONLines(file)
	if err != nil {
		return provider.Session{File: file, ProjectDir: filepath.Dir(file)}
	}

	records := result.Records

	var timestamps []string
	for _, r := range records {
		if t := recordTimestamp(r); t != "" {
			timestamps = append(timestamps, t)
		}
	}

	firstRecord := map[string]interface{}{}
	lastRecord := map[string]interface{}{}
	if len(records) > 0 {
		firstRecord = records[0]
		lastRecord = records[len(records)-1]
	}

	var userMessages []string
	for _, r := range records {
		if text := promptTextFromRecord(r); text != "" {
			userMessages = append(userMessages, text)
		}
	}

	id := recordSessionId(firstRecord)
	if id == "" {
		id = recordSessionId(lastRecord)
	}
	if id == "" {
		id = sessionIdFromFile(file)
	}

	cwd := ""
	for _, r := range records {
		if c := recordCwd(r); c != "" {
			cwd = c
			break
		}
	}

	version := ""
	for _, r := range records {
		if v := recordVersion(r); v != "" {
			version = v
			break
		}
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
		ProjectDir:       filepath.Dir(file),
		Cwd:              cwd,
		GitBranch:        "",
		Version:          version,
		MessageCount:     len(records),
		ParseErrorCount:  result.ParseErrorCount,
		StartedAt:        startedAt,
		UpdatedAt:        updatedAt,
		FirstUserMessage: firstUserMessage,
		LastUserMessage:  lastUserMessage,
	}
}

// dedupeTranscriptMessages removes duplicate user messages.
func dedupeTranscriptMessages(messages []provider.TranscriptMessage) []provider.TranscriptMessage {
	seen := make(map[string]bool)
	var result []provider.TranscriptMessage
	for _, msg := range messages {
		if strings.ToLower(msg.Role) != "user" {
			result = append(result, msg)
			continue
		}
		key := msg.Timestamp + "\x00" + strings.TrimSpace(msg.Text)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, msg)
	}
	return result
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
	return session.NormalizeTranscriptMessages(dedupeTranscriptMessages(messages), 0, 0)
}

// resolveSessionChoice picks a session by 1-based numeric index.
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

func listSessions(cwd, codexHome string) []provider.Session {
	cwd = filepath.Clean(cwd)
	var filtered []provider.Session
	for _, file := range codexSessionFiles(codexHome) {
		s := summarizeSession(file)
		if s.Cwd != "" && filepath.Clean(s.Cwd) == cwd {
			filtered = append(filtered, s)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].UpdatedAt > filtered[j].UpdatedAt
	})
	return filtered
}

func listWorkspaces(codexHome string) []provider.Workspace {
	sessionsByCwd := make(map[string][]provider.Session)
	for _, file := range codexSessionFiles(codexHome) {
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
