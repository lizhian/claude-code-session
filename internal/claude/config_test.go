package claude

import (
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func TestAllConfigurationActions(t *testing.T) {
	p := New()
	ctx := provider.Context{Cwd: ".", DataHome: p.DefaultHome()}

	actions := p.ConfigurationActions()
	if len(actions) != 4 {
		t.Fatalf("expected 4 configuration actions, got %d", len(actions))
	}

	expectedNames := []string{"Model provider", "Opus model", "Sonnet model", "Haiku model"}
	for i, expected := range expectedNames {
		if actions[i].Name != expected {
			t.Errorf("action[%d]: expected name %q, got %q", i, expected, actions[i].Name)
		}
	}

	// Test that each action has a Columns function.
	for i, action := range actions {
		if action.Columns == nil {
			t.Errorf("action[%d] %q: missing Columns function", i, action.Name)
			continue
		}
		cols := action.Columns(ctx)
		t.Logf("  %s: columns=%v", action.Name, cols)
	}

	// Test LoadItems for each action.
	for i, action := range actions {
		if action.LoadItems == nil {
			t.Errorf("action[%d] %q: missing LoadItems function", i, action.Name)
			continue
		}
		items, err := action.LoadItems(ctx)
		if err != nil {
			t.Logf("  action[%d] %q LoadItems error: %v (may be expected)", i, action.Name, err)
			continue
		}
		t.Logf("  %s: %d items loaded", action.Name, len(items))
		for _, item := range items {
			t.Logf("    [%v] %s  columns=%v", item.Selected, item.Label, item.Columns)
		}
	}
}
