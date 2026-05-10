package opencode

import (
	"strings"
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func TestConfigurationActions(t *testing.T) {
	p := New()
	ctx := provider.Context{Cwd: ".", DataHome: p.DefaultHome()}

	actions := p.ConfigurationActions()
	if len(actions) < 2 {
		t.Fatalf("expected at least Default model and Small model actions, got %d", len(actions))
	}

	defaultIdx := len(actions) - 2
	smallIdx := len(actions) - 1
	if actions[defaultIdx].Name != "Default model" {
		t.Errorf("second-to-last action: expected %q, got %q", "Default model", actions[defaultIdx].Name)
	}
	if actions[smallIdx].Name != "Small model" {
		t.Errorf("last action: expected %q, got %q", "Small model", actions[smallIdx].Name)
	}

	for i, action := range actions[:defaultIdx] {
		if !strings.HasPrefix(action.Name, "Provider ") {
			t.Errorf("provider action[%d]: expected Provider prefix, got %q", i, action.Name)
		}
		if action.DirectMultiSelect == nil {
			t.Errorf("provider action[%d]: expected direct multi-select workflow", i)
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
		if action.Select == nil || action.Select.LoadItems == nil {
			continue
		}
		items, err := action.Select.LoadItems(ctx)
		if err != nil {
			t.Logf("  action[%d] %q LoadItems error: %v", i, action.Name, err)
			continue
		}
		t.Logf("  %s: %d items loaded", action.Name, len(items))
	}
}
