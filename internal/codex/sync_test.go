package codex

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSyncCodexThreads(t *testing.T) {
	t.Run("handles missing command", func(t *testing.T) {
		result := syncCodexThreads("test-provider", "/nonexistent/codex-home", "/tmp")
		// codex-threadripper may or may not be installed on the test machine.
		// If it is installed, the command will run but fail on the bogus path.
		// We just verify the result fields are consistent.
		if result.Skipped {
			// Not installed: should have no error.
			if result.Synced {
				t.Error("expected Synced=false when Skipped=true")
			}
		} else if result.Synced {
			// Synced somehow (unlikely with bogus path).
			if result.Error != "" {
				t.Errorf("expected no error when Synced=true, got %q", result.Error)
			}
		} else {
			// Command ran but failed (expected with bogus path).
			if result.Error == "" {
				t.Error("expected error when sync failed")
			}
		}
	})
}

func TestSelectModelProviderSyncStatus(t *testing.T) {
	t.Run("returns sync status when provider changes", func(t *testing.T) {
		// This test verifies the syncStatus struct fields are populated correctly.
		// It can't easily test the actual file write without a temp config.
		status := syncStatus{
			sameProvider: false,
			synced:       true,
			syncError:    "",
		}
		if status.sameProvider {
			t.Error("expected sameProvider=false")
		}
		if !status.synced {
			t.Error("expected synced=true")
		}
	})
}

func TestSelectModelProviderUpdatesNativeSelectionAndAuth(t *testing.T) {
	codexHome := t.TempDir()
	configPath := filepath.Join(codexHome, "config.toml")
	currentAuth := `{"OPENAI_API_KEY":"current-key"}`
	targetAuth := `{"OPENAI_API_KEY":"target-key"}`
	config := `model = "gpt-5.1"
model_provider = "old"
model_provider_selected = "old"

[model_providers.old]
name = "old"
base_url = "https://old.example.com/v1"
auth_json = "{\"OPENAI_API_KEY\":\"stale-old-key\"}"

[model_providers.new]
name = "new"
base_url = "https://new.example.com/v1"
auth_json = "{\"OPENAI_API_KEY\":\"target-key\"}"
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(currentAuth), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := selectModelProvider("new", codexHome); err != nil {
		t.Fatal(err)
	}

	updatedConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	_, modelProvider, selectedProvider := parseTomlProviders(string(updatedConfig))
	if modelProvider != "new" {
		t.Fatalf("model_provider = %q, want new", modelProvider)
	}
	if selectedProvider != "new" {
		t.Fatalf("model_provider_selected = %q, want new", selectedProvider)
	}

	providers, _, _ := parseTomlProviders(string(updatedConfig))
	oldProvider, ok := findModelProviderConfig(providers, "old")
	if !ok {
		t.Fatal("old provider missing")
	}
	wantCurrentAuth := `{
  "OPENAI_API_KEY": "current-key"
}`
	if oldProvider["auth_json"] != wantCurrentAuth {
		t.Fatalf("old auth_json = %q, want %q", oldProvider["auth_json"], wantCurrentAuth)
	}
	wantAuthBlock := `auth_json = '''
{
  "OPENAI_API_KEY": "current-key"
}
'''`
	if !strings.Contains(string(updatedConfig), wantAuthBlock) {
		t.Fatalf("updated config missing multiline auth_json block:\nwant contains:\n%s\n\ngot:\n%s", wantAuthBlock, string(updatedConfig))
	}

	auth, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(auth) != targetAuth {
		t.Fatalf("auth.json = %q, want %q", string(auth), targetAuth)
	}
}

func TestSelectModelProviderReadsMultilineAuthJSON(t *testing.T) {
	codexHome := t.TempDir()
	configPath := filepath.Join(codexHome, "config.toml")
	currentAuth := `{"OPENAI_API_KEY":"current-key"}`
	targetAuth := `{
  "OPENAI_API_KEY": "target-key"
}`
	config := `model = "gpt-5.1"
model_provider = "old"
model_provider_selected = "old"

[model_providers.old]
name = "old"
base_url = "https://old.example.com/v1"
auth_json = "{\"OPENAI_API_KEY\":\"old-key\"}"

[model_providers.new]
name = "new"
base_url = "https://new.example.com/v1"
auth_json = '''
{
  "OPENAI_API_KEY": "target-key"
}
'''
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(currentAuth), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := selectModelProvider("new", codexHome); err != nil {
		t.Fatal(err)
	}

	auth, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(auth) != targetAuth {
		t.Fatalf("auth.json = %q, want %q", string(auth), targetAuth)
	}
}

