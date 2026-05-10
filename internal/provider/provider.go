package provider

import "time"

// Session represents a single agent session (Claude, Codex, or OpenCode).
type Session struct {
	ID               string `json:"id"`
	File             string `json:"file"`
	ProjectDir       string `json:"projectDir"`
	Cwd              string `json:"cwd"`
	GitBranch        string `json:"gitBranch"`
	Version          string `json:"version"`
	MessageCount     int    `json:"messageCount"`
	ParseErrorCount  int    `json:"parseErrorCount"`
	StartedAt        string `json:"startedAt"`
	UpdatedAt        string `json:"updatedAt"`
	FirstUserMessage string `json:"firstUserMessage"`
	LastUserMessage  string `json:"lastUserMessage"`
}

// Workspace represents a project directory with one or more sessions.
type Workspace struct {
	Cwd              string `json:"cwd"`
	ProjectDir       string `json:"projectDir"`
	SessionCount     int    `json:"sessionCount"`
	MessageCount     int    `json:"messageCount"`
	StartedAt        string `json:"startedAt"`
	UpdatedAt        string `json:"updatedAt"`
	FirstUserMessage string `json:"firstUserMessage"`
	LastUserMessage  string `json:"lastUserMessage"`
}

// TranscriptMessage is a single message in a session transcript.
type TranscriptMessage struct {
	Role      string `json:"role"`
	Timestamp string `json:"timestamp"`
	Text      string `json:"text"`
	Ordinal   int    `json:"ordinal,omitempty"`
}

// PickItem is either a "new" entry or an existing session.
type PickItem struct {
	Type    string   `json:"type"` // "new" or "session"
	Label   string   `json:"label,omitempty"`
	Session *Session `json:"session,omitempty"`
}

// PickResult is what the interactive picker returns when the user makes a choice.
type PickResult struct {
	Item           PickItem `json:"item"`
	PermissionMode string   `json:"permissionMode"`
	Cwd            string   `json:"cwd"`
}

// CommandSpec describes how to launch an agent.
type CommandSpec struct {
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Cwd     string            `json:"cwd,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// ConfigItem is a selectable item in a configuration view.
type ConfigItem struct {
	Name     string         `json:"name"`
	Label    string         `json:"label,omitempty"`
	Selected bool           `json:"selected,omitempty"`
	Columns  []ConfigColumn `json:"columns,omitempty"`
}

// ConfigColumn describes a column to display in a configuration list.
type ConfigColumn struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// ConfigAction defines a configuration action in the Configurations view.
type ConfigAction struct {
	Name              string
	Title             string
	Columns           func(ctx Context) []ConfigColumn
	Select            *SelectConfigAction
	DirectMultiSelect *DirectMultiSelectConfigAction
}

// SelectConfigAction presents a list of Configuration items. Selecting an item
// either applies it directly or opens a Multi-select configuration list.
type SelectConfigAction struct {
	EmptyMessage string
	LoadItems    func(ctx Context) ([]ConfigItem, error)
	ApplyItem    func(item ConfigItem, ctx Context) (string, error)
	MultiSelect  *SubitemConfigAction
}

// DirectMultiSelectConfigAction skips the intermediate item list and opens a
// Multi-select configuration list for a known Configuration item.
type DirectMultiSelectConfigAction struct {
	Item     ConfigItem
	Subitems SubitemConfigAction
}

// SubitemConfigAction defines the Multi-select configuration list behavior.
type SubitemConfigAction struct {
	EmptyMessage string
	Title        func(item ConfigItem) string
	LoadItems    func(item ConfigItem, ctx Context) ([]ConfigItem, error)
	Apply        func(item ConfigItem, selected []ConfigItem, ctx Context) (string, error)
}

// Context carries provider-specific runtime context (cwd, dataHome, etc).
type Context struct {
	Cwd            string
	DataHome       string
	HomeOptionName string
	Options        map[string]string
}

// Provider is the interface each agent (Claude, Codex, OpenCode) must implement.
type Provider interface {
	// Name returns the provider display name (e.g., "Claude Code").
	Name() string

	// ConfigPath returns the default config file path.
	ConfigPath() string

	// DefaultHome returns the default data directory for this provider.
	DefaultHome() string

	// HomeOptionName returns the CLI flag name (e.g., "claudeHome", "codexHome").
	HomeOptionName() string

	// PermissionModes returns the list of supported permission modes.
	PermissionModes() []string

	// ListSessions returns sessions for the given context.
	ListSessions(ctx Context) []Session

	// ListWorkspaces returns all known workspaces.
	ListWorkspaces(ctx Context) []Workspace

	// LoadSessionTranscript returns the transcript for a session.
	LoadSessionTranscript(session Session, ctx Context) []TranscriptMessage

	// SelectedItemToCommand builds the launch command from a picker selection.
	SelectedItemToCommand(item PickItem, permissionMode string, cwd string) CommandSpec

	// BuildCommand builds the launch command from a text choice (non-interactive).
	BuildCommand(sessions []Session, choice string, permissionMode string, cwd string) CommandSpec

	// LoadPermissionMode reads the stored permission mode.
	LoadPermissionMode(ctx Context) string

	// SavePermissionMode persists the permission mode.
	SavePermissionMode(mode string, ctx Context) error

	// TrustCurrentFolder marks the current directory as trusted.
	TrustCurrentFolder(cwd string, ctx Context) error

	// ConfigurationTitle returns the title for the configuration view.
	ConfigurationTitle() string

	// ConfigurationActions returns the list of configuration actions.
	ConfigurationActions() []ConfigAction

	// WorkspaceCwd resolves the working directory for a workspace.
	WorkspaceCwd(workspace Workspace, currentCwd string) string
}

// FormatTimestamp converts a time.Time to the string format used by sessions.
func FormatTimestamp(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
