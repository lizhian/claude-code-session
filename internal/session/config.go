package session

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ReadConfig reads a JSON config file, returning an empty map on any error.
func ReadConfig(configPath string) map[string]interface{} {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return map[string]interface{}{}
	}
	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return map[string]interface{}{}
	}
	if config == nil {
		return map[string]interface{}{}
	}
	return config
}

// WriteConfig writes a JSON config file with 0600 permissions,
// creating parent directories as needed.
func WriteConfig(config map[string]interface{}, configPath string) error {
	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(configPath, data, 0o600)
}

// ConfigString extracts a string value from a config map.
func ConfigString(config map[string]interface{}, key string) string {
	val, ok := config[key]
	if !ok {
		return ""
	}
	s, ok := val.(string)
	if !ok {
		return ""
	}
	return s
}

// ConfigSetString sets a string value in a config map.
func ConfigSetString(config map[string]interface{}, key, value string) {
	config[key] = value
}
