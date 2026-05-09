package opencode

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

func defaultOpenCodeDataHome() string {
	if env := os.Getenv("OPENCODE_DATA_HOME"); env != "" {
		return env
	}
	return filepath.Join(session.HomeDir(), ".local", "share", "opencode")
}

func openCodeDbPath(dataHome string) string {
	return filepath.Join(dataHome, "opencode.db")
}

func timestampFromMs(value interface{}) string {
	var ms float64
	switch v := value.(type) {
	case int64:
		ms = float64(v)
	case float64:
		ms = v
	case string:
		fmt.Sscanf(v, "%f", &ms)
	default:
		return ""
	}
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(int64(ms)).UTC().Format(time.RFC3339Nano)
}

func sqlString(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

type sessionRow struct {
	ID               string
	Cwd              string
	Title            string
	Version          string
	ProjectDir       string
	StartedMs        int64
	UpdatedMs        int64
	MessageCount     int
	FirstUserMessage string
	LastUserMessage  string
}

func sessionRows(dbPath string) ([]sessionRow, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open OpenCode database: %w", err)
	}
	defer db.Close()

	query := `
with user_parts as (
  select
    p.session_id,
    json_extract(p.data, '$.text') as text,
    p.time_created,
    row_number() over (partition by p.session_id order by p.time_created asc, p.id asc) as first_rank,
    row_number() over (partition by p.session_id order by p.time_created desc, p.id desc) as last_rank
  from part p
  join message m on m.id = p.message_id
  where json_extract(m.data, '$.role') = 'user'
    and json_extract(p.data, '$.type') = 'text'
    and json_extract(p.data, '$.text') is not null
),
message_counts as (
  select session_id, count(*) as message_count
  from message
  group by session_id
)
select
  s.id,
  s.directory as cwd,
  s.title,
  s.version,
  s.project_id as projectDir,
  s.time_created as startedMs,
  s.time_updated as updatedMs,
  coalesce(mc.message_count, 0) as messageCount,
  coalesce(first_parts.text, '') as firstUserMessage,
  coalesce(last_parts.text, '') as lastUserMessage
from session s
left join message_counts mc on mc.session_id = s.id
left join user_parts first_parts on first_parts.session_id = s.id and first_parts.first_rank = 1
left join user_parts last_parts on last_parts.session_id = s.id and last_parts.last_rank = 1
order by s.time_updated desc, s.id desc;`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query OpenCode sessions: %w", err)
	}
	defer rows.Close()

	var result []sessionRow
	for rows.Next() {
		var r sessionRow
		var startedMs, updatedMs sql.NullInt64
		var messageCount int
		if err := rows.Scan(
			&r.ID, &r.Cwd, &r.Title, &r.Version, &r.ProjectDir,
			&startedMs, &updatedMs, &messageCount,
			&r.FirstUserMessage, &r.LastUserMessage,
		); err != nil {
			return nil, fmt.Errorf("failed to scan OpenCode session row: %w", err)
		}
		if startedMs.Valid {
			r.StartedMs = startedMs.Int64
		}
		if updatedMs.Valid {
			r.UpdatedMs = updatedMs.Int64
		}
		r.MessageCount = messageCount
		result = append(result, r)
	}
	return result, rows.Err()
}

func summarizeSession(row sessionRow, dbPath string) provider.Session {
	startedAt := timestampFromMs(row.StartedMs)
	updatedAt := timestampFromMs(row.UpdatedMs)
	firstMsg := row.FirstUserMessage
	if firstMsg == "" {
		firstMsg = row.Title
	}
	lastMsg := row.LastUserMessage
	if lastMsg == "" {
		lastMsg = row.FirstUserMessage
	}
	if lastMsg == "" {
		lastMsg = row.Title
	}

	return provider.Session{
		ID:               row.ID,
		File:             dbPath,
		ProjectDir:       row.ProjectDir,
		Cwd:              row.Cwd,
		GitBranch:        "",
		Version:          row.Version,
		MessageCount:     row.MessageCount,
		ParseErrorCount:  0,
		StartedAt:        startedAt,
		UpdatedAt:        updatedAt,
		FirstUserMessage: firstMsg,
		LastUserMessage:  lastMsg,
	}
}

type transcriptRow struct {
	Role      string
	Text      string
	CreatedMs int64
}

func loadSessionTranscript(session provider.Session) ([]provider.TranscriptMessage, error) {
	if session.File == "" || session.ID == "" {
		return nil, nil
	}

	db, err := sql.Open("sqlite", session.File)
	if err != nil {
		return nil, fmt.Errorf("failed to open OpenCode database: %w", err)
	}
	defer db.Close()

	query := fmt.Sprintf(`
select
  json_extract(m.data, '$.role') as role,
  json_extract(p.data, '$.text') as text,
  p.time_created as createdMs
from part p
join message m on m.id = p.message_id
where p.session_id = '%s'
  and json_extract(p.data, '$.type') = 'text'
  and json_extract(p.data, '$.text') is not null
order by p.time_created asc, p.id asc;`, sqlString(session.ID))

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query OpenCode transcript: %w", err)
	}
	defer rows.Close()

	var messages []provider.TranscriptMessage
	for rows.Next() {
		var role, text string
		var createdMs sql.NullInt64
		if err := rows.Scan(&role, &text, &createdMs); err != nil {
			return nil, fmt.Errorf("failed to scan transcript row: %w", err)
		}
		var ts string
		if createdMs.Valid {
			ts = timestampFromMs(createdMs.Int64)
		}
		messages = append(messages, provider.TranscriptMessage{
			Role:      role,
			Timestamp: ts,
			Text:      text,
		})
	}
	return messages, rows.Err()
}

func listSessions(cwd, dataHome string) []provider.Session {
	dbPath := openCodeDbPath(dataHome)
	if _, err := os.Stat(dbPath); err != nil {
		return nil
	}

	rows, err := sessionRows(dbPath)
	if err != nil {
		return nil
	}

	var filtered []provider.Session
	for _, row := range rows {
		s := summarizeSession(row, dbPath)
		if s.Cwd != "" && filepath.Clean(s.Cwd) == filepath.Clean(cwd) {
			filtered = append(filtered, s)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].UpdatedAt > filtered[j].UpdatedAt
	})
	return filtered
}

func listWorkspaces(dataHome string) []provider.Workspace {
	dbPath := openCodeDbPath(dataHome)
	if _, err := os.Stat(dbPath); err != nil {
		return nil
	}

	rows, err := sessionRows(dbPath)
	if err != nil {
		return nil
	}

	sessionsByCwd := make(map[string][]provider.Session)
	for _, row := range rows {
		s := summarizeSession(row, dbPath)
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
