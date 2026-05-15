package codex

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// defaultCodexHome is provided by sessions.go in this package.
// No redeclaration needed.

func codexConfigPath(codexHome string) string {
	return filepath.Join(codexHome, "config.toml")
}

// parseTomlString parses a basic or literal TOML string.
func parseTomlString(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) >= 2 {
		if unquoted, err := strconv.Unquote(trimmed); err == nil {
			return unquoted
		}
		if strings.HasPrefix(trimmed, "'") && strings.HasSuffix(trimmed, "'") {
			return trimmed[1 : len(trimmed)-1]
		}
	}
	return trimmed
}

func parseTomlMultilineString(lines []string, start int, value string) (string, int, bool) {
	trimmed := strings.TrimSpace(value)
	quote := ""
	switch {
	case strings.HasPrefix(trimmed, "'''"):
		quote = "'''"
	case strings.HasPrefix(trimmed, `"""`):
		quote = `"""`
	default:
		return "", start, false
	}

	first := strings.TrimPrefix(trimmed, quote)
	if end := strings.Index(first, quote); end >= 0 {
		return first[:end], start, true
	}

	content := []string{}
	if first != "" {
		content = append(content, first)
	}
	for i := start + 1; i < len(lines); i++ {
		line := lines[i]
		if end := strings.Index(line, quote); end >= 0 {
			if line[:end] != "" {
				content = append(content, line[:end])
			}
			return strings.Join(content, "\n"), i, true
		}
		content = append(content, line)
	}
	return "", start, false
}

var tableRe = regexp.MustCompile(`^\s*\[(.+)]\s*$`)

// parseTableName extracts a provider name from a [model_providers.XXX] header.
func parseTableName(line string) string {
	match := tableRe.FindStringSubmatch(line)
	if match == nil {
		return ""
	}
	raw := strings.TrimSpace(match[1])
	if !strings.HasPrefix(raw, "model_providers.") {
		return ""
	}
	name := strings.TrimPrefix(raw, "model_providers.")
	return parseTomlString(strings.TrimSpace(name))
}

// parseTopLevelStringField finds a top-level key=value field in TOML text.
func parseTopLevelStringField(text, fieldName string) string {
	lines := strings.Split(text, "\n")
	topLevelEnd := len(lines)
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "[") {
			topLevelEnd = i
			break
		}
	}

	pattern := regexp.MustCompile(`^\s*` + regexp.QuoteMeta(fieldName) + `\s*=\s*(.*?)\s*(?:#.*)?$`)
	for _, line := range lines[:topLevelEnd] {
		if match := pattern.FindStringSubmatch(line); match != nil {
			return parseTomlString(match[1])
		}
	}
	return ""
}

// parseTomlProviders parses model providers from TOML config text.
func parseTomlProviders(text string) (providers []struct {
	Name   string
	Config map[string]string
}, modelProviderName, selectedProviderName string) {
	lines := strings.Split(text, "\n")
	type entry struct {
		Name   string
		Config map[string]string
	}
	var current *entry

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		tableName := parseTableName(line)
		if tableName != "" {
			current = &entry{Name: tableName, Config: map[string]string{}}
			providers = append(providers, *current)
			continue
		}

		if strings.HasPrefix(strings.TrimSpace(line), "[") {
			current = nil
			continue
		}

		if current == nil {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		if parsed, end, ok := parseTomlMultilineString(lines, i, value); ok {
			current.Config[key] = parsed
			i = end
			continue
		}
		current.Config[key] = parseTomlString(value)
	}

	modelProviderName = parseTopLevelStringField(text, "model_provider")
	selectedProviderName = parseTopLevelStringField(text, "model_provider_selected")
	if selectedProviderName == "" {
		selectedProviderName = modelProviderName
	}
	return
}

func loadCodexPermissionMode(codexHome string) string {
	configPath := codexConfigPath(codexHome)
	data, err := os.ReadFile(configPath)
	if err != nil {
		return ""
	}
	return parseTopLevelStringField(string(data), "permission_mode_selected")
}

func saveCodexPermissionMode(permissionMode, codexHome string) error {
	configPath := codexConfigPath(codexHome)
	data, err := os.ReadFile(configPath)
	if err != nil {
		data = []byte("")
	}
	text := string(data)
	updated := setTopLevelStringField(text, "permission_mode_selected", permissionMode)
	return writeConfigText(configPath, updated)
}

// setTopLevelStringField sets or adds a top-level string field in TOML text.
func setTopLevelStringField(text, fieldName, value string) string {
	lines := strings.Split(text, "\n")
	topLevelEnd := len(lines)
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "[") {
			topLevelEnd = i
			break
		}
	}

	pattern := regexp.MustCompile(`^\s*` + regexp.QuoteMeta(fieldName) + `\s*=`)
	for i := 0; i < topLevelEnd; i++ {
		if pattern.MatchString(lines[i]) {
			lines[i] = fmt.Sprintf("%s = %q", fieldName, value)
			return strings.Join(lines, "\n")
		}
	}

	replacement := fmt.Sprintf("%s = %q", fieldName, value)
	// Insert after model_provider or model, or at the top.
	insertIdx := 0
	for i := 0; i < topLevelEnd; i++ {
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "model_provider ") || strings.HasPrefix(strings.TrimSpace(lines[i]), "model_provider=") {
			insertIdx = i + 1
			break
		}
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "model ") || strings.HasPrefix(strings.TrimSpace(lines[i]), "model=") {
			insertIdx = i + 1
		}
	}

	result := make([]string, 0, len(lines)+1)
	result = append(result, lines[:insertIdx]...)
	result = append(result, replacement)
	result = append(result, lines[insertIdx:]...)
	return strings.Join(result, "\n")
}

