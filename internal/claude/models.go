package claude

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/lizhian/agent-session/internal/session"
)

// Claude settings file structure helpers.

// ProviderEnvFields are the env fields synced when switching model providers.
var ProviderEnvFields = []string{
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL",
	"ANTHROPIC_DEFAULT_OPUS_MODEL",
	"ANTHROPIC_DEFAULT_SONNET_MODEL",
}

// ModelFields maps short names to env field names.
var ModelFields = map[string]string{
	"haiku":  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
	"opus":   "ANTHROPIC_DEFAULT_OPUS_MODEL",
	"sonnet": "ANTHROPIC_DEFAULT_SONNET_MODEL",
}

func claudeSettingsPath(claudeHome string) string {
	return filepath.Join(claudeHome, "settings.json")
}

func readClaudeSettings(configPath string) (map[string]interface{}, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("missing Claude settings file: %s: %w", configPath, err)
	}
	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("invalid Claude settings: %w", err)
	}
	if config == nil {
		return map[string]interface{}{}, nil
	}
	return config, nil
}

func readOptionalClaudeSettings(configPath string) map[string]interface{} {
	config, err := readClaudeSettings(configPath)
	if err != nil {
		return map[string]interface{}{}
	}
	return config
}

func writeClaudeSettings(config map[string]interface{}, configPath string) error {
	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	tmpPath := configPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, configPath); err != nil {
		return err
	}
	return os.Chmod(configPath, 0o600)
}

func providerMap(config map[string]interface{}) map[string]interface{} {
	pm, _ := config["provider"].(map[string]interface{})
	if pm == nil {
		return map[string]interface{}{}
	}
	return pm
}

func selectedProviderName(config map[string]interface{}) string {
	name, _ := config["model_provider_selected"].(string)
	return name
}

func permissionModeSelected(config map[string]interface{}) string {
	mode, _ := config["permission_mode_selected"].(string)
	return mode
}

func activeModelValue(config map[string]interface{}, fieldName string) string {
	env, _ := config["env"].(map[string]interface{})
	if env != nil {
		if val, ok := env[fieldName].(string); ok {
			return val
		}
	}
	selected := selectedProviderName(config)
	if selected != "" {
		pm := providerMap(config)
		if p, ok := pm[selected].(map[string]interface{}); ok {
			if val, ok := p[fieldName].(string); ok {
				return val
			}
		}
	}
	return ""
}

// ProviderEntry represents a model provider in Claude settings.
type ProviderEntry struct {
	Name     string
	Label    string
	Selected bool
	Provider map[string]interface{}
}

