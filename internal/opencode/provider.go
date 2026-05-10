package opencode

import (
	"fmt"
	"path/filepath"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

// OpenCodeProvider implements provider.Provider for OpenCode.
type OpenCodeProvider struct{}

func New() *OpenCodeProvider { return &OpenCodeProvider{} }

func (p *OpenCodeProvider) Name() string { return "OpenCode" }

func (p *OpenCodeProvider) ConfigPath() string {
	return filepath.Join(session.HomeDir(), ".agent-session", "opencode.json")
}

func (p *OpenCodeProvider) DefaultHome() string       { return defaultOpenCodeDataHome() }
func (p *OpenCodeProvider) HomeOptionName() string    { return "opencodeDataHome" }
func (p *OpenCodeProvider) PermissionModes() []string { return session.OpenCodePermissionModes }

func (p *OpenCodeProvider) ListSessions(ctx provider.Context) []provider.Session {
	cwd := session.ResolvePath(ctx.Cwd, ".")
	home := session.ResolvePath(ctx.DataHome, defaultOpenCodeDataHome())
	return listSessions(cwd, home)
}

func (p *OpenCodeProvider) ListWorkspaces(ctx provider.Context) []provider.Workspace {
	home := session.ResolvePath(ctx.DataHome, defaultOpenCodeDataHome())
	return listWorkspaces(home)
}

func (p *OpenCodeProvider) LoadSessionTranscript(s provider.Session, ctx provider.Context) []provider.TranscriptMessage {
	messages, _ := loadSessionTranscript(s)
	result := session.NormalizeTranscriptMessages(messages, 0, 0)
	transcript := make([]provider.TranscriptMessage, len(result.Messages))
	for i, m := range result.Messages {
		transcript[i] = provider.TranscriptMessage{
			Role:      m.Role,
			Timestamp: m.Timestamp,
			Text:      m.Text,
			Ordinal:   m.Ordinal,
		}
	}
	return transcript
}

func (p *OpenCodeProvider) SelectedItemToCommand(item provider.PickItem, permissionMode string, cwd string) provider.CommandSpec {
	baseArgs := launchArgs(permissionMode)
	env := launchEnv(permissionMode)
	if item.Type != "session" || item.Session == nil {
		return provider.CommandSpec{Command: "opencode", Args: baseArgs, Cwd: cwd, Env: env}
	}
	return provider.CommandSpec{
		Command: "opencode",
		Args:    append(baseArgs, "--session", item.Session.ID),
		Cwd:     cwd,
		Env:     env,
	}
}

func (p *OpenCodeProvider) BuildCommand(sessions []provider.Session, choice string, permissionMode string, cwd string) provider.CommandSpec {
	baseArgs := launchArgs(permissionMode)
	env := launchEnv(permissionMode)
	s := resolveSessionChoice(sessions, choice)
	if s == nil {
		return provider.CommandSpec{Command: "opencode", Args: baseArgs, Env: env}
	}
	return provider.CommandSpec{
		Command: "opencode",
		Args:    append(baseArgs, "--session", s.ID),
		Env:     env,
	}
}

func (p *OpenCodeProvider) LoadPermissionMode(ctx provider.Context) string {
	return loadOpenCodePermissionMode("")
}

func (p *OpenCodeProvider) SavePermissionMode(mode string, ctx provider.Context) error {
	return saveOpenCodePermissionMode(mode, "")
}

func (p *OpenCodeProvider) TrustCurrentFolder(cwd string, ctx provider.Context) error {
	return nil
}

func (p *OpenCodeProvider) ConfigurationTitle() string { return "OpenCode configurations" }

func (p *OpenCodeProvider) ConfigurationActions() []provider.ConfigAction {
	actions := openCodeProviderModelActions()
	actions = append(actions,
		provider.ConfigAction{
			Name:  "Default model",
			Title: "OpenCode default model",
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				return []provider.ConfigColumn{{Value: loadConfiguredModelValue("model")}}
			},
			Select: &provider.SelectConfigAction{
				EmptyMessage: "No configured models.",
				LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
					return loadConfiguredModelChoices("model")
				},
				ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
					if err := saveConfiguredModel("model", item.Name); err != nil {
						return "", err
					}
					return "Updated default model: " + item.Name, nil
				},
			},
		},
		provider.ConfigAction{
			Name:  "Small model",
			Title: "OpenCode small model",
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				return []provider.ConfigColumn{{Value: loadConfiguredModelValue("small_model")}}
			},
			Select: &provider.SelectConfigAction{
				EmptyMessage: "No configured models.",
				LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
					return loadConfiguredModelChoices("small_model")
				},
				ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
					if err := saveConfiguredModel("small_model", item.Name); err != nil {
						return "", err
					}
					return "Updated small model: " + item.Name, nil
				},
			},
		},
	)
	return actions
}

