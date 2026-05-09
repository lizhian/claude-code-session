package claude

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func TestLoadSessionTranscriptPreservesOrdinal(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "session.jsonl")
	data := `{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"first"}}
{"type":"user","timestamp":"2026-01-01T00:01:00Z","message":{"role":"user","content":"second"}}
`
	if err := os.WriteFile(file, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}

	p := New()
	messages := p.LoadSessionTranscript(provider.Session{File: file}, provider.Context{})
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].Ordinal != 1 || messages[1].Ordinal != 2 {
		t.Fatalf("ordinals = %d, %d; want 1, 2", messages[0].Ordinal, messages[1].Ordinal)
	}
}
