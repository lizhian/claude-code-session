package session

import (
	"os"
	"path/filepath"
	"strings"
)

// HomeDir returns the user's home directory.
func HomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return home
}

// ResolvePath resolves a path, using fallback if empty.
func ResolvePath(p, fallback string) string {
	if p != "" {
		return filepath.Clean(p)
	}
	return filepath.Clean(fallback)
}

// EncodeProjectPath converts a path to a safe directory name
// (replaces non-alphanumeric chars with dashes).
func EncodeProjectPath(cwd string) string {
	abs, err := filepath.Abs(cwd)
	if err != nil {
		abs = cwd
	}
	var b strings.Builder
	for _, r := range abs {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}

// FileExists returns true if the path exists and is not a directory.
func FileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// DirExists returns true if the path exists and is a directory.
func DirExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// SearchTerms splits a query into lowercase search terms.
func SearchTerms(query string) []string {
	trimmed := strings.TrimSpace(strings.ToLower(query))
	if trimmed == "" {
		return nil
	}
	parts := strings.Fields(trimmed)
	var result []string
	for _, p := range parts {
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// MatchSearch checks if all terms appear in the given text.
func MatchSearch(text string, terms []string) bool {
	lower := strings.ToLower(text)
	for _, term := range terms {
		if !strings.Contains(lower, term) {
			return false
		}
	}
	return true
}