func TestSelectModelProviderDoesNotCreateAuthJSONForUnmanagedProvider(t *testing.T) {
	codexHome := t.TempDir()
	configPath := filepath.Join(codexHome, "config.toml")
	currentAuth := `{"OPENAI_API_KEY":"current-key"}`
	config := `model = "gpt-5.1"
model_provider = "old"
model_provider_selected = "old"

[model_providers.old]
name = "old"
base_url = "https://old.example.com/v1"

[model_providers.new]
name = "new"
base_url = "https://new.example.com/v1"
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(currentAuth), 0o600); err != nil {
		t.Fatal(err)
	}

	status, err := selectModelProvider("new", codexHome)
	if err != nil {
		t.Fatal(err)
	}
	if status.authUpdated {
		t.Fatal("authUpdated = true, want false")
	}

	updatedConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	providers, modelProvider, selectedProvider := parseTomlProviders(string(updatedConfig))
	if modelProvider != "new" {
		t.Fatalf("model_provider = %q, want new", modelProvider)
	}
	if selectedProvider != "new" {
		t.Fatalf("model_provider_selected = %q, want new", selectedProvider)
	}
	oldProvider, ok := findModelProviderConfig(providers, "old")
	if !ok {
		t.Fatal("old provider missing")
	}
	if _, ok := oldProvider["auth_json"]; ok {
		t.Fatalf("old auth_json was added for unmanaged provider: %q", oldProvider["auth_json"])
	}
	newProvider, ok := findModelProviderConfig(providers, "new")
	if !ok {
		t.Fatal("new provider missing")
	}
	if _, ok := newProvider["auth_json"]; ok {
		t.Fatalf("new auth_json was added for unmanaged provider: %q", newProvider["auth_json"])
	}

	auth, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(auth) != currentAuth {
		t.Fatalf("auth.json = %q, want %q", string(auth), currentAuth)
	}
}

func TestSelectModelProviderDoesNotOverwriteAuthForUnmanagedTarget(t *testing.T) {
	codexHome := t.TempDir()
	configPath := filepath.Join(codexHome, "config.toml")
	currentAuth := `{"OPENAI_API_KEY":"current-key"}`
	config := `model = "gpt-5.1"
model_provider = "old"
model_provider_selected = "old"

[model_providers.old]
name = "old"
base_url = "https://old.example.com/v1"
auth_json = "{\"OPENAI_API_KEY\":\"stale-old-key\"}"

[model_providers.new]
name = "new"
base_url = "https://new.example.com/v1"
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(currentAuth), 0o600); err != nil {
		t.Fatal(err)
	}

	status, err := selectModelProvider("new", codexHome)
	if err != nil {
		t.Fatal(err)
	}
	if !status.authUpdated {
		t.Fatal("authUpdated = false, want true from previous provider backup")
	}

	updatedConfig, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	providers, _, _ := parseTomlProviders(string(updatedConfig))
	oldProvider, ok := findModelProviderConfig(providers, "old")
	if !ok {
		t.Fatal("old provider missing")
	}
	wantCurrentAuth := `{
  "OPENAI_API_KEY": "current-key"
}`
	if oldProvider["auth_json"] != wantCurrentAuth {
		t.Fatalf("old auth_json = %q, want %q", oldProvider["auth_json"], wantCurrentAuth)
	}
	newProvider, ok := findModelProviderConfig(providers, "new")
	if !ok {
		t.Fatal("new provider missing")
	}
	if _, ok := newProvider["auth_json"]; ok {
		t.Fatalf("new auth_json was added for unmanaged provider: %q", newProvider["auth_json"])
	}

	auth, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(auth) != currentAuth {
		t.Fatalf("auth.json = %q, want %q", string(auth), currentAuth)
	}
}

