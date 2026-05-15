package pi

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func writeSessionFile(t *testing.T, dir, name, text string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	return path
}

func TestListSessionsParsesPiJSONL(t *testing.T) {
	sessionDir := t.TempDir()
	cwd := filepath.Join(t.TempDir(), "project")
	workspaceDir := filepath.Join(sessionDir, "--project--")
	file := writeSessionFile(t, workspaceDir, "2026-05-09T07-05-19-072Z_019e0b8e-0bdf-732f-869b-e1d45e94eaee.jsonl", `{"type":"session","version":3,"id":"019e0b8e-0bdf-732f-869b-e1d45e94eaee","timestamp":"2026-05-09T07:05:19.072Z","cwd":"`+cwd+`"}
{"type":"model_change","timestamp":"2026-05-09T07:05:19.104Z","provider":"test","modelId":"model"}
{"type":"message","timestamp":"2026-05-09T07:05:26.402Z","message":{"role":"user","content":[{"type":"text","text":"first prompt"}]}}
{"type":"message","timestamp":"2026-05-09T07:05:28.402Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hidden"},{"type":"text","text":"assistant answer"},{"type":"toolCall","name":"bash"}]}}
{"type":"message","timestamp":"2026-05-09T07:06:26.402Z","message":{"role":"user","content":[{"type":"text","text":"last prompt"}]}}
`)

	p := NewWithPaths(t.TempDir(), sessionDir)
	sessions := p.ListSessions(provider.Context{Cwd: cwd})
	if len(sessions) != 1 {
		t.Fatalf("ListSessions() len = %d, want 1", len(sessions))
	}
	got := sessions[0]
	if got.ID != "019e0b8e-0bdf-732f-869b-e1d45e94eaee" {
		t.Fatalf("ID = %q", got.ID)
	}
	if got.File != file {
		t.Fatalf("File = %q, want %q", got.File, file)
	}
	if got.Cwd != cwd {
		t.Fatalf("Cwd = %q, want %q", got.Cwd, cwd)
	}
	if got.Version != "3" {
		t.Fatalf("Version = %q, want 3", got.Version)
	}
	if got.MessageCount != 5 {
		t.Fatalf("MessageCount = %d, want 5", got.MessageCount)
	}
	if got.FirstUserMessage != "first prompt" || got.LastUserMessage != "last prompt" {
		t.Fatalf("user messages = %q/%q", got.FirstUserMessage, got.LastUserMessage)
	}

	transcript := p.LoadSessionTranscript(got, provider.Context{Cwd: cwd})
	if len(transcript) != 3 {
		t.Fatalf("transcript len = %d, want 3: %#v", len(transcript), transcript)
	}
	if transcript[1].Role != "assistant" || transcript[1].Text != "assistant answer" {
		t.Fatalf("assistant transcript = %#v", transcript[1])
	}
}

