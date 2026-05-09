package opencode

import (
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func TestConfigurationActions(t *testing.T) {
	p := New()
	ctx := provider.Context{Cwd: ".", DataHome: p.DefaultHome()}

	actions := p.ConfigurationActions()
	if len(actions) != 3 {
		t.Fatalf("expected 3 configuration actions, got %d", len(actions))
	}

	expectedNames := []string{"Provider models", "Default model", "Small model"}
	for i, expected := range expectedNames {
		if actions[i].Name != expected {
			t.Errorf("action[%d]: expected name %q, got %q", i, expected, actions[i].Name)
		}
	}

	for i, action := range actions {
		if action.Columns == nil {
			t.Logf("  action[%d] %q: no Columns function (may be ok)", i, action.Name)
			continue
		}
		cols := action.Columns(ctx)
		t.Logf("  %s: columns=%v", action.Name, cols)
	}

	for i, action := range actions {
		if action.LoadItems == nil {
			continue
		}
		items, err := action.LoadItems(ctx)
		if err != nil {
			t.Logf("  action[%d] %q LoadItems error: %v", i, action.Name, err)
			continue
		}
		t.Logf("  %s: %d items loaded", action.Name, len(items))
	}
}
