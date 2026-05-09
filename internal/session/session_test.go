package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReadJSONLines(t *testing.T) {
	t.Run("parses valid JSONL", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "test.jsonl")
		content := `{"sessionId":"abc","timestamp":"2025-01-01T00:00:00Z"}
{"sessionId":"def","timestamp":"2025-01-02T00:00:00Z"}
`
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}

		result, err := ReadJSONLines(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Records) != 2 {
			t.Fatalf("expected 2 records, got %d", len(result.Records))
		}
		if result.ParseErrorCount != 0 {
			t.Fatalf("expected 0 parse errors, got %d", result.ParseErrorCount)
		}
		if result.Records[0]["sessionId"] != "abc" {
			t.Errorf("expected first sessionId=abc, got %v", result.Records[0]["sessionId"])
		}
	})

	t.Run("counts malformed lines", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "test.jsonl")
		content := `{"ok":true}
{bad json}
{"also":"ok"}

`
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}

		result, err := ReadJSONLines(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Records) != 2 {
			t.Fatalf("expected 2 records, got %d", len(result.Records))
		}
		if result.ParseErrorCount != 1 {
			t.Fatalf("expected 1 parse error, got %d", result.ParseErrorCount)
		}
	})

	t.Run("returns error for missing file", func(t *testing.T) {
		_, err := ReadJSONLines("/nonexistent/file.jsonl")
		if err == nil {
			t.Fatal("expected error for missing file")
		}
	})

	t.Run("handles empty file", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "empty.jsonl")
		if err := os.WriteFile(path, []byte(""), 0o644); err != nil {
			t.Fatal(err)
		}

		result, err := ReadJSONLines(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Records) != 0 {
			t.Fatalf("expected 0 records, got %d", len(result.Records))
		}
		if result.ParseErrorCount != 0 {
			t.Fatalf("expected 0 parse errors, got %d", result.ParseErrorCount)
		}
	})

	t.Run("handles file with only blank lines", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "blank.jsonl")
		if err := os.WriteFile(path, []byte("\n\n\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		result, err := ReadJSONLines(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Records) != 0 {
			t.Fatalf("expected 0 records, got %d", len(result.Records))
		}
	})
}

func TestReadConfig(t *testing.T) {
	t.Run("returns empty map for missing file", func(t *testing.T) {
		config := ReadConfig("/nonexistent/config.json")
		if len(config) != 0 {
			t.Fatalf("expected empty map, got %v", config)
		}
	})

	t.Run("reads valid JSON config", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "config.json")
		content := `{"permissionModeSelected": "full"}`
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}

		config := ReadConfig(path)
		if config["permissionModeSelected"] != "full" {
			t.Errorf("expected permissionModeSelected=full, got %v", config["permissionModeSelected"])
		}
	})

	t.Run("returns empty map for invalid JSON", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "config.json")
		if err := os.WriteFile(path, []byte("not json"), 0o644); err != nil {
			t.Fatal(err)
		}

		config := ReadConfig(path)
		if len(config) != 0 {
			t.Fatalf("expected empty map for invalid JSON, got %v", config)
		}
	})
}

func TestWriteConfig(t *testing.T) {
	t.Run("writes config and creates parent dirs", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "sub", "dir", "config.json")
		config := map[string]interface{}{"mode": "auto"}

		if err := WriteConfig(config, path); err != nil {
			t.Fatal(err)
		}

		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}

		var result map[string]interface{}
		if err := json.Unmarshal(data, &result); err != nil {
			t.Fatal(err)
		}
		if result["mode"] != "auto" {
			t.Errorf("expected mode=auto, got %v", result["mode"])
		}
	})

	t.Run("file has 0600 permissions", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "config.json")
		config := map[string]interface{}{"key": "value"}

		if err := WriteConfig(config, path); err != nil {
			t.Fatal(err)
		}

		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		perm := info.Mode().Perm()
		if perm != 0o600 {
			t.Errorf("expected 0600 permissions, got %o", perm)
		}
	})
}

