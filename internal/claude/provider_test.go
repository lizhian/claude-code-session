package claude

import (
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func TestConfigurationActions(t *testing.T) {
	p := New()
	ctx := provider.Context{Cwd: ".", DataHome: p.DefaultHome()}

	actions := p.ConfigurationActions()
	if len(actions) == 0 {
		t.Fatal("expected at least one configuration action")
	}

	// Test Model provider action.
	modelProviderAction := actions[0]
	if modelProviderAction.Name != "Model provider" {
		t.Fatalf("expected first action name 'Model provider', got %q", modelProviderAction.Name)
	}

	// Test that Columns returns something.
	if modelProviderAction.Columns != nil {
		cols := modelProviderAction.Columns(ctx)
		t.Logf("Model provider columns: %v", cols)
	}

	// Test LoadItems.
	if modelProviderAction.Select != nil && modelProviderAction.Select.LoadItems != nil {
		items, err := modelProviderAction.Select.LoadItems(ctx)
		if err != nil {
			t.Logf("LoadItems error (expected if no Claude settings): %v", err)
		} else {
			t.Logf("Loaded %d model providers", len(items))
			for _, item := range items {
				t.Logf("  [%v] %s  columns=%v", item.Selected, item.Label, item.Columns)
			}
		}
	}
}
