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

func (p *OpenCodeProvider) DefaultHome() string { return defaultOpenCodeDataHome() }
func (p *OpenCodeProvider) HomeOptionName() string { return "opencodeDataHome" }
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
	return messages
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
	return []provider.ConfigAction{
		{
			Name:               "Provider models",
			Title:              "OpenCode providers",
			Mode:               "multiselect",
			EmptyMessage:       "No @ai-sdk providers.",
			EmptySubitemsMessage: "No models.",
			LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
				return loadAiSdkProviders()
			},
			LoadSubitems: func(item provider.ConfigItem, ctx provider.Context) ([]provider.ConfigItem, error) {
				return loadProviderModels(item.Name)
			},
			SubitemsTitle: func(item provider.ConfigItem) string {
				return "OpenCode models: " + item.Name
			},
			ApplySubitems: func(item provider.ConfigItem, selected []provider.ConfigItem, ctx provider.Context) (string, error) {
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
		{
			Name:  "Default model",
			Title: "OpenCode default model",
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				return []provider.ConfigColumn{{Value: loadConfiguredModelValue("model")}}
			},
			LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
				return loadConfiguredModelChoices("model")
			},
			ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
				if err := saveConfiguredModel("model", item.Name); err != nil {
					return "", err
				}
				return "Updated default model: " + item.Name, nil
			},
			EmptyMessage: "No configured models.",
		},
		{
			Name:  "Small model",
			Title: "OpenCode small model",
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				return []provider.ConfigColumn{{Value: loadConfiguredModelValue("small_model")}}
			},
			LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
				return loadConfiguredModelChoices("small_model")
			},
			ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
				if err := saveConfiguredModel("small_model", item.Name); err != nil {
					return "", err
				}
				return "Updated small model: " + item.Name, nil
			},
			EmptyMessage: "No configured models.",
		},
	}
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
		"cwd":             ".",
		"opencodeDataHome": defaultOpenCodeDataHome(),
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--json":
			opts["json"] = "true"
		case arg == "--pick":
			// Accepted for compatibility; picker is now the default.
		case arg == "--list":
			opts["list"] = "true"
		case arg == "--trust-current-folder":
			opts["trustCurrentFolder"] = "true"
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
		"cwd":             cwd,
		"opencodeDataHome": dataHome,
		"count":           len(sessions),
		"sessions":        sessions,
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
