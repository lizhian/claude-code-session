package opencode

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lizhian/agent-session/internal/provider"
)

func defaultOpenCodeConfigPath() string {
	return filepath.Join(homeDir(), ".config", "opencode", "opencode.json")
}

func homeDir() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return "/"
	}
	return home
}

// stripJsonComments removes // and /* */ comments from JSON text.
func stripJsonComments(text string) string {
	var output strings.Builder
	inString := false
	var quote rune
	escaped := false
	inLineComment := false
	inBlockComment := false

	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		var next rune
		if i+1 < len(runes) {
			next = runes[i+1]
		}

		if inLineComment {
			if ch == '\n' || ch == '\r' {
				inLineComment = false
				output.WriteRune(ch)
			}
			continue
		}
		if inBlockComment {
			if ch == '*' && next == '/' {
				inBlockComment = false
				i++
			} else if ch == '\n' || ch == '\r' {
				output.WriteRune(ch)
			}
			continue
		}
		if inString {
			output.WriteRune(ch)
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == quote {
				inString = false
			}
			continue
		}
		if ch == '"' || ch == '\'' {
			inString = true
			quote = ch
			output.WriteRune(ch)
			continue
		}
		if ch == '/' && next == '/' {
			inLineComment = true
			i++
			continue
		}
		if ch == '/' && next == '*' {
			inBlockComment = true
			i++
			continue
		}
		output.WriteRune(ch)
	}
	return output.String()
}

// stripTrailingCommas removes trailing commas before } or ].
func stripTrailingCommas(text string) string {
	var output strings.Builder
	inString := false
	var quote rune
	escaped := false

	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		if inString {
			output.WriteRune(ch)
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == quote {
				inString = false
			}
			continue
		}
		if ch == '"' || ch == '\'' {
			inString = true
			quote = ch
			output.WriteRune(ch)
			continue
		}
		if ch == ',' {
			// Look ahead past whitespace.
			j := i + 1
			for j < len(runes) && (runes[j] == ' ' || runes[j] == '\t' || runes[j] == '\n' || runes[j] == '\r') {
				j++
			}
			if j < len(runes) && (runes[j] == '}' || runes[j] == ']') {
				continue
			}
		}
		output.WriteRune(ch)
	}
	return output.String()
}

// parseJsonc parses JSON with comments and trailing commas.
func parseJsonc(text string) (map[string]interface{}, error) {
	cleaned := stripTrailingCommas(stripJsonComments(text))
	var config map[string]interface{}
	if err := json.Unmarshal([]byte(cleaned), &config); err != nil {
		return nil, err
	}
	if config == nil {
		return map[string]interface{}{}, nil
	}
	return config, nil
}

func readOpenCodeConfig(configPath string) (map[string]interface{}, error) {
	if configPath == "" {
		configPath = defaultOpenCodeConfigPath()
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("missing OpenCode config file: %s", configPath)
	}
	return parseJsonc(string(data))
}

