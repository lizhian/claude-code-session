package picker

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/render"
	"github.com/lizhian/agent-session/internal/session"
)

// View represents the current screen in the picker state machine.
type View int

type terminalPreviewReadyMsg struct{}

const (
	ViewSessions View = iota
	ViewPreview
	ViewTerminalPreview
	ViewWorkspaces
	ViewConfigurations
	ViewConfigurationItems
	ViewConfigurationSubitems
)

// Model is the bubbletea Model for the interactive session picker.
type Model struct {
	provider   provider.Provider
	sessions   []provider.Session
	workspaces []provider.Workspace
	view       View

	// Navigation state.
	sessionSelectedIndex    int
	workspaceSelectedIndex  int
	configSelectedIndex     int
	configItemSelectedIndex int

	// Search queries.
	sessionQuery   string
	workspaceQuery string

	// Permission mode.
	permissionMode string

	// Current working directory.
	cwd     string
	cwdFile string

	// Configuration state.
	configActions  []provider.ConfigAction
	configItems    []provider.ConfigItem
	configSubitems []provider.ConfigItem
	activeAction   *provider.ConfigAction
	activeItem     *provider.ConfigItem
	configStatus   string

	// Preview state.
	previewTranscript []provider.TranscriptMessage
	previewError      string
	previewScroll     int
	previewAutoBottom bool

	// Terminal dimensions.
	width  int
	height int

	// Color output.
	useColor bool

	// Result.
	result   *provider.PickResult
	quitting bool
}

// NewModel creates a new picker model.
func NewModel(p provider.Provider, sessions []provider.Session, cwd, permissionMode string, width, height int, useColor bool) Model {
	return Model{
		provider:             p,
		sessions:             sessions,
		view:                 ViewSessions,
		sessionSelectedIndex: 1,
		permissionMode:       session.NormalizePermissionMode(permissionMode, p.PermissionModes()),
		cwd:                  cwd,
		cwdFile:              os.Getenv("AGENT_SESSION_CWD_FILE"),
		width:                width,
		height:               height,
		useColor:             useColor,
		configActions:        p.ConfigurationActions(),
	}
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.MouseMsg:
		return m.handleMouse(msg)

	case terminalPreviewReadyMsg:
		if m.view == ViewTerminalPreview {
			printTerminalText("\x1b[H\x1b[2J")
			items := m.currentSessionItems()
			idx := render.ClampSelectedIndex(m.sessionSelectedIndex, len(items))
			if idx < len(items) && items[idx].Type == "session" && items[idx].Session != nil {
				printTerminalText(m.terminalPreviewText(*items[idx].Session))
			}
		}
		return m, nil

	case tea.KeyMsg:
		switch msg.Type {
		case tea.KeyCtrlC:
			m.quitting = true
			m.result = nil
			return m, tea.Quit
		}

		switch msg.String() {
		case "esc":
			if m.view == ViewTerminalPreview {
				return m.closeTerminalPreview()
			}
			return m.handleEscape()
		case "enter", "return":
			if m.view == ViewTerminalPreview {
				return m.closeTerminalPreview()
			}
			return m.handleEnter()
		case " ":
			if m.view == ViewTerminalPreview {
				return m.closeTerminalPreview()
			}
			return m.handleSpace()
		case "tab":
			return m.handleTab()
		case "up", "k":
			return m.handleUp()
		case "down", "j":
			return m.handleDown()
		case "left", "h":
			return m.handleLeft()
		case "right", "l":
			return m.handleRight()
		case "backspace":
			return m.handleBackspace()
		default:
			if m.view == ViewTerminalPreview {
				if len(msg.Runes) == 1 && (msg.Runes[0] == 'q' || msg.Runes[0] == 'Q') {
					return m.closeTerminalPreview()
				}
				return m, nil
			}
			// Printable characters go to the search query.
			if len(msg.Runes) == 1 && msg.Runes[0] >= 32 && msg.Runes[0] < 127 {
				return m.handleChar(msg.Runes[0])
			}
		}
	}

	return m, nil
}

func (m Model) View() string {
	if m.quitting {
		return ""
	}

	switch m.view {
	case ViewSessions:
		return m.renderSessions()
	case ViewPreview:
		return m.renderPreview()
	case ViewTerminalPreview:
		return ""
	case ViewWorkspaces:
		return m.renderWorkspaces()
	case ViewConfigurations:
		return m.renderConfigurations()
	case ViewConfigurationItems:
		return m.renderConfigurationItems()
	case ViewConfigurationSubitems:
		return m.renderConfigurationSubitems()
	}
	return ""
}

// Result returns the picker result after the program exits.
func (m Model) Result() *provider.PickResult {
	return m.result
}

// --- Key handlers ---

func scrollLinesPerWheel() int {
	value := strings.TrimSpace(os.Getenv("AGENT_SESSION_SCROLL_LINES"))
	if value == "" {
		return 3
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return 3
	}
	if n < 1 {
		return 1
	}
	if n > 20 {
		return 20
	}
	return n
}