func TestNormalizePermissionMode(t *testing.T) {
	tests := []struct {
		name      string
		mode      string
		supported []string
		want      string
	}{
		{"empty returns default", "", nil, "default"},
		{"default passes through", "default", nil, "default"},
		{"auto passes through", "auto", nil, "auto"},
		{"full passes through", "full", nil, "full"},
		{"trust maps to full", "trust", nil, "full"},
		{"normal maps to default", "normal", nil, "default"},
		{"unknown returns default", "unknown", nil, "default"},
		{"OpenCode: auto not supported", "auto", OpenCodePermissionModes, "default"},
		{"OpenCode: full supported", "full", OpenCodePermissionModes, "full"},
		{"OpenCode: default supported", "default", OpenCodePermissionModes, "default"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizePermissionMode(tt.mode, tt.supported)
			if got != tt.want {
				t.Errorf("NormalizePermissionMode(%q, %v) = %q, want %q",
					tt.mode, tt.supported, got, tt.want)
			}
		})
	}
}

func TestNextPermissionMode(t *testing.T) {
	tests := []struct {
		name      string
		current   string
		supported []string
		want      string
	}{
		{"default -> auto", "default", nil, "auto"},
		{"auto -> full", "auto", nil, "full"},
		{"full wraps to default", "full", nil, "default"},
		{"OpenCode: default -> full", "default", OpenCodePermissionModes, "full"},
		{"OpenCode: full wraps to default", "full", OpenCodePermissionModes, "default"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NextPermissionMode(tt.current, tt.supported)
			if got != tt.want {
				t.Errorf("NextPermissionMode(%q, %v) = %q, want %q",
					tt.current, tt.supported, got, tt.want)
			}
		})
	}
}

func TestSupportedPermissionModes(t *testing.T) {
	tests := []struct {
		name       string
		candidates []string
		want       []string
	}{
		{"all valid", []string{"default", "auto", "full"}, []string{"default", "auto", "full"}},
		{"partial valid", []string{"default", "full"}, []string{"default", "full"}},
		{"empty returns defaults", nil, DefaultPermissionModes},
		{"invalid returns defaults", []string{"custom"}, DefaultPermissionModes},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SupportedPermissionModes(tt.candidates)
			if len(got) != len(tt.want) {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("index %d: expected %q, got %q", i, tt.want[i], got[i])
				}
			}
		})
	}
}

func TestEncodeProjectPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{"simple path", "/home/user/project", "-home-user-project"},
		{"dots and dashes preserved", "/a-b.c/d_e", "-a-b.c-d_e"},
		{"special chars replaced", "/hello world!", "-hello-world-"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EncodeProjectPath(tt.path)
			if got != tt.want {
				t.Errorf("EncodeProjectPath(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestSearchTerms(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  []string
	}{
		{"empty", "", nil},
		{"whitespace only", "   ", nil},
		{"single word", "hello", []string{"hello"}},
		{"multiple words", "hello world", []string{"hello", "world"}},
		{"extra spaces", "  a   b  ", []string{"a", "b"}},
		{"lowercased", "Hello WORLD", []string{"hello", "world"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SearchTerms(tt.query)
			if len(got) != len(tt.want) {
				t.Fatalf("SearchTerms(%q) = %v, want %v", tt.query, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("index %d: got %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestMatchSearch(t *testing.T) {
	tests := []struct {
		name  string
		text  string
		terms []string
		want  bool
	}{
		{"empty terms match", "anything", nil, true},
		{"single match", "hello world", []string{"hello"}, true},
		{"single no match", "hello world", []string{"xyz"}, false},
		{"all match", "hello world foo", []string{"hello", "foo"}, true},
		{"partial no match", "hello world", []string{"hello", "xyz"}, false},
		{"case insensitive", "Hello WORLD", []string{"hello", "world"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MatchSearch(tt.text, tt.terms)
			if got != tt.want {
				t.Errorf("MatchSearch(%q, %v) = %v, want %v", tt.text, tt.terms, got, tt.want)
			}
		})
	}
}
