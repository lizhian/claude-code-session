package pi

import (
	"fmt"
	"path/filepath"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

// PiProvider implements provider.Provider for Pi Coding Agent.
type PiProvider struct {
	piHome     string
	sessionDir string
}

func New() *PiProvider {
	piHome := session.ResolvePath("", defaultPiHome())
	return NewWithPaths(piHome, defaultPiSessionDir(piHome))
}

func NewWithPaths(piHome, sessionDir string) *PiProvider {
	piHome = session.ResolvePath(piHome, defaultPiHome())
	sessionDir = session.ResolvePath(sessionDir, defaultPiSessionDir(piHome))
	return &PiProvider{piHome: piHome, sessionDir: sessionDir}
}

func (p *PiProvider) Name() string { return "Pi Coding Agent" }

func (p *PiProvider) ConfigPath() string {
	return filepath.Join(session.HomeDir(), ".agent-session", "pi.json")
}

func (p *PiProvider) DefaultHome() string    { return p.piHome }
func (p *PiProvider) HomeOptionName() string { return "piHome" }
func (p *PiProvider) PermissionModes() []string {
	return []string{"default"}
}

func (p *PiProvider) ListSessions(ctx provider.Context) []provider.Session {
	cwd := session.ResolvePath(ctx.Cwd, ".")
	return listSessions(cwd, p.sessionDir)
}

func (p *PiProvider) ListWorkspaces(ctx provider.Context) []provider.Workspace {
	return listWorkspaces(p.sessionDir)
}

func (p *PiProvider) LoadSessionTranscript(s provider.Session, ctx provider.Context) []provider.TranscriptMessage {
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

func (p *PiProvider) SelectedItemToCommand(item provider.PickItem, permissionMode string, cwd string) provider.CommandSpec {
	args := []string{"--session-dir", p.sessionDir}
	if item.Type == "session" && item.Session != nil {
		args = append(args, "--session", item.Session.File)
	}
	return provider.CommandSpec{Command: "pi", Args: args, Cwd: cwd, Env: p.launchEnv()}
}

func (p *PiProvider) BuildCommand(sessions []provider.Session, choice string, permissionMode string, cwd string) provider.CommandSpec {
	args := []string{"--session-dir", p.sessionDir}
	if s := resolveSessionChoice(sessions, choice); s != nil {
		args = append(args, "--session", s.File)
	}
	return provider.CommandSpec{Command: "pi", Args: args, Cwd: cwd, Env: p.launchEnv()}
}

func (p *PiProvider) launchEnv() map[string]string {
	return map[string]string{"PI_CODING_AGENT_DIR": p.piHome}
}

func (p *PiProvider) LoadPermissionMode(ctx provider.Context) string {
	return "default"
}

func (p *PiProvider) SavePermissionMode(mode string, ctx provider.Context) error {
	return nil
}

func (p *PiProvider) TrustCurrentFolder(cwd string, ctx provider.Context) error {
	return nil
}

func (p *PiProvider) ConfigurationTitle() string { return "Pi Coding Agent configurations" }

func (p *PiProvider) ConfigurationActions() []provider.ConfigAction {
	return nil
}

func (p *PiProvider) WorkspaceCwd(workspace provider.Workspace, currentCwd string) string {
	if workspace.Cwd != "" {
		return workspace.Cwd
	}
	return currentCwd
}

// ParseArgs parses CLI arguments for the Pi Coding Agent provider.
func ParseArgs(args []string) (map[string]string, error) {
	piHome := defaultPiHome()
	opts := map[string]string{
		"cwd":          ".",
		"piHome":       piHome,
		"piSessionDir": defaultPiSessionDir(piHome),
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
		case arg == "--pi-home" && i+1 < len(args):
			i++
			opts["piHome"] = args[i]
			if _, overridden := opts["piSessionDirExplicit"]; !overridden {
				opts["piSessionDir"] = defaultPiSessionDir(opts["piHome"])
			}
		case len(arg) > 10 && arg[:10] == "--pi-home=":
			opts["piHome"] = arg[10:]
			if _, overridden := opts["piSessionDirExplicit"]; !overridden {
				opts["piSessionDir"] = defaultPiSessionDir(opts["piHome"])
			}
		case arg == "--pi-session-dir" && i+1 < len(args):
			i++
			opts["piSessionDir"] = args[i]
			opts["piSessionDirExplicit"] = "true"
		case len(arg) > 17 && arg[:17] == "--pi-session-dir=":
			opts["piSessionDir"] = arg[17:]
			opts["piSessionDirExplicit"] = "true"
		default:
			return nil, fmt.Errorf("unknown argument: %s", arg)
		}
	}

	var err error
	opts["cwd"], err = filepath.Abs(opts["cwd"])
	if err != nil {
		return nil, err
	}
	opts["piHome"] = session.ResolvePath(opts["piHome"], defaultPiHome())
	opts["piSessionDir"] = session.ResolvePath(opts["piSessionDir"], defaultPiSessionDir(opts["piHome"]))
	return opts, nil
}

// JsonPayload builds the JSON output payload.
func JsonPayload(cwd, piHome, sessionDir string, sessions []provider.Session) map[string]interface{} {
	return map[string]interface{}{
		"cwd":          cwd,
		"piHome":       piHome,
		"piSessionDir": sessionDir,
		"count":        len(sessions),
		"sessions":     sessions,
	}
}

// SummaryLines returns human-readable summary lines.
func SummaryLines(cwd, piHome, sessionDir string, sessions []provider.Session) []string {
	return []string{
		"CWD: " + cwd,
		"Pi home: " + piHome,
		"Pi session dir: " + sessionDir,
		fmt.Sprintf("Sessions: %d", len(sessions)),
	}
}