func setModelProviderStringField(text, providerName, fieldName, value string) string {
	lines := strings.Split(text, "\n")
	tableIdx := -1
	tableEnd := len(lines)
	for i, line := range lines {
		if parseTableName(line) == providerName {
			tableIdx = i
			for j := i + 1; j < len(lines); j++ {
				if strings.HasPrefix(strings.TrimSpace(lines[j]), "[") {
					tableEnd = j
					break
				}
			}
			break
		}
	}
	if tableIdx == -1 {
		return text
	}

	replacement := fmt.Sprintf("%s = %s", fieldName, formatModelProviderStringValue(fieldName, value))
	pattern := regexp.MustCompile(`^\s*` + regexp.QuoteMeta(fieldName) + `\s*=`)
	for i := tableIdx + 1; i < tableEnd; i++ {
		if pattern.MatchString(lines[i]) {
			lines = replaceTomlField(lines, i, tableEnd, replacement)
			return strings.Join(lines, "\n")
		}
	}

	result := make([]string, 0, len(lines)+1)
	result = append(result, lines[:tableIdx+1]...)
	result = append(result, replacement)
	result = append(result, lines[tableIdx+1:]...)
	return strings.Join(result, "\n")
}

func replaceTomlField(lines []string, fieldIdx, tableEnd int, replacement string) []string {
	end := fieldIdx + 1
	parts := strings.SplitN(lines[fieldIdx], "=", 2)
	if len(parts) == 2 {
		if _, parsedEnd, ok := parseTomlMultilineString(lines, fieldIdx, parts[1]); ok && parsedEnd < tableEnd {
			end = parsedEnd + 1
		}
	}

	result := make([]string, 0, len(lines)-end+fieldIdx+1)
	result = append(result, lines[:fieldIdx]...)
	result = append(result, strings.Split(replacement, "\n")...)
	result = append(result, lines[end:]...)
	return result
}

func formatModelProviderStringValue(fieldName, value string) string {
	if fieldName == "auth_json" {
		return formatTomlMultilineLiteral(formatCodexAuthJSON(value))
	}
	return strconv.Quote(value)
}

func formatCodexAuthJSON(value string) string {
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, []byte(value), "", "  "); err == nil {
		return pretty.String()
	}
	return strings.TrimSpace(value)
}

func formatTomlMultilineLiteral(value string) string {
	if strings.Contains(value, "'''") {
		return strconv.Quote(value)
	}
	return "'''\n" + value + "\n'''"
}

func findModelProviderConfig(providers []struct {
	Name   string
	Config map[string]string
}, providerName string) (map[string]string, bool) {
	for _, p := range providers {
		if p.Name == providerName {
			return p.Config, true
		}
	}
	return nil, false
}

func writeConfigText(configPath, text string) error {
	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmpPath := configPath + ".tmp"
	if err := os.WriteFile(tmpPath, []byte(text), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, configPath); err != nil {
		return err
	}
	return os.Chmod(configPath, 0o600)
}

// markProjectTrusted adds trust_level = "trusted" to the Codex TOML config.
func markProjectTrusted(cwd string, codexHome string) error {
	resolvedCwd, err := filepath.Abs(cwd)
	if err != nil {
		resolvedCwd = cwd
	}
	configPath := filepath.Join(codexHome, "config.toml")

	data, err := os.ReadFile(configPath)
	if err != nil {
		data = []byte("")
	}
	text := string(data)
	sectionHeader := fmt.Sprintf("[projects.%q]", resolvedCwd)

	// Check if section already exists.
	sectionPattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(sectionHeader) + `\s*$`)
	if sectionPattern.MatchString(text) {
		// Check if trust_level already exists in this section.
		// For simplicity, just add trust_level after the section header.
		lines := strings.Split(text, "\n")
		for i, line := range lines {
			if sectionPattern.MatchString(line) {
				// Find end of section.
				end := len(lines)
				for j := i + 1; j < len(lines); j++ {
					if strings.HasPrefix(strings.TrimSpace(lines[j]), "[") {
						end = j
						break
					}
				}
				// Check if trust_level exists in this range.
				hasTrust := false
				for j := i + 1; j < end; j++ {
					if strings.HasPrefix(strings.TrimSpace(lines[j]), "trust_level") {
						lines[j] = `trust_level = "trusted"`
						hasTrust = true
						break
					}
				}
				if !hasTrust {
					result := make([]string, 0, len(lines)+1)
					result = append(result, lines[:i+1]...)
					result = append(result, `trust_level = "trusted"`)
					result = append(result, lines[i+1:]...)
					lines = result
				}
				text = strings.Join(lines, "\n")
				break
			}
		}
	} else {
		if len(text) > 0 && !strings.HasSuffix(text, "\n") {
			text += "\n"
		}
		text += fmt.Sprintf("\n%s\ntrust_level = \"trusted\"\n", sectionHeader)
	}

	return writeConfigText(configPath, text)
}