func (m Model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	if m.view != ViewPreview {
		return m, nil
	}
	switch msg.Type {
	case tea.MouseWheelUp:
		m.previewAutoBottom = false
		m.previewScroll -= scrollLinesPerWheel()
		if m.previewScroll < 0 {
			m.previewScroll = 0
		}
	case tea.MouseWheelDown:
		m.previewAutoBottom = false
		m.previewScroll += scrollLinesPerWheel()
	}
	return m, nil
}

func (m Model) closeTerminalPreview() (tea.Model, tea.Cmd) {
	printTerminalText("\x1b[H\x1b[2J")
	m.view = ViewSessions
	m.previewTranscript = nil
	m.previewError = ""
	m.previewScroll = 0
	m.previewAutoBottom = false
	return m, tea.Sequence(tea.EnterAltScreen, tea.EnableMouseCellMotion)
}

func (m Model) handleEscape() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewPreview:
		m.view = ViewSessions
		m.previewTranscript = nil
		m.previewError = ""
		m.previewScroll = 0
		m.previewAutoBottom = false
		return m, nil
	case ViewConfigurationSubitems:
		return m.cancelConfigurationSubitems()
	case ViewConfigurationItems:
		m.view = ViewConfigurations
		m.activeAction = nil
		m.activeItem = nil
		m.configItems = nil
		m.configSubitems = nil
		return m, nil
	case ViewConfigurations:
		m.view = ViewWorkspaces
		return m, nil
	case ViewWorkspaces:
		m.view = ViewSessions
		return m, nil
	default:
		m.quitting = true
		m.result = nil
		return m, tea.Quit
	}
}

func (m Model) handleEnter() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		return m.selectSession()
	case ViewPreview:
		// Enter in preview does nothing (space returns to sessions).
		return m, nil
	case ViewWorkspaces:
		return m.selectWorkspace()
	case ViewConfigurations:
		return m.selectConfiguration()
	case ViewConfigurationItems:
		return m.selectConfigurationItem()
	case ViewConfigurationSubitems:
		return m.selectConfigurationSubitems()
	}
	return m, nil
}

func (m Model) handleSpace() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		// Enter terminal preview mode for selected session.
		items := m.currentSessionItems()
		idx := render.ClampSelectedIndex(m.sessionSelectedIndex, len(items))
		if idx < len(items) && items[idx].Type == "session" && items[idx].Session != nil {
			s := *items[idx].Session
			m.previewTranscript = m.provider.LoadSessionTranscript(s, provider.Context{Cwd: m.cwd})
			m.previewError = ""
			m.previewScroll = 0
			m.previewAutoBottom = false
			m.view = ViewTerminalPreview
			return m, tea.Sequence(tea.ExitAltScreen, tea.DisableMouse, printTerminalPreview())
		}
		return m, nil
	case ViewPreview:
		m.view = ViewSessions
		m.previewTranscript = nil
		m.previewError = ""
		m.previewScroll = 0
		m.previewAutoBottom = false
		return m, nil
	case ViewConfigurationSubitems:
		idx := render.ClampSelectedIndex(m.configItemSelectedIndex, len(m.configSubitems))
		if idx < len(m.configSubitems) {
			m.configSubitems[idx].Selected = !m.configSubitems[idx].Selected
			if idx+1 < len(m.configSubitems) {
				m.configItemSelectedIndex = idx + 1
			}
		}
		return m, nil
	}
	return m, nil
}

func (m Model) handleTab() (tea.Model, tea.Cmd) {
	if m.view != ViewSessions {
		return m, nil
	}
	modes := m.provider.PermissionModes()
	m.permissionMode = session.NextPermissionMode(m.permissionMode, modes)
	ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
	_ = m.provider.SavePermissionMode(m.permissionMode, ctx)
	return m, nil
}

func (m Model) handleUp() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		items := m.currentSessionItems()
		if m.sessionSelectedIndex > 0 {
			m.sessionSelectedIndex--
		}
		_ = items // ensure computed
		return m, nil
	case ViewPreview:
		m.previewAutoBottom = false
		if m.previewScroll > 0 {
			m.previewScroll--
		}
		return m, nil
	case ViewWorkspaces:
		if m.workspaceSelectedIndex > 0 {
			m.workspaceSelectedIndex--
		}
		return m, nil
	case ViewConfigurations:
		if m.configSelectedIndex > 0 {
			m.configSelectedIndex--
		}
		return m, nil
	case ViewConfigurationItems, ViewConfigurationSubitems:
		if m.configItemSelectedIndex > 0 {
			m.configItemSelectedIndex--
		}
		return m, nil
	}
	return m, nil
}

