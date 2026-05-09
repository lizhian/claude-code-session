package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/lizhian/agent-session/internal/provider"
)

// FetchClaudeModelNames fetches model names from the Anthropic API.
func FetchClaudeModelNames(provider map[string]interface{}, timeoutMs int) ([]string, error) {
	baseURL, _ := provider["ANTHROPIC_BASE_URL"].(string)
	token, _ := provider["ANTHROPIC_AUTH_TOKEN"].(string)
	if baseURL == "" {
		return nil, fmt.Errorf("provider ANTHROPIC_BASE_URL is required")
	}
	if token == "" {
		return nil, fmt.Errorf("provider ANTHROPIC_AUTH_TOKEN is required")
	}
	if timeoutMs <= 0 {
		timeoutMs = 10000
	}

	normalized := strings.TrimRight(baseURL, "/")
	url := normalized + "/v1/models"
	if strings.HasSuffix(normalized, "/v1") {
		url = normalized + "/models"
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid models response: %w", err)
	}

	var names []string
	for _, m := range body.Data {
		if m.ID != "" {
			names = append(names, m.ID)
		}
	}
	if len(body.Data) > 0 && len(names) == 0 {
		return nil, fmt.Errorf("invalid models response: no ids found")
	}

	// Deduplicate and sort.
	seen := make(map[string]bool)
	var unique []string
	for _, n := range names {
		if !seen[n] {
			seen[n] = true
			unique = append(unique, n)
		}
	}
	sortModelNames(unique)
	return unique, nil
}

// LoadClaudeModelChoices loads model choices for a specific field (opus/sonnet/haiku).
func LoadClaudeModelChoices(fieldName, claudeHome string) ([]provider.ConfigItem, error) {
	configPath := claudeSettingsPath(claudeHome)
	config, err := readClaudeSettings(configPath)
	if err != nil {
		return nil, err
	}

	// Get the selected provider.
	selected := selectedProviderName(config)
	if selected == "" {
		return nil, fmt.Errorf("no model_provider_selected in Claude settings")
	}
	pm := providerMap(config)
	p, ok := pm[selected].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("selected model provider %q was not found", selected)
	}

	// Fetch remote model names.
	remoteNames, err := FetchClaudeModelNames(p, 10000)
	if err != nil {
		// If fetch fails, just show current value.
		currentValue := activeModelValue(config, fieldName)
		if currentValue == "" {
			return nil, err
		}
		return []provider.ConfigItem{
			{Name: currentValue, Label: currentValue, Selected: true, Columns: []provider.ConfigColumn{{Value: "selected"}}},
		}, nil
	}

	currentValue := activeModelValue(config, fieldName)

	// Merge current with remote, deduplicate, sort.
	nameSet := make(map[string]bool)
	var allNames []string
	if currentValue != "" {
		allNames = append(allNames, currentValue)
		nameSet[currentValue] = true
	}
	for _, n := range remoteNames {
		if !nameSet[n] {
			allNames = append(allNames, n)
			nameSet[n] = true
		}
	}
	sortModelNames(allNames)

	items := make([]provider.ConfigItem, len(allNames))
	for i, name := range allNames {
		items[i] = provider.ConfigItem{
			Name:     name,
			Label:    name,
			Selected: name == currentValue,
			Columns: []provider.ConfigColumn{{Value: func() string {
				if name == currentValue {
					return "selected"
				}
				return ""
			}()}},
		}
	}
	return items, nil
}

func sortModelNames(names []string) {
	sort.SliceStable(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
}