func writeOpenCodeConfig(config map[string]interface{}, configPath string) error {
	if configPath == "" {
		configPath = defaultOpenCodeConfigPath()
	}
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

// aiSdkProviderEntry is an @ai-sdk provider entry.
type aiSdkProviderEntry struct {
	Name     string
	Label    string
	Provider map[string]interface{}
	Npm      string
}

// aiSdkProviderEntries returns @ai-sdk providers from the config.
func aiSdkProviderEntries(config map[string]interface{}) []aiSdkProviderEntry {
	providers, _ := config["provider"].(map[string]interface{})
	if providers == nil {
		return nil
	}

	var entries []aiSdkProviderEntry
	for name, val := range providers {
		p, ok := val.(map[string]interface{})
		if !ok {
			continue
		}
		npm, _ := p["npm"].(string)
		if !strings.HasPrefix(npm, "@ai-sdk/") {
			continue
		}
		options, _ := p["options"].(map[string]interface{})
		if options == nil {
			continue
		}
		baseURL, _ := options["baseURL"].(string)
		apiKey, _ := options["apiKey"].(string)
		if baseURL == "" || apiKey == "" {
			continue
		}
		entries = append(entries, aiSdkProviderEntry{
			Name:     name,
			Label:    name,
			Provider: p,
			Npm:      npm,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
	return entries
}

func configuredModelNames(provider map[string]interface{}) []string {
	models, _ := provider["models"].(map[string]interface{})
	if models == nil {
		return nil
	}
	names := make([]string, 0, len(models))
	for name := range models {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// loadAiSdkProviders loads @ai-sdk providers for the configuration picker.
func loadAiSdkProviders() ([]provider.ConfigItem, error) {
	config, err := readOpenCodeConfig("")
	if err != nil {
		return nil, err
	}
	entries := aiSdkProviderEntries(config)
	if len(entries) == 0 {
		return nil, fmt.Errorf("no @ai-sdk providers")
	}

	items := make([]provider.ConfigItem, len(entries))
	for i, e := range entries {
		modelCount := len(configuredModelNames(e.Provider))
		items[i] = provider.ConfigItem{
			Name:  e.Name,
			Label: e.Name,
			Columns: []provider.ConfigColumn{
				{Value: fmt.Sprintf("%d models", modelCount)},
				{Value: e.Npm},
			},
		}
	}
	return items, nil
}

// loadProviderModels loads model names for a specific provider.
func loadProviderModels(providerName string) ([]provider.ConfigItem, error) {
	config, err := readOpenCodeConfig("")
	if err != nil {
		return nil, err
	}
	providers, _ := config["provider"].(map[string]interface{})
	if providers == nil {
		return nil, fmt.Errorf("unknown OpenCode provider: %s", providerName)
	}
	p, ok := providers[providerName].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("unknown OpenCode provider: %s", providerName)
	}

	// Try fetching remote models.
	options, _ := p["options"].(map[string]interface{})
	remoteNames := fetchRemoteModels(options)

	configured := configuredModelNames(p)
	configuredSet := make(map[string]bool)
	for _, n := range configured {
		configuredSet[n] = true
	}

	// Merge configured-only + remote.
	remoteSet := make(map[string]bool)
	var allNames []string
	// Configured-only first.
	for _, n := range configured {
		if !remoteSet[n] {
			allNames = append(allNames, n)
		}
	}
	for _, n := range remoteNames {
		if !remoteSet[n] {
			allNames = append(allNames, n)
			remoteSet[n] = true
		}
	}

	items := make([]provider.ConfigItem, len(allNames))
	for i, name := range allNames {
		items[i] = provider.ConfigItem{
			Name:     name,
			Label:    name,
			Selected: configuredSet[name],
		}
		if !remoteSet[name] || configuredSet[name] {
			items[i].Columns = []provider.ConfigColumn{{Value: "configured"}}
		}
	}
	return items, nil
}

// fetchRemoteModels tries to fetch models from the provider's API.
func fetchRemoteModels(options map[string]interface{}) []string {
	baseURL, _ := options["baseURL"].(string)
	apiKey, _ := options["apiKey"].(string)
	if baseURL == "" || apiKey == "" {
		return nil
	}

	url := strings.TrimRight(baseURL, "/") + "/models"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil
	}

	var names []string
	for _, m := range body.Data {
		if m.ID != "" {
			names = append(names, m.ID)
		}
	}
	return names
}

// saveProviderModels saves selected models for a provider.
func saveProviderModels(providerName string, selectedNames []string) error {
	config, err := readOpenCodeConfig("")
	if err != nil {
		return err
	}
	providers, _ := config["provider"].(map[string]interface{})
	if providers == nil {
		return fmt.Errorf("unknown OpenCode provider: %s", providerName)
	}
	p, ok := providers[providerName].(map[string]interface{})
	if !ok {
		return fmt.Errorf("unknown OpenCode provider: %s", providerName)
	}

	models := make(map[string]interface{})
	// Deduplicate and sort.
	seen := make(map[string]bool)
	var unique []string
	for _, n := range selectedNames {
		if !seen[n] {
			seen[n] = true
			unique = append(unique, n)
		}
	}
	sort.Strings(unique)
	for _, n := range unique {
		models[n] = map[string]interface{}{}
	}
	p["models"] = models
	return writeOpenCodeConfig(config, "")
}

// loadConfiguredModelChoices returns all provider/model combinations for a field.
func loadConfiguredModelChoices(fieldName string) ([]provider.ConfigItem, error) {
	config, err := readOpenCodeConfig("")
	if err != nil {
		return nil, err
	}
	selectedValue, _ := config[fieldName].(string)

	providers, _ := config["provider"].(map[string]interface{})
	if providers == nil {
		return nil, nil
	}

	var items []provider.ConfigItem
	for providerName, val := range providers {
		p, ok := val.(map[string]interface{})
		if !ok {
			continue
		}
		for _, modelName := range configuredModelNames(p) {
			value := providerName + "/" + modelName
			items = append(items, provider.ConfigItem{
				Name:     value,
				Label:    value,
				Selected: value == selectedValue,
				Columns: []provider.ConfigColumn{{Value: func() string {
					if value == selectedValue {
						return "selected"
					}
					return ""
				}()}},
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Name < items[j].Name
	})
	return items, nil
}

// loadConfiguredModelValue returns the current value for a model field.
func loadConfiguredModelValue(fieldName string) string {
	config, err := readOpenCodeConfig("")
	if err != nil {
		return ""
	}
	val, _ := config[fieldName].(string)
	return val
}

// saveConfiguredModel sets a model field in the config.
func saveConfiguredModel(fieldName, value string) error {
	config, err := readOpenCodeConfig("")
	if err != nil {
		return err
	}
	config[fieldName] = value
	return writeOpenCodeConfig(config, "")
}

// currentOpenCodeModelColumn returns the current model value for display.
func currentOpenCodeModelColumn(fieldName string) []string {
	return []string{loadConfiguredModelValue(fieldName)}
}

// loadOpenCodePermissionMode reads permission from opencode.json.
func loadOpenCodePermissionMode(configPath string) string {
	if configPath == "" {
		configPath = defaultOpenCodeConfigPath()
	}
	config, err := readOpenCodeConfig(configPath)
	if err != nil {
		return ""
	}
	// Migrate legacy field.
	if legacy, ok := config["permission_mode_selected"].(string); ok && legacy != "" {
		delete(config, "permission_mode_selected")
		if _, has := config["permission"]; !has {
			if legacy == "full" {
				config["permission"] = "allow"
			} else {
				config["permission"] = "ask"
			}
		}
		_ = writeOpenCodeConfig(config, configPath)
	}
	perm, _ := config["permission"].(string)
	if perm == "allow" {
		return "full"
	}
	return ""
}

// saveOpenCodePermissionMode writes permission to opencode.json.
func saveOpenCodePermissionMode(permissionMode, configPath string) error {
	if configPath == "" {
		configPath = defaultOpenCodeConfigPath()
	}
	config, err := readOpenCodeConfig(configPath)
	if err != nil {
		config = map[string]interface{}{}
	}
	delete(config, "permission_mode_selected")
	if permissionMode == "full" {
		config["permission"] = "allow"
	} else {
		config["permission"] = "ask"
	}
	return writeOpenCodeConfig(config, configPath)
}