func (m Model) handleDown() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		items := m.currentSessionItems()
		m.sessionSelectedIndex = render.ClampSelectedIndex(m.sessionSelectedIndex+1, len(items))
		return m, nil
	case ViewPreview:
		m.previewAutoBottom = false
		m.previewScroll++
		return m, nil
	case ViewWorkspaces:
		items := m.currentWorkspaceItems()
		m.workspaceSelectedIndex = render.ClampSelectedIndex(m.workspaceSelectedIndex+1, len(items))
		return m, nil
	case ViewConfigurations:
		m.configSelectedIndex = render.ClampSelectedIndex(m.configSelectedIndex+1, len(m.configActions))
		return m, nil
	case ViewConfigurationItems:
		m.configItemSelectedIndex = render.ClampSelectedIndex(m.configItemSelectedIndex+1, len(m.configItems))
		return m, nil
	case ViewConfigurationSubitems:
		m.configItemSelectedIndex = render.ClampSelectedIndex(m.configItemSelectedIndex+1, len(m.configSubitems))
		return m, nil
	}
	return m, nil
}

func (m Model) handleLeft() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewWorkspaces:
		m.view = ViewSessions
		return m, nil
	case ViewConfigurations:
		m.view = ViewWorkspaces
		return m, nil
	case ViewConfigurationItems:
		m.view = ViewConfigurations
		m.activeAction = nil
		m.activeItem = nil
		m.configItems = nil
		m.configSubitems = nil
		return m, nil
	case ViewConfigurationSubitems:
		return m.cancelConfigurationSubitems()
	}
	return m, nil
}

func (m Model) cancelConfigurationSubitems() (tea.Model, tea.Cmd) {
	m.activeItem = nil
	m.configSubitems = nil
	if m.activeAction != nil && m.activeAction.DirectItem != nil {
		m.view = ViewConfigurations
		m.activeAction = nil
		return m, nil
	}
	m.view = ViewConfigurationItems
	return m, nil
}

func (m Model) handleRight() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		if m.workspaces == nil {
			ctx := provider.Context{DataHome: m.provider.DefaultHome()}
			m.workspaces = m.provider.ListWorkspaces(ctx)
		}
		m.view = ViewWorkspaces
		m.workspaceSelectedIndex = 0
		return m, nil
	case ViewWorkspaces:
		m.view = ViewConfigurations
		m.configSelectedIndex = 0
		m.configStatus = ""
		return m, nil
	}
	return m, nil
}

func (m Model) handleBackspace() (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		if len(m.sessionQuery) > 0 {
			m.sessionQuery = m.sessionQuery[:len(m.sessionQuery)-1]
		}
		return m, nil
	case ViewWorkspaces:
		if len(m.workspaceQuery) > 0 {
			m.workspaceQuery = m.workspaceQuery[:len(m.workspaceQuery)-1]
		}
		return m, nil
	}
	return m, nil
}

func (m Model) handleChar(r rune) (tea.Model, tea.Cmd) {
	switch m.view {
	case ViewSessions:
		m.sessionQuery += string(r)
		return m, nil
	case ViewWorkspaces:
		m.workspaceQuery += string(r)
		return m, nil
	}
	return m, nil
}

// --- Selection handlers ---

func (m Model) selectSession() (tea.Model, tea.Cmd) {
	items := m.currentSessionItems()
	idx := render.ClampSelectedIndex(m.sessionSelectedIndex, len(items))
	if idx >= len(items) {
		m.quitting = true
		m.result = nil
		return m, tea.Quit
	}
	item := items[idx]
	var pickItem provider.PickItem
	if item.Type == "session" && item.Session != nil {
		pickItem = provider.PickItem{
			Type:    item.Type,
			Session: item.Session,
		}
	} else {
		pickItem = provider.PickItem{
			Type:  item.Type,
			Label: "new",
		}
	}
	m.result = &provider.PickResult{
		Item:           pickItem,
		PermissionMode: m.permissionMode,
		Cwd:            m.cwd,
	}
	m.quitting = true
	return m, tea.Quit
}

func (m Model) writeSelectedCwd() {
	if m.cwdFile == "" || m.cwd == "" {
		return
	}
	_ = os.WriteFile(m.cwdFile, []byte(m.cwd+"\n"), 0o600)
}

func (m Model) selectWorkspace() (tea.Model, tea.Cmd) {
	items := m.currentWorkspaceItems()
	idx := render.ClampSelectedIndex(m.workspaceSelectedIndex, len(items))
	if idx < len(items) && items[idx].Type == "workspace" {
		ws := items[idx].Workspace
		m.cwd = m.provider.WorkspaceCwd(ws, m.cwd)
		m.writeSelectedCwd()
		ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
		m.sessions = m.provider.ListSessions(ctx)
		m.view = ViewSessions
		m.sessionQuery = ""
		m.sessionSelectedIndex = 0
		m.previewTranscript = nil
		m.previewError = ""
	}
	return m, nil
}