func providerEntries(config map[string]interface{}) []ProviderEntry {
	selected := selectedProviderName(config)
	pm := providerMap(config)
	var entries []ProviderEntry
	for name, val := range pm {
		p, ok := val.(map[string]interface{})
		if !ok {
			continue
		}
		entries = append(entries, ProviderEntry{
			Name:     name,
			Label:    name,
			Selected: selected != "" && name == selected,
			Provider: p,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
	return entries
}

func loadClaudeModelProviders(claudeHome string) ([]ProviderEntry, error) {
	configPath := claudeSettingsPath(claudeHome)
	config, err := readClaudeSettings(configPath)
	if err != nil {
		return nil, err
	}
	entries := providerEntries(config)
	if len(entries) == 0 {
		return nil, fmt.Errorf("no provider entries found in settings.json")
	}
	return entries, nil
}

func backupEnvToProvider(config map[string]interface{}, providerName string) bool {
	pm := providerMap(config)
	p, ok := pm[providerName].(map[string]interface{})
	if !ok {
		return false
	}
	env, _ := config["env"].(map[string]interface{})
	if env == nil {
		return true
	}
	for _, field := range ProviderEnvFields {
		if _, exists := env[field]; exists {
			p[field] = env[field]
		} else {
			delete(p, field)
		}
	}
	return true
}

func applyProviderToEnv(config map[string]interface{}, provider map[string]interface{}) {
	env, _ := config["env"].(map[string]interface{})
	if env == nil {
		env = map[string]interface{}{}
		config["env"] = env
	}
	for _, field := range ProviderEnvFields {
		if _, exists := provider[field]; exists {
			env[field] = provider[field]
		} else {
			delete(env, field)
		}
	}
}

func selectClaudeModelProvider(providerName, claudeHome string) (bool, error) {
	configPath := claudeSettingsPath(claudeHome)
	config, err := readClaudeSettings(configPath)
	if err != nil {
		return false, err
	}
	pm := providerMap(config)
	p, ok := pm[providerName].(map[string]interface{})
	if !ok {
		return false, fmt.Errorf("unknown model provider: %s", providerName)
	}

	previousProviderName := selectedProviderName(config)
	sameProvider := previousProviderName == providerName
	if sameProvider {
		backupEnvToProvider(config, providerName)
	} else if previousProviderName != "" {
		backupEnvToProvider(config, previousProviderName)
	}

	applyProviderToEnv(config, p)
	config["model_provider_selected"] = providerName
	if err := writeClaudeSettings(config, configPath); err != nil {
		return false, err
	}
	return sameProvider, nil
}

func saveClaudeModel(fieldName, modelName, claudeHome string) error {
	if modelName == "" {
		return fmt.Errorf("model name is required")
	}
	configPath := claudeSettingsPath(claudeHome)
	config, err := readClaudeSettings(configPath)
	if err != nil {
		return err
	}

	selected := selectedProviderName(config)
	if selected == "" {
		return fmt.Errorf("no model_provider_selected in Claude settings")
	}
	pm := providerMap(config)
	p, ok := pm[selected].(map[string]interface{})
	if !ok {
		return fmt.Errorf("selected model provider %q was not found", selected)
	}

	env, _ := config["env"].(map[string]interface{})
	if env == nil {
		env = map[string]interface{}{}
		config["env"] = env
	}
	env[fieldName] = modelName
	p[fieldName] = modelName
	return writeClaudeSettings(config, configPath)
}

func loadClaudePermissionMode(claudeHome string) string {
	return permissionModeSelected(readOptionalClaudeSettings(claudeSettingsPath(claudeHome)))
}

func saveClaudePermissionMode(permissionMode, claudeHome string) error {
	configPath := claudeSettingsPath(claudeHome)
	config := readOptionalClaudeSettings(configPath)
	config["permission_mode_selected"] = permissionMode
	return writeClaudeSettings(config, configPath)
}

func currentClaudeProviderColumn(claudeHome string) []string {
	config := readOptionalClaudeSettings(claudeSettingsPath(claudeHome))
	selected, _ := config["model_provider_selected"].(string)
	return []string{selected}
}

func currentClaudeModelColumn(fieldName, claudeHome string) []string {
	config := readOptionalClaudeSettings(claudeSettingsPath(claudeHome))
	return []string{activeModelValue(config, fieldName)}
}

// markProjectTrusted writes hasTrustDialogAccepted to ~/.claude.json.
func markProjectTrusted(cwd string) error {
	resolvedCwd, err := filepath.Abs(cwd)
	if err != nil {
		resolvedCwd = cwd
	}
	configPath := filepath.Join(session.HomeDir(), ".claude.json")
	config := session.ReadConfig(configPath)

	projects, _ := config["projects"].(map[string]interface{})
	if projects == nil {
		projects = map[string]interface{}{}
		config["projects"] = projects
	}
	dirConfig, _ := projects[resolvedCwd].(map[string]interface{})
	if dirConfig == nil {
		dirConfig = map[string]interface{}{}
	}
	dirConfig["hasTrustDialogAccepted"] = true
	projects[resolvedCwd] = dirConfig

	return session.WriteConfig(config, configPath)
}

// FetchClaudeModelNames is implemented in fetch.go.
