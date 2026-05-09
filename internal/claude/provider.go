package claude

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

// ClaudeProvider implements provider.Provider for Claude Code.
type ClaudeProvider struct{}

func New() *ClaudeProvider {
	return &ClaudeProvider{}
}

func (p *ClaudeProvider) Name() string { return "Claude Code" }

func (p *ClaudeProvider) ConfigPath() string {
	return filepath.Join(session.HomeDir(), ".agent-session", "claude-code.json")
}

func (p *ClaudeProvider) DefaultHome() string { return defaultClaudeHome() }

func (p *ClaudeProvider) HomeOptionName() string { return "claudeHome" }

func (p *ClaudeProvider) PermissionModes() []string { return session.DefaultPermissionModes }

func (p *ClaudeProvider) ListSessions(ctx provider.Context) []provider.Session {
	cwd := session.ResolvePath(ctx.Cwd, ".")
	home := session.ResolvePath(ctx.DataHome, defaultClaudeHome())
	return listSessions(cwd, home)
}

func (p *ClaudeProvider) ListWorkspaces(ctx provider.Context) []provider.Workspace {
	home := session.ResolvePath(ctx.DataHome, defaultClaudeHome())
	return listWorkspaces(home)
}

func (p *ClaudeProvider) LoadSessionTranscript(s provider.Session, ctx provider.Context) []provider.TranscriptMessage {
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

func (p *ClaudeProvider) SelectedItemToCommand(item provider.PickItem, permissionMode string, cwd string) provider.CommandSpec {
	var itemType, sessionID string
	if item.Type == "session" && item.Session != nil {
		itemType = "session"
		sessionID = item.Session.ID
	}
	cmd, args := selectedItemToCommand(itemType, sessionID, permissionMode, cwd)
	return provider.CommandSpec{
		Command: cmd,
		Args:    args,
		Cwd:     cwd,
	}
}

func (p *ClaudeProvider) BuildCommand(sessions []provider.Session, choice string, permissionMode string, cwd string) provider.CommandSpec {
	cmd, args := BuildClaudeCommand(sessions, choice, permissionMode)
	return provider.CommandSpec{
		Command: cmd,
		Args:    args,
		Cwd:     cwd,
	}
}

func (p *ClaudeProvider) LoadPermissionMode(ctx provider.Context) string {
	return loadClaudePermissionMode(session.ResolvePath(ctx.DataHome, defaultClaudeHome()))
}

func (p *ClaudeProvider) SavePermissionMode(mode string, ctx provider.Context) error {
	return saveClaudePermissionMode(mode, session.ResolvePath(ctx.DataHome, defaultClaudeHome()))
}

func (p *ClaudeProvider) TrustCurrentFolder(cwd string, ctx provider.Context) error {
	return markProjectTrusted(cwd)
}

func (p *ClaudeProvider) ConfigurationTitle() string { return "Claude Code configurations" }

func (p *ClaudeProvider) ConfigurationActions() []provider.ConfigAction {
	makeModelAction := func(name, title, field string) provider.ConfigAction {
		return provider.ConfigAction{
			Name:  name,
			Title: title,
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				val := currentClaudeModelColumn(ModelFields[field], ctx.DataHome)
				return []provider.ConfigColumn{{Name: "model", Value: strings.Join(val, "")}}
			},
			LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
				return LoadClaudeModelChoices(ModelFields[field], ctx.DataHome)
			},
			ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
				if err := saveClaudeModel(ModelFields[field], item.Name, ctx.DataHome); err != nil {
					return "", err
				}
				return "Updated " + name + ": " + item.Name, nil
			},
			EmptyMessage: "No models.",
		}
	}

	return []provider.ConfigAction{
		{
			Name:         "Model provider",
			Title:        "Claude Code model providers",
			EmptyMessage: "No model providers.",
			Columns: func(ctx provider.Context) []provider.ConfigColumn {
				val := currentClaudeProviderColumn(ctx.DataHome)
				cols := make([]provider.ConfigColumn, len(val))
				for i, v := range val {
					cols[i] = provider.ConfigColumn{Name: "provider", Value: v}
				}
				return cols
			},
			LoadItems: func(ctx provider.Context) ([]provider.ConfigItem, error) {
				entries, err := loadClaudeModelProviders(ctx.DataHome)
				if err != nil {
					return nil, err
				}
				items := make([]provider.ConfigItem, len(entries))
				for i, e := range entries {
					url := ""
					if e.Provider != nil {
						if u, ok := e.Provider["ANTHROPIC_BASE_URL"].(string); ok {
							url = u
						}
					}
					items[i] = provider.ConfigItem{
						Name:     e.Name,
						Label:    e.Label,
						Selected: e.Selected,
						Columns:  []provider.ConfigColumn{{Name: "url", Value: url}},
					}
				}
				return items, nil
			},
			ApplyItem: func(item provider.ConfigItem, ctx provider.Context) (string, error) {
				same, err := selectClaudeModelProvider(item.Name, ctx.DataHome)
				if err != nil {
					return "", err
				}
				if same {
					return "Updated model provider env: " + item.Name, nil
				}
				return "Selected model provider: " + item.Name, nil
			},
		},
		makeModelAction("Opus model", "Claude Code Opus model", "opus"),
		makeModelAction("Sonnet model", "Claude Code Sonnet model", "sonnet"),
		makeModelAction("Haiku model", "Claude Code Haiku model", "haiku"),
	}
}

func (p *ClaudeProvider) WorkspaceCwd(workspace provider.Workspace, currentCwd string) string {
	if workspace.Cwd != "" {
		return workspace.Cwd
	}
	if workspace.ProjectDir != "" {
		return workspace.ProjectDir
	}
	return currentCwd
}

// ParseArgs parses CLI arguments for the Claude provider.
func ParseArgs(args []string) (map[string]string, error) {
	opts := map[string]string{
		"cwd":        ".",
		"claudeHome": defaultClaudeHome(),
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
		case arg == "--claude-home" && i+1 < len(args):
			i++
			opts["claudeHome"] = args[i]
		case len(arg) > 13 && arg[:13] == "--claude-home=":
			opts["claudeHome"] = arg[13:]
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

// FormatSessions formats sessions for text output.
func FormatSessions(sessions []provider.Session) string {
	return formatSessions(sessions, "Claude Code")
}

func formatSessions(sessions []provider.Session, providerName string) string {
	if len(sessions) == 0 {
		return "当前目录没有找到 " + providerName + " session。"
	}
	// TODO: port full table formatting from session-renderer.js
	return ""
}

// FormatPicker formats sessions for the non-interactive picker.
func FormatPicker(sessions []provider.Session) string {
	return formatPicker(sessions)
}

func formatPicker(sessions []provider.Session) string {
	// TODO: port full picker formatting from session-renderer.js
	return ""
}

// JsonPayload builds the JSON output payload.
func JsonPayload(cwd, claudeHome string, sessions []provider.Session) map[string]interface{} {
	return map[string]interface{}{
		"cwd":        cwd,
		"claudeHome": claudeHome,
		"projectDir": filepath.Join(claudeHome, "projects", encodeProjectPath(cwd)),
		"count":      len(sessions),
		"sessions":   sessions,
	}
}

// SummaryLines returns human-readable summary lines.
func SummaryLines(cwd, claudeHome string, sessions []provider.Session) []string {
	return []string{
		"CWD: " + cwd,
		"Claude project dir: " + filepath.Join(claudeHome, "projects", encodeProjectPath(cwd)),
		fmt.Sprintf("Sessions: %d", len(sessions)),
	}
}