func (m Model) selectConfiguration() (tea.Model, tea.Cmd) {
	idx := render.ClampSelectedIndex(m.configSelectedIndex, len(m.configActions))
	if idx >= len(m.configActions) {
		return m, nil
	}
	action := m.configActions[idx]
	m.activeAction = &action
	m.configItemSelectedIndex = 0

	// Direct multiselect actions skip the intermediate item list.
	if action.Mode == "multiselect" && action.DirectItem != nil && action.LoadSubitems != nil {
		item := *action.DirectItem
		m.activeItem = &item
		ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
		subitems, err := action.LoadSubitems(item, ctx)
		if err != nil {
			m.configSubitems = nil
			m.configStatus = err.Error()
			return m, nil
		}
		if len(subitems) == 0 {
			m.configSubitems = nil
			m.configStatus = action.EmptySubitemsMessage
			if m.configStatus == "" {
				m.configStatus = "No models."
			}
			return m, nil
		}
		m.configSubitems = subitems
		m.configStatus = ""
		m.view = ViewConfigurationSubitems
		return m, nil
	}

	if action.LoadItems != nil {
		ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
		items, err := action.LoadItems(ctx)
		if err != nil {
			m.configItems = nil
			m.configStatus = err.Error()
		} else {
			m.configItems = items
			m.configItemSelectedIndex = selectedConfigItemIndex(items)
			m.configStatus = ""
		}
	}
	m.view = ViewConfigurationItems
	return m, nil
}

func selectedConfigItemIndex(items []provider.ConfigItem) int {
	for i, item := range items {
		if item.Selected {
			return i
		}
	}
	return 0
}

func (m Model) selectConfigurationItem() (tea.Model, tea.Cmd) {
	if m.activeAction == nil {
		return m, nil
	}
	idx := render.ClampSelectedIndex(m.configItemSelectedIndex, len(m.configItems))
	if idx >= len(m.configItems) {
		return m, nil
	}
	item := m.configItems[idx]

	// Handle multiselect subitems.
	if m.activeAction.Mode == "multiselect" && m.activeAction.LoadSubitems != nil {
		m.activeItem = &item
		m.configItemSelectedIndex = 0
		ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
		subitems, err := m.activeAction.LoadSubitems(item, ctx)
		if err != nil {
			m.configSubitems = nil
			m.configStatus = err.Error()
			return m, nil
		}
		if len(subitems) == 0 {
			m.configSubitems = nil
			m.configStatus = m.activeAction.EmptySubitemsMessage
			if m.configStatus == "" {
				m.configStatus = "No models."
			}
			return m, nil
		}
		m.configSubitems = subitems
		m.configStatus = ""
		m.view = ViewConfigurationSubitems
		return m, nil
	}

	// Apply item.
	if m.activeAction.ApplyItem != nil {
		ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
		status, err := m.activeAction.ApplyItem(item, ctx)
		if err != nil {
			m.configStatus = err.Error()
		} else {
			m.configStatus = status
		}
		m.view = ViewConfigurations
		m.activeAction = nil
		m.activeItem = nil
		m.configItems = nil
		m.configSubitems = nil
	}
	return m, nil
}

func (m Model) selectConfigurationSubitems() (tea.Model, tea.Cmd) {
	if m.activeAction == nil || m.activeAction.ApplySubitems == nil {
		return m, nil
	}
	var selected []provider.ConfigItem
	for _, item := range m.configSubitems {
		if item.Selected {
			selected = append(selected, item)
		}
	}
	ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}
	status, err := m.activeAction.ApplySubitems(*m.activeItem, selected, ctx)
	if err != nil {
		m.configStatus = err.Error()
	} else {
		m.configStatus = status
		m.configActions = m.provider.ConfigurationActions()
	}
	m.view = ViewConfigurations
	m.activeAction = nil
	m.activeItem = nil
	m.configItems = nil
	m.configSubitems = nil
	m.configSelectedIndex = render.ClampSelectedIndex(m.configSelectedIndex, len(m.configActions))
	return m, nil
}

// --- Item helpers ---

type pickItem struct {
	Type    string
	Session *provider.Session
}

func (m Model) currentSessionItems() []pickItem {
	filtered := render.FilterSessions(m.sessions, m.sessionQuery)
	items := make([]pickItem, 0, len(filtered)+1)
	items = append(items, pickItem{Type: "new"})
	for i := range filtered {
		items = append(items, pickItem{Type: "session", Session: &filtered[i]})
	}
	return items
}

type workspaceItem struct {
	Type      string
	Workspace provider.Workspace
}

func (m Model) currentWorkspaceItems() []workspaceItem {
	if m.workspaces == nil {
		ctx := provider.Context{DataHome: m.provider.DefaultHome()}
		m.workspaces = m.provider.ListWorkspaces(ctx)
	}
	terms := session.SearchTerms(m.workspaceQuery)
	var items []workspaceItem
	for _, ws := range m.workspaces {
		text := strings.ToLower(strings.Join([]string{
			ws.Cwd, ws.ProjectDir, ws.UpdatedAt, ws.StartedAt,
			ws.FirstUserMessage, ws.LastUserMessage,
		}, " "))
		if session.MatchSearch(text, terms) {
			items = append(items, workspaceItem{Type: "workspace", Workspace: ws})
		}
	}
	return items
}