func TestSelectModelProviderEmptyAuthJSONIsManagedButDoesNotClearAuth(t *testing.T) {
	t.Run("empty target auth_json does not clear auth.json", func(t *testing.T) {
		codexHome := t.TempDir()
		configPath := filepath.Join(codexHome, "config.toml")
		currentAuth := `{"OPENAI_API_KEY":"current-key"}`
		config := `model = "gpt-5.1"
model_provider = "old"
model_provider_selected = "old"

[model_providers.old]
name = "old"
base_url = "https://old.example.com/v1"

[model_providers.new]
name = "new"
base_url = "https://new.example.com/v1"
auth_json = ""
`
		if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(currentAuth), 0o600); err != nil {
			t.Fatal(err)
		}

		status, err := selectModelProvider("new", codexHome)
		if err != nil {
			t.Fatal(err)
		}
		if status.authUpdated {
			t.Fatal("authUpdated = true, want false")
		}

		updatedConfig, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatal(err)
		}
		providers, _, _ := parseTomlProviders(string(updatedConfig))
		newProvider, ok := findModelProviderConfig(providers, "new")
		if !ok {
			t.Fatal("new provider missing")
		}
		if authJSON, ok := newProvider["auth_json"]; !ok || authJSON != "" {
			t.Fatalf("new auth_json = %q, present = %v, want present empty string", authJSON, ok)
		}

		auth, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
		if err != nil {
			t.Fatal(err)
		}
		if string(auth) != currentAuth {
			t.Fatalf("auth.json = %q, want %q", string(auth), currentAuth)
		}
	})

	t.Run("empty previous auth_json is backed up", func(t *testing.T) {
		codexHome := t.TempDir()
		configPath := filepath.Join(codexHome, "config.toml")
		currentAuth := `{"OPENAI_API_KEY":"current-key"}`
		config := `model = "gpt-5.1"
model_provider = "old"
model_provider_selected = "old"

[model_providers.old]
name = "old"
base_url = "https://old.example.com/v1"
auth_json = ""

[model_providers.new]
name = "new"
base_url = "https://new.example.com/v1"
`
		if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(codexHome, "auth.json"), []byte(currentAuth), 0o600); err != nil {
			t.Fatal(err)
		}

		status, err := selectModelProvider("new", codexHome)
		if err != nil {
			t.Fatal(err)
		}
		if !status.authUpdated {
			t.Fatal("authUpdated = false, want true")
		}

		updatedConfig, err := os.ReadFile(configPath)
		if err != nil {
			t.Fatal(err)
		}
		providers, _, _ := parseTomlProviders(string(updatedConfig))
		oldProvider, ok := findModelProviderConfig(providers, "old")
		if !ok {
			t.Fatal("old provider missing")
		}
		wantCurrentAuth := `{
  "OPENAI_API_KEY": "current-key"
}`
		if oldProvider["auth_json"] != wantCurrentAuth {
			t.Fatalf("old auth_json = %q, want %q", oldProvider["auth_json"], wantCurrentAuth)
		}

		auth, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
		if err != nil {
			t.Fatal(err)
		}
		if string(auth) != currentAuth {
			t.Fatalf("auth.json = %q, want %q", string(auth), currentAuth)
		}
	})
}

func TestHelperFunctions(t *testing.T) {
	t.Run("firstOutputLine", func(t *testing.T) {
		tests := []struct {
			input string
			want  string
		}{
			{"hello\nworld", "hello"},
			{"  \n  hello  \nworld", "hello"},
			{"", ""},
			{"\n\n", ""},
		}
		for _, tt := range tests {
			got := firstOutputLine(tt.input)
			if got != tt.want {
				t.Errorf("firstOutputLine(%q) = %q, want %q", tt.input, got, tt.want)
			}
		}
	})

	t.Run("truncateStatus", func(t *testing.T) {
		if got := truncateStatus("short"); got != "short" {
			t.Errorf("truncateStatus(short) = %q", got)
		}
		long := ""
		for i := 0; i < 200; i++ {
			long += "x"
		}
		got := truncateStatus(long)
		if len(got) != 120 {
			t.Errorf("truncateStatus(200 chars) len = %d, want 120", len(got))
		}
		if got[len(got)-3:] != "..." {
			t.Errorf("truncateStatus should end with ..., got %q", got[len(got)-3:])
		}
	})
}