func TestListWorkspacesAggregatesPiSessions(t *testing.T) {
	sessionDir := t.TempDir()
	firstCwd := filepath.Join(t.TempDir(), "first")
	secondCwd := filepath.Join(t.TempDir(), "second")
	writeSessionFile(t, filepath.Join(sessionDir, "--first--"), "older_11111111-1111-1111-1111-111111111111.jsonl", `{"type":"session","id":"11111111-1111-1111-1111-111111111111","timestamp":"2026-05-09T07:00:00Z","cwd":"`+firstCwd+`"}
{"type":"message","timestamp":"2026-05-09T07:01:00Z","message":{"role":"user","content":[{"type":"text","text":"older first"}]}}
`)
	writeSessionFile(t, filepath.Join(sessionDir, "--first--"), "newer_22222222-2222-2222-2222-222222222222.jsonl", `{"type":"session","id":"22222222-2222-2222-2222-222222222222","timestamp":"2026-05-09T08:00:00Z","cwd":"`+firstCwd+`"}
{"type":"message","timestamp":"2026-05-09T08:01:00Z","message":{"role":"user","content":[{"type":"text","text":"newer first"}]}}
`)
	writeSessionFile(t, filepath.Join(sessionDir, "--second--"), "newest_33333333-3333-3333-3333-333333333333.jsonl", `{"type":"session","id":"33333333-3333-3333-3333-333333333333","timestamp":"2026-05-09T09:00:00Z","cwd":"`+secondCwd+`"}
{"type":"message","timestamp":"2026-05-09T09:01:00Z","message":{"role":"user","content":[{"type":"text","text":"second"}]}}
`)

	p := NewWithPaths(t.TempDir(), sessionDir)
	workspaces := p.ListWorkspaces(provider.Context{})
	if len(workspaces) != 2 {
		t.Fatalf("ListWorkspaces() len = %d, want 2", len(workspaces))
	}
	if workspaces[0].Cwd != secondCwd {
		t.Fatalf("newest workspace = %q, want %q", workspaces[0].Cwd, secondCwd)
	}
	if workspaces[1].Cwd != firstCwd {
		t.Fatalf("second workspace = %q, want %q", workspaces[1].Cwd, firstCwd)
	}
	if workspaces[1].SessionCount != 2 {
		t.Fatalf("SessionCount = %d, want 2", workspaces[1].SessionCount)
	}
	if workspaces[1].FirstUserMessage != "older first" || workspaces[1].LastUserMessage != "newer first" {
		t.Fatalf("workspace messages = %q/%q", workspaces[1].FirstUserMessage, workspaces[1].LastUserMessage)
	}
}

func TestSelectedItemToCommandUsesPiSessionFileAndSessionDir(t *testing.T) {
	sessionDir := t.TempDir()
	file := filepath.Join(sessionDir, "session.jsonl")
	p := NewWithPaths(t.TempDir(), sessionDir)

	cmd := p.SelectedItemToCommand(provider.PickItem{
		Type:    "session",
		Session: &provider.Session{File: file, ID: "abc"},
	}, "full", "/tmp/work")

	if cmd.Command != "pi" {
		t.Fatalf("Command = %q, want pi", cmd.Command)
	}
	wantArgs := []string{"--session-dir", sessionDir, "--session", file}
	if len(cmd.Args) != len(wantArgs) {
		t.Fatalf("Args = %#v, want %#v", cmd.Args, wantArgs)
	}
	for i := range wantArgs {
		if cmd.Args[i] != wantArgs[i] {
			t.Fatalf("Args = %#v, want %#v", cmd.Args, wantArgs)
		}
	}
	if cmd.Cwd != "/tmp/work" {
		t.Fatalf("Cwd = %q, want /tmp/work", cmd.Cwd)
	}
	if cmd.Env["PI_CODING_AGENT_DIR"] == "" {
		t.Fatalf("PI_CODING_AGENT_DIR env was not set")
	}

	newCmd := p.SelectedItemToCommand(provider.PickItem{Type: "new"}, "full", "/tmp/work")
	if len(newCmd.Args) != 2 || newCmd.Args[0] != "--session-dir" || newCmd.Args[1] != sessionDir {
		t.Fatalf("new Args = %#v", newCmd.Args)
	}
}

func TestParseArgsSupportsPiHomeAndSessionDir(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", "")
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", "")

	opts, err := ParseArgs([]string{"--cwd", ".", "--pi-home", "/tmp/pi-home"})
	if err != nil {
		t.Fatalf("ParseArgs() error = %v", err)
	}
	if opts["piHome"] != "/tmp/pi-home" {
		t.Fatalf("piHome = %q", opts["piHome"])
	}
	if opts["piSessionDir"] != "/tmp/pi-home/sessions" {
		t.Fatalf("piSessionDir = %q", opts["piSessionDir"])
	}

	opts, err = ParseArgs([]string{"--pi-home=/tmp/pi-home", "--pi-session-dir=/tmp/pi-sessions"})
	if err != nil {
		t.Fatalf("ParseArgs() error = %v", err)
	}
	if opts["piSessionDir"] != "/tmp/pi-sessions" {
		t.Fatalf("piSessionDir = %q", opts["piSessionDir"])
	}
}