func openCodeProviderModelActions() []provider.ConfigAction {
	items, err := loadAiSdkProviders()
	if err != nil {
		return nil
	}
	actions := make([]provider.ConfigAction, 0, len(items))
	for _, item := range items {
		item := item
		npm := ""
		columns := item.Columns
		if len(item.Columns) > 1 {
			npm = item.Columns[1].Value
			columns = item.Columns[:1]
		}
		title := "OpenCode models: " + item.Name
		if npm != "" {
			title += "  " + npm
		}
		actions = append(actions, provider.ConfigAction{
			Name:  "Provider " + item.Name,
			Title: title,
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				return columns
			},
			DirectMultiSelect: &provider.DirectMultiSelectConfigAction{
				Item: item,
				Subitems: provider.SubitemConfigAction{
					EmptyMessage: "No models.",
					Title: func(item provider.ConfigItem) string {
						return title
					},
					LoadItems: func(item provider.ConfigItem, ctx provider.Context) ([]provider.ConfigItem, error) {
						return loadProviderModels(item.Name)
					},
					Apply: func(item provider.ConfigItem, selected []provider.ConfigItem, ctx provider.Context) (string, error) {
						names := make([]string, len(selected))
						for i, s := range selected {
							names[i] = s.Name
						}
						if err := saveProviderModels(item.Name, names); err != nil {
							return "", err
						}
						return fmt.Sprintf("Updated models for %s: %d selected", item.Name, len(names)), nil
					},
				},
			},
		})
	}
	return actions
}

func (p *OpenCodeProvider) WorkspaceCwd(workspace provider.Workspace, currentCwd string) string {
	if workspace.Cwd != "" {
		return workspace.Cwd
	}
	return currentCwd
}

// ParseArgs parses CLI arguments for the OpenCode provider.
func ParseArgs(args []string) (map[string]string, error) {
	opts := map[string]string{
		"cwd":              ".",
		"opencodeDataHome": defaultOpenCodeDataHome(),
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--help", arg == "-h":
			opts["help"] = "true"
		case arg == "--cwd" && i+1 < len(args):
			i++
			opts["cwd"] = args[i]
		case len(arg) > 6 && arg[:6] == "--cwd=":
			opts["cwd"] = arg[6:]
		case arg == "--opencode-data-home" && i+1 < len(args):
			i++
			opts["opencodeDataHome"] = args[i]
		case len(arg) > 21 && arg[:21] == "--opencode-data-home=":
			opts["opencodeDataHome"] = arg[21:]
		default:
			return nil, fmt.Errorf("unknown argument: %s", arg)
		}
	}

	var err error
	opts["cwd"], err = filepath.Abs(opts["cwd"])
	if err != nil {
		return nil, err
	}
	return opts, nil
}

// JsonPayload builds the JSON output payload.
func JsonPayload(cwd, dataHome string, sessions []provider.Session) map[string]interface{} {
	return map[string]interface{}{
		"cwd":              cwd,
		"opencodeDataHome": dataHome,
		"count":            len(sessions),
		"sessions":         sessions,
	}
}

// SummaryLines returns human-readable summary lines.
func SummaryLines(cwd, dataHome string, sessions []provider.Session) []string {
	return []string{
		"CWD: " + cwd,
		"OpenCode data home: " + dataHome,
		fmt.Sprintf("Sessions: %d", len(sessions)),
	}
}
