package codex

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

// CodexProvider implements provider.Provider for Codex.
type CodexProvider struct{}

func New() *CodexProvider { return &CodexProvider{} }

func (p *CodexProvider) Name() string { return "Codex" }

func (p *CodexProvider) ConfigPath() string {
	return filepath.Join(session.HomeDir(), ".agent-session", "codex.json")
}

func (p *CodexProvider) DefaultHome() string       { return defaultCodexHome() }
func (p *CodexProvider) HomeOptionName() string    { return "codexHome" }
func (p *CodexProvider) PermissionModes() []string { return session.DefaultPermissionModes }

func (p *CodexProvider) ListSessions(ctx provider.Context) []provider.Session {
	cwd := session.ResolvePath(ctx.Cwd, ".")
	home := session.ResolvePath(ctx.DataHome, defaultCodexHome())
	return listSessions(cwd, home)
}

func (p *CodexProvider) ListWorkspaces(ctx provider.Context) []provider.Workspace {
	home := session.ResolvePath(ctx.DataHome, defaultCodexHome())
	return listWorkspaces(home)
}

func (p *CodexProvider) LoadSessionTranscript(s provider.Session, ctx provider.Context) []provider.TranscriptMessage {
	result := loadSessionTranscript(s)
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

func (p *CodexProvider) SelectedItemToCommand(item provider.PickItem, permissionMode string, cwd string) provider.CommandSpec {
	baseArgs := launchArgs(permissionMode)
	if item.Type != "session" || item.Session == nil {
		return provider.CommandSpec{Command: "codex", Args: baseArgs, Cwd: cwd}
	}
	return provider.CommandSpec{
		Command: "codex",
		Args:    append(baseArgs, "resume", item.Session.ID),
		Cwd:     cwd,
	}
}

func (p *CodexProvider) BuildCommand(sessions []provider.Session, choice string, permissionMode string, cwd string) provider.CommandSpec {
	baseArgs := launchArgs(permissionMode)
	s := resolveSessionChoice(sessions, choice)
	if s == nil {
		return provider.CommandSpec{Command: "codex", Args: baseArgs}
	}
	return provider.CommandSpec{
		Command: "codex",
		Args:    append(baseArgs, "resume", s.ID),
	}
}

func (p *CodexProvider) LoadPermissionMode(ctx provider.Context) string {
	return loadCodexPermissionMode(session.ResolvePath(ctx.DataHome, defaultCodexHome()))
}

func (p *CodexProvider) SavePermissionMode(mode string, ctx provider.Context) error {
	return saveCodexPermissionMode(mode, session.ResolvePath(ctx.DataHome, defaultCodexHome()))
}

func (p *CodexProvider) TrustCurrentFolder(cwd string, ctx provider.Context) error {
	home := defaultCodexHome()
	if ctx.DataHome != "" {
		home = ctx.DataHome
	}
	return markProjectTrusted(cwd, home)
}

func (p *CodexProvider) ConfigurationTitle() string { return "Codex configurations" }

func (p *CodexProvider) ConfigurationActions() []provider.ConfigAction {
	return []provider.ConfigAction{
		{
			Name:  "Model provider",
			Title: "Codex model providers",
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				name := currentCodexProviderColumn(ctx.DataHome)
				return []provider.ConfigColumn{{Name: "provider", Value: name}}
			},
			Select: &provider.SelectConfigAction{
				EmptyMessage: "No model providers.",
				LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
					return loadModelProviderItems(ctx.DataHome)
				},
				ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
					result, err := selectModelProvider(item.Name, ctx.DataHome)
					if err != nil {
						return "", err
					}
					if result.sameProvider {
						return "Updated model provider auth: " + item.Name, nil
					}
					if result.synced {
						return "Selected model provider: " + item.Name + "; synced Codex threads", nil
					}
					if result.syncError != "" {
						return "Selected model provider: " + item.Name + "; codex-threadripper sync failed: " + result.syncError, nil
					}
					return "Selected model provider: " + item.Name, nil
				},
			},
		},
	}
}

func (p *CodexProvider) WorkspaceCwd(workspace provider.Workspace, currentCwd string) string {
	if workspace.Cwd != "" {
		return workspace.Cwd
	}
	return currentCwd
}

// ParseArgs parses CLI arguments for the Codex provider.
func ParseArgs(args []string) (map[string]string, error) {
	opts := map[string]string{
		"cwd":       ".",
		"codexHome": defaultCodexHome(),
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
		case arg == "--codex-home" && i+1 < len(args):
			i++
			opts["codexHome"] = args[i]
		case len(arg) > 12 && arg[:12] == "--codex-home=":
			opts["codexHome"] = arg[12:]
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
func JsonPayload(cwd, codexHome string, sessions []provider.Session) map[string]interface{} {
	return map[string]interface{}{
		"cwd":       cwd,
		"codexHome": codexHome,
		"count":     len(sessions),
		"sessions":  sessions,
	}
}

// SummaryLines returns human-readable summary lines.
func SummaryLines(cwd, codexHome string, sessions []provider.Session) []string {
	return []string{
		"CWD: " + cwd,
		"Codex home: " + codexHome,
		fmt.Sprintf("Sessions: %d", len(sessions)),
	}
}

// currentCodexProviderColumn returns the currently selected provider name.
func currentCodexProviderColumn(codexHome string) string {
	configPath := codexConfigPath(codexHome)
	data, err := os.ReadFile(configPath)
	if err != nil {
		return ""
	}
	_, _, selected := parseTomlProviders(string(data))
	return selected
}

// loadModelProviderItems loads model providers from the Codex config.
func loadModelProviderItems(codexHome string) ([]provider.ConfigItem, error) {
	configPath := codexConfigPath(codexHome)
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("missing config file: %s", codexHome)
	}
	providers, _, selected := parseTomlProviders(string(data))
	if len(providers) == 0 {
		return nil, fmt.Errorf("no [model_providers.*] entries found in config.toml")
	}

	items := make([]provider.ConfigItem, len(providers))
	for i, p := range providers {
		items[i] = provider.ConfigItem{
			Name:     p.Name,
			Label:    p.Name,
			Selected: p.Name == selected,
		}
	}
	return items, nil
}

// syncStatus is returned by selectModelProvider when a thread sync was attempted.
type syncStatus struct {
	sameProvider bool
	synced       bool
	syncError    string
}

// selectModelProvider selects a model provider in the Codex config
// and attempts to sync threads via codex-threadripper if the provider changed.
func selectModelProvider(providerName, codexHome string) (syncStatus, error) {
	configPath := codexConfigPath(codexHome)
	data, err := os.ReadFile(configPath)
	if err != nil {
		return syncStatus{}, fmt.Errorf("missing config file: %s", configPath)
	}
	text := string(data)
	_, _, currentSelected := parseTomlProviders(text)
	sameProvider := currentSelected == providerName

	updated := setTopLevelStringField(text, "model_provider_selected", providerName)
	if err := writeConfigText(configPath, updated); err != nil {
		return syncStatus{}, err
	}

	status := syncStatus{sameProvider: sameProvider}

	// If switched to a different provider, try to sync threads.
	if !sameProvider {
		syncResult := syncCodexThreads(providerName, codexHome, "")
		status.synced = syncResult.Synced
		status.syncError = syncResult.Error
	}

	return status, nil
}
