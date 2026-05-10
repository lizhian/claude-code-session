package picker

import (
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

type fakeProvider struct {
	actions []provider.ConfigAction
}

func (p fakeProvider) Name() string                                             { return "Fake" }
func (p fakeProvider) ConfigPath() string                                       { return "" }
func (p fakeProvider) DefaultHome() string                                      { return "" }
func (p fakeProvider) HomeOptionName() string                                   { return "" }
func (p fakeProvider) PermissionModes() []string                                { return session.DefaultPermissionModes }
func (p fakeProvider) ListSessions(ctx provider.Context) []provider.Session     { return nil }
func (p fakeProvider) ListWorkspaces(ctx provider.Context) []provider.Workspace { return nil }
func (p fakeProvider) LoadSessionTranscript(s provider.Session, ctx provider.Context) []provider.TranscriptMessage {
	return nil
}
func (p fakeProvider) SelectedItemToCommand(item provider.PickItem, permissionMode string, cwd string) provider.CommandSpec {
	return provider.CommandSpec{}
}
func (p fakeProvider) BuildCommand(sessions []provider.Session, choice string, permissionMode string, cwd string) provider.CommandSpec {
	return provider.CommandSpec{}
}
func (p fakeProvider) LoadPermissionMode(ctx provider.Context) string { return "" }
func (p fakeProvider) SavePermissionMode(mode string, ctx provider.Context) error {
	return nil
}
func (p fakeProvider) TrustCurrentFolder(cwd string, ctx provider.Context) error {
	return nil
}
func (p fakeProvider) ConfigurationTitle() string { return "Fake configurations" }
func (p fakeProvider) ConfigurationActions() []provider.ConfigAction {
	return p.actions
}
func (p fakeProvider) WorkspaceCwd(workspace provider.Workspace, currentCwd string) string {
	return currentCwd
}

func TestSelectConfigurationActionAppliesItem(t *testing.T) {
	var applied string
	action := provider.ConfigAction{
		Name:  "Model provider",
		Title: "Model providers",
		Select: &provider.SelectConfigAction{
			EmptyMessage: "No providers.",
			LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
				return []provider.ConfigItem{
					{Name: "first", Label: "first"},
					{Name: "second", Label: "second", Selected: true},
				}, nil
			},
			ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
				applied = item.Name
				return "applied " + item.Name, nil
			},
		},
	}
	model := NewModel(fakeProvider{actions: []provider.ConfigAction{action}}, nil, "/tmp/work", "default", 80, 24, false)

	updated, _ := model.selectConfiguration()
	model = updated.(Model)
	if model.view != ViewConfigurationItems {
		t.Fatalf("view = %v, want ViewConfigurationItems", model.view)
	}
	if model.configItemSelectedIndex != 1 {
		t.Fatalf("selected index = %d, want selected item index 1", model.configItemSelectedIndex)
	}

	updated, _ = model.selectConfigurationItem()
	model = updated.(Model)
	if applied != "second" {
		t.Fatalf("applied item = %q, want second", applied)
	}
	if model.view != ViewConfigurations {
		t.Fatalf("view = %v, want ViewConfigurations", model.view)
	}
	if model.configStatus != "applied second" {
		t.Fatalf("status = %q, want applied second", model.configStatus)
	}
	if model.activeAction != nil || model.activeItem != nil || model.activeSubitems != nil {
		t.Fatalf("configuration workflow state was not cleared")
	}
}

func TestDirectMultiSelectConfigurationActionAppliesSelectedSubitems(t *testing.T) {
	var appliedItem string
	var appliedNames []string
	action := provider.ConfigAction{
		Name: "Provider openai",
		DirectMultiSelect: &provider.DirectMultiSelectConfigAction{
			Item: provider.ConfigItem{Name: "openai", Label: "openai"},
			Subitems: provider.SubitemConfigAction{
				EmptyMessage: "No models.",
				Title: func(item provider.ConfigItem) string {
					return "Models: " + item.Name
				},
				LoadItems: func(item provider.ConfigItem, ctx provider.Context) ([]provider.ConfigItem, error) {
					return []provider.ConfigItem{
						{Name: "gpt-5", Label: "gpt-5", Selected: true},
						{Name: "gpt-5-mini", Label: "gpt-5-mini"},
					}, nil
				},
				Apply: func(item provider.ConfigItem, selected []provider.ConfigItem, ctx provider.Context) (string, error) {
					appliedItem = item.Name
					for _, item := range selected {
						appliedNames = append(appliedNames, item.Name)
					}
					return "updated models", nil
				},
			},
		},
	}
	model := NewModel(fakeProvider{actions: []provider.ConfigAction{action}}, nil, "/tmp/work", "default", 80, 24, false)

	updated, _ := model.selectConfiguration()
	model = updated.(Model)
	if model.view != ViewConfigurationSubitems {
		t.Fatalf("view = %v, want ViewConfigurationSubitems", model.view)
	}
	if model.activeSubitems == nil {
		t.Fatalf("active subitems workflow was not set")
	}

	model.configItemSelectedIndex = 1
	updated, _ = model.handleSpace()
	model = updated.(Model)
	updated, _ = model.selectConfigurationSubitems()
	model = updated.(Model)

	if appliedItem != "openai" {
		t.Fatalf("applied item = %q, want openai", appliedItem)
	}
	if len(appliedNames) != 2 || appliedNames[0] != "gpt-5" || appliedNames[1] != "gpt-5-mini" {
		t.Fatalf("applied names = %v, want both models", appliedNames)
	}
	if model.view != ViewConfigurations {
		t.Fatalf("view = %v, want ViewConfigurations", model.view)
	}
	if model.configStatus != "updated models" {
		t.Fatalf("status = %q, want updated models", model.configStatus)
	}
	if model.activeAction != nil || model.activeItem != nil || model.activeSubitems != nil {
		t.Fatalf("configuration workflow state was not cleared")
	}
}