// --- Render methods ---

func (m Model) renderSessions() string {
	now := time.Now()
	items := m.currentSessionItems()
	idx := render.ClampSelectedIndex(m.sessionSelectedIndex, len(items))
	filteredCount := len(items) - 1

	numberWidth := 2
	timeWidth := 7
	msgsWidth := 8

	for i, item := range items {
		if item.Type == "session" {
			num := fmt.Sprintf("%d.", i)
			if len(num) > numberWidth {
				numberWidth = len(num)
			}
			tw := render.DisplayWidth(render.FormatSessionTime(item.Session.UpdatedAt, now))
			if tw > timeWidth {
				timeWidth = tw
			}
			mw := len(fmt.Sprintf("%d msg", item.Session.MessageCount))
			if mw > msgsWidth {
				msgsWidth = mw
			}
		}
	}

	fixedWidth := 2 + numberWidth + 2 + timeWidth + 2 + msgsWidth + 2
	firstPromptWidth, lastPromptWidth := render.SplitPromptWidths(max(0, m.width-fixedWidth))

	title := m.provider.Name() + " sessions"
	if idx < len(items) && items[idx].Type == "session" {
		title += "  " + items[idx].Session.ID
	}

	lines := []string{
		render.FitLine(title, m.width),
		render.FitLine("Workspace: "+m.cwd, m.width),
		render.FitLine(render.PickerStatusLine(m.permissionMode, filteredCount, m.sessionQuery, m.useColor), m.width),
		"",
	}

	maxItemRows := max(1, m.height-7)
	start := max(0, min(idx-maxItemRows+1, len(items)-maxItemRows))
	visibleItems := items[start:min(start+maxItemRows, len(items))]

	for vi, item := range visibleItems {
		itemIndex := start + vi
		prefix := "  "
		if itemIndex == idx {
			prefix = "> "
		}

		if item.Type == "new" {
			lines = append(lines, render.FitLine(
				fmt.Sprintf("%s%s new", prefix, render.PadDisplay("0.", numberWidth, "right")),
				m.width,
			))
			continue
		}

		s := item.Session
		updated := render.FormatSessionTime(s.UpdatedAt, now)
		messages := fmt.Sprintf("%d msg", s.MessageCount)
		firstPrompt := render.TruncateToWidth(render.DisplayFirstUserMessage(*s), firstPromptWidth)
		lastPrompt := "-"
		if lastPromptWidth > 0 {
			lastPrompt = render.TruncateToWidth(render.DisplayLastUserMessage(*s), lastPromptWidth)
		}

		var promptPart string
		if lastPromptWidth > 0 {
			promptPart = render.PadDisplay(firstPrompt, firstPromptWidth, "left") + "  " + lastPrompt
		} else {
			promptPart = firstPrompt
		}

		line := fmt.Sprintf("%s%s %s  %s  %s",
			prefix,
			render.PadDisplay(fmt.Sprintf("%d.", itemIndex), numberWidth, "right"),
			render.PadDisplay(updated, timeWidth, "left"),
			render.PadDisplay(messages, msgsWidth, "right"),
			promptPart,
		)
		fittedLine := render.FitLine(line, m.width)
		if itemIndex == idx {
			fittedLine = render.Colorize(fittedLine, render.ANSISelected, m.useColor)
		}
		lines = append(lines, fittedLine)
	}

	if filteredCount == 0 && strings.TrimSpace(m.sessionQuery) != "" {
		lines = append(lines, "", "No matching sessions.")
	}

	return strings.Join(lines, "\n")
}

func printTerminalPreview() tea.Cmd {
	return func() tea.Msg {
		return terminalPreviewReadyMsg{}
	}
}

func printTerminalText(text string) {
	fmt.Print(strings.ReplaceAll(text, "\n", "\r\n"))
}

func (m Model) terminalPreviewText(s provider.Session) string {
	width := m.width
	if width <= 0 {
		width = 80
	}
	now := time.Now()
	lines := []string{
		render.FitLine(m.provider.Name()+" session preview", width),
		render.FitLine("Workspace: "+m.cwd, width),
		render.FitLine("Session: "+s.ID, width),
		render.FitLine(fmt.Sprintf("Messages: %d", s.MessageCount), width),
		render.FitLine("Started: "+s.StartedAt, width),
		render.FitLine("Updated: "+s.UpdatedAt, width),
		render.FitLine(fmt.Sprintf("Transcript: %d conversation messages", previewMessageCount(m.previewTranscript)), width),
	}
	for i, msg := range m.previewTranscript {
		lines = append(lines, "")
		if msg.Role == "omitted" {
			for _, omittedLine := range []string{".", ".", ".", msg.Text, ".", ".", "."} {
				lines = append(lines, render.Colorize(render.FitLine(omittedLine, width), render.ANSIPreviewOmitted, m.useColor))
			}
			continue
		}
		ordinal := msg.Ordinal
		if ordinal <= 0 {
			ordinal = i + 1
		}
		role := strings.ToLower(msg.Role)
		header := render.Colorize(
			fmt.Sprintf("#%d %s %s", ordinal, role, render.FormatSessionTime(msg.Timestamp, now)),
			render.ANSIPreviewMeta,
			m.useColor,
		)
		lines = append(lines, render.FitLine(header, width))
		for _, line := range render.WrapTextPreserveNewlines(msg.Text, width) {
			fitted := render.FitLine(line, width)
			if role == "assistant" {
				fitted = render.Colorize(fitted, render.ANSIPreviewMuted, m.useColor)
			}
			lines = append(lines, fitted)
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func (m Model) renderPreview() string {
	now := time.Now()
	items := m.currentSessionItems()
	idx := render.ClampSelectedIndex(m.sessionSelectedIndex, len(items))
	if idx >= len(items) || items[idx].Type != "session" {
		m.view = ViewSessions
		return m.renderSessions()
	}

	s := items[idx].Session
	title := m.provider.Name() + " sessions  " + s.ID

	headerLines := []string{
		render.FitLine(title, m.width),
		render.FitLine("Workspace: "+m.cwd, m.width),
		render.FitLine(render.PickerStatusLine(m.permissionMode, len(items)-1, m.sessionQuery, m.useColor), m.width),
		"",
		render.FitLine(fmt.Sprintf("Messages: %d  Started: %s  Updated: %s", s.MessageCount, s.StartedAt, s.UpdatedAt), m.width),
	}

	var bodyLines []string
	lastMessageStart := 0
	if m.previewError != "" {
		bodyLines = append(bodyLines, "")
		bodyLines = append(bodyLines, render.FitLine("Failed to load transcript:", m.width))
		for _, line := range render.WrapTextPreserveNewlines(m.previewError, m.width) {
			bodyLines = append(bodyLines, render.FitLine(line, m.width))
		}
	} else if len(m.previewTranscript) > 0 {
		bodyLines = append(bodyLines, "")
		bodyLines = append(bodyLines, render.FitLine(fmt.Sprintf("Transcript: %d conversation messages", previewMessageCount(m.previewTranscript)), m.width))
		for i, msg := range m.previewTranscript {
			bodyLines = append(bodyLines, "")
			if msg.Role == "omitted" {
				for _, omittedLine := range []string{".", ".", ".", msg.Text, ".", ".", "."} {
					bodyLines = append(bodyLines, render.Colorize(render.FitLine(omittedLine, m.width), render.ANSIPreviewOmitted, m.useColor))
				}
				continue
			}
			lastMessageStart = len(bodyLines) - 1
			ordinal := msg.Ordinal
			if ordinal <= 0 {
				ordinal = i + 1
			}
			role := strings.ToLower(msg.Role)
			color := render.ANSIPreviewMeta
			header := render.Colorize(
				fmt.Sprintf("#%d %s %s", ordinal, role, render.FormatSessionTime(msg.Timestamp, now)),
				color,
				m.useColor,
			)
			bodyLines = append(bodyLines, render.FitLine(header, m.width))
			for _, line := range render.WrapTextPreserveNewlines(msg.Text, m.width) {
				fitted := render.FitLine(line, m.width)
				if role == "assistant" {
					fitted = render.Colorize(fitted, render.ANSIPreviewMuted, m.useColor)
				}
				bodyLines = append(bodyLines, fitted)
			}
		}
	}

	bodyHeight := max(1, m.height-len(headerLines))
	maxScroll := max(0, len(bodyLines)-bodyHeight)
	scroll := min(m.previewScroll, maxScroll)
	if m.previewAutoBottom {
		scroll = min(lastMessageStart, maxScroll)
	}
	visibleBody := bodyLines[scroll:min(scroll+bodyHeight, len(bodyLines))]
	return strings.Join(append(headerLines, visibleBody...), "\n")
}

func previewMessageCount(messages []provider.TranscriptMessage) int {
	count := 0
	for _, msg := range messages {
		if msg.Role != "omitted" {
			count++
		}
	}
	return count
}

func (m Model) renderWorkspaces() string {
	now := time.Now()
	items := m.currentWorkspaceItems()
	idx := render.ClampSelectedIndex(m.workspaceSelectedIndex, len(items))

	title := m.provider.Name() + " workspaces"
	numberWidth := 2
	timeWidth := 7
	sessionsWidth := 8
	msgsWidth := 8

	for i, item := range items {
		num := fmt.Sprintf("%d.", i)
		if len(num) > numberWidth {
			numberWidth = len(num)
		}
		tw := render.DisplayWidth(render.FormatSessionTime(item.Workspace.UpdatedAt, now))
		if tw > timeWidth {
			timeWidth = tw
		}
		sw := len(fmt.Sprintf("%d sessions", item.Workspace.SessionCount))
		if sw > sessionsWidth {
			sessionsWidth = sw
		}
		mw := len(fmt.Sprintf("%d msg", item.Workspace.MessageCount))
		if mw > msgsWidth {
			msgsWidth = mw
		}
	}

	fixedWidth := 2 + numberWidth + 2 + timeWidth + 2 + sessionsWidth + 2 + msgsWidth + 2
	pathWidth := max(1, m.width-fixedWidth)

	lines := []string{
		render.FitLine(title, m.width),
		render.FitLine("Search: "+m.workspaceQuery, m.width),
		render.FitLine(fmt.Sprintf("Matches: %d", len(items)), m.width),
		"",
	}

	maxItemRows := max(1, m.height-5)
	start := max(0, min(idx-maxItemRows+1, len(items)-maxItemRows))
	visibleItems := items[start:min(start+maxItemRows, len(items))]

	for vi, item := range visibleItems {
		itemIndex := start + vi
		prefix := "  "
		if itemIndex == idx {
			prefix = "> "
		}

		ws := item.Workspace
		updated := render.FormatSessionTime(ws.UpdatedAt, now)
		sessions := fmt.Sprintf("%d sessions", ws.SessionCount)
		messages := fmt.Sprintf("%d msg", ws.MessageCount)
		wsPath := render.TruncateToWidth(ws.Cwd, pathWidth)
		if wsPath == "" {
			wsPath = render.TruncateToWidth(ws.ProjectDir, pathWidth)
		}
		if wsPath == "" {
			wsPath = "-"
		}

		line := fmt.Sprintf("%s%s %s  %s  %s  %s",
			prefix,
			render.PadDisplay(fmt.Sprintf("%d.", itemIndex), numberWidth, "right"),
			render.PadDisplay(updated, timeWidth, "left"),
			render.PadDisplay(sessions, sessionsWidth, "right"),
			render.PadDisplay(messages, msgsWidth, "right"),
			wsPath,
		)
		fittedLine := render.FitLine(line, m.width)
		if itemIndex == idx {
			fittedLine = render.Colorize(fittedLine, render.ANSISelected, m.useColor)
		}
		lines = append(lines, fittedLine)
	}

	return strings.Join(lines, "\n")
}

func (m Model) renderConfigurations() string {
	title := m.provider.ConfigurationTitle()
	items := m.configActions

	lines := []string{
		render.FitLine(title, m.width),
	}

	if m.configStatus != "" {
		lines = append(lines, render.FitLine(m.configStatus, m.width))
	}
	lines = append(lines, "")

	if len(items) == 0 {
		lines = append(lines, "No configurations.")
		return strings.Join(lines, "\n")
	}

	idx := render.ClampSelectedIndex(m.configSelectedIndex, len(items))
	numberWidth := 2
	nameWidth := 0

	ctx := provider.Context{Cwd: m.cwd, DataHome: m.provider.DefaultHome()}

	// Pre-compute all action columns to determine alignment widths.
	type actionRow struct {
		action   provider.ConfigAction
		colTexts []string
	}
	rows := make([]actionRow, len(items))

	// Determine max column count and compute per-column widths.
	maxCols := 0
	for i, action := range items {
		num := fmt.Sprintf("%d.", i)
		if len(num) > numberWidth {
			numberWidth = len(num)
		}
		nw := render.DisplayWidth(action.Name)
		if nw > nameWidth {
			nameWidth = nw
		}
		if action.Columns != nil {
			cols := action.Columns(ctx)
			var texts []string
			for _, col := range cols {
				if col.Value != "" {
					texts = append(texts, col.Value)
				}
			}
			rows[i] = actionRow{action: action, colTexts: texts}
			if len(texts) > maxCols {
				maxCols = len(texts)
			}
		} else {
			rows[i] = actionRow{action: action}
		}
	}

	colWidths := make([]int, maxCols)
	for _, row := range rows {
		for ci, t := range row.colTexts {
			w := render.DisplayWidth(t)
			if w > colWidths[ci] {
				colWidths[ci] = w
			}
		}
	}

	maxItemRows := max(1, m.height-6)
	start := max(0, min(idx-maxItemRows+1, len(items)-maxItemRows))
	visibleItems := rows[start:min(start+maxItemRows, len(rows))]

	for vi, row := range visibleItems {
		itemIndex := start + vi
		prefix := "  "
		if itemIndex == idx {
			prefix = "> "
		}

		namePart := render.PadDisplay(row.action.Name, nameWidth, "left")

		line := fmt.Sprintf("%s%s %s", prefix, render.PadDisplay(fmt.Sprintf("%d.", itemIndex), numberWidth, "right"), namePart)

		// Append columns with alignment.
		if len(row.colTexts) > 0 {
			var aligned []string
			for ci, t := range row.colTexts {
				if ci < len(colWidths) {
					aligned = append(aligned, render.PadDisplay(t, colWidths[ci], "left"))
				}
			}
			line += "  " + strings.Join(aligned, "  ")
		}

		fittedLine := render.FitLine(line, m.width)
		if itemIndex == idx {
			fittedLine = render.Colorize(fittedLine, render.ANSISelected, m.useColor)
		}
		lines = append(lines, fittedLine)
	}

	return strings.Join(lines, "\n")
}

func (m Model) renderConfigurationItems() string {
	title := "Configurations"
	if m.activeAction != nil && m.activeAction.Title != "" {
		title = m.activeAction.Title
	}

	lines := []string{
		render.FitLine(title, m.width),
	}

	if m.configStatus != "" {
		lines = append(lines, render.FitLine(m.configStatus, m.width))
	}
	lines = append(lines, "")

	if len(m.configItems) == 0 {
		emptyMsg := "No configurations."
		if m.activeAction != nil && m.activeAction.EmptyMessage != "" {
			emptyMsg = m.activeAction.EmptyMessage
		}
		lines = append(lines, emptyMsg)
		return strings.Join(lines, "\n")
	}

	idx := render.ClampSelectedIndex(m.configItemSelectedIndex, len(m.configItems))
	numberWidth := 2
	labelWidth := 0

	// Calculate column widths from visible items.
	columnCount := 0
	for _, item := range m.configItems {
		if len(item.Columns) > columnCount {
			columnCount = len(item.Columns)
		}
	}
	columnWidths := make([]int, columnCount)

	for i, item := range m.configItems {
		num := fmt.Sprintf("%d.", i)
		if len(num) > numberWidth {
			numberWidth = len(num)
		}
		lw := render.DisplayWidth(item.Label)
		if lw > labelWidth {
			labelWidth = lw
		}
		for ci, col := range item.Columns {
			cw := render.DisplayWidth(col.Value)
			if cw > columnWidths[ci] {
				columnWidths[ci] = cw
			}
		}
	}

	for vi, item := range m.configItems {
		itemIndex := vi
		prefix := "  "
		if itemIndex == idx {
			prefix = "> "
		}

		// Build the label part.
		labelPart := render.PadDisplay(item.Label, labelWidth, "left")

		// Build the columns suffix.
		var colParts []string
		for ci, col := range item.Columns {
			if ci < len(columnWidths) {
				colParts = append(colParts, render.PadDisplay(col.Value, columnWidths[ci], "left"))
			}
		}
		suffix := strings.Join(colParts, "  ")

		line := fmt.Sprintf("%s%s %s", prefix, render.PadDisplay(fmt.Sprintf("%d.", itemIndex), numberWidth, "right"), labelPart)
		if suffix != "" {
			line += "  " + suffix
		}
		fittedLine := render.FitLine(line, m.width)
		if itemIndex == idx {
			fittedLine = render.Colorize(fittedLine, render.ANSISelected, m.useColor)
		}
		lines = append(lines, fittedLine)
	}

	return strings.Join(lines, "\n")
}

func (m Model) renderConfigurationSubitems() string {
	title := "Configurations"
	if m.activeAction != nil && m.activeAction.SubitemsTitle != nil && m.activeItem != nil {
		title = m.activeAction.SubitemsTitle(*m.activeItem)
	}

	lines := []string{
		render.FitLine(title, m.width),
	}

	if m.configStatus != "" {
		lines = append(lines, render.FitLine(m.configStatus, m.width))
	}
	lines = append(lines, "")

	if len(m.configSubitems) == 0 {
		emptyMsg := "No configurations."
		if m.activeAction != nil && m.activeAction.EmptySubitemsMessage != "" {
			emptyMsg = m.activeAction.EmptySubitemsMessage
		}
		lines = append(lines, emptyMsg)
		return strings.Join(lines, "\n")
	}

	idx := render.ClampSelectedIndex(m.configItemSelectedIndex, len(m.configSubitems))
	numberWidth := 2

	for i := range m.configSubitems {
		num := fmt.Sprintf("%d.", i)
		if len(num) > numberWidth {
			numberWidth = len(num)
		}
	}

	for vi, item := range m.configSubitems {
		itemIndex := vi
		prefix := "  "
		if itemIndex == idx {
			prefix = "> "
		}

		marker := "[ ] "
		if item.Selected {
			marker = "[✔] "
		}

		line := fmt.Sprintf("%s%s %s%s", prefix, render.PadDisplay(fmt.Sprintf("%d.", itemIndex), numberWidth, "right"), marker, item.Label)
		fittedLine := render.FitLine(line, m.width)
		if item.Selected {
			fittedLine = render.Colorize(fittedLine, render.ANSISelectedConfig, m.useColor)
		} else if itemIndex == idx {
			fittedLine = render.Colorize(fittedLine, render.ANSISelected, m.useColor)
		}
		lines = append(lines, fittedLine)
	}

	return strings.Join(lines, "\n")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
