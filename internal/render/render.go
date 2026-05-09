package render

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/lizhian/agent-session/internal/provider"
	"github.com/lizhian/agent-session/internal/session"
)

// ANSI escape codes for colored output.
var (
	ANSIReset          = "\x1b[0m"
	ANSIPermDefault    = "\x1b[32m"
	ANSIPermAuto       = "\x1b[34m"
	ANSIPermFull       = "\x1b[31m"
	ANSIPreviewMeta    = "\x1b[36m"
	ANSIPreviewHeader  = "\x1b[38;5;208m"
	ANSIPreviewMuted   = "\x1b[90m"
	ANSIPreviewOmitted = "\x1b[33m"
	ANSISelected       = "\x1b[36m"
	ANSISelectedConfig = "\x1b[34m"
)

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func Colorize(value, color string, enabled bool) string {
	if enabled {
		return color + value + ANSIReset
	}
	return value
}

func stripAnsi(value string) string {
	return ansiRe.ReplaceAllString(value, "")
}

// charWidth returns the display width of a single rune.
func charWidth(r rune) int {
	code := uint32(r)
	if code == 0 || code < 32 || (code >= 0x7f && code < 0xa0) {
		return 0
	}
	// Combining marks.
	if (code >= 0x0300 && code <= 0x036f) ||
		(code >= 0x1ab0 && code <= 0x1aff) ||
		(code >= 0x1dc0 && code <= 0x1dff) ||
		(code >= 0x20d0 && code <= 0x20ff) ||
		(code >= 0xfe20 && code <= 0xfe2f) {
		return 0
	}
	// Wide characters (CJK, emoji, etc).
	if (code >= 0x1100 && code <= 0x115f) ||
		code == 0x2329 || code == 0x232a ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe10 && code <= 0xfe19) ||
		(code >= 0xfe30 && code <= 0xfe6f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1faff) ||
		(code >= 0x20000 && code <= 0x3fffd) {
		return 2
	}
	return 1
}

// DisplayWidth returns the visual display width of a string, accounting for
// ANSI escape codes and East Asian wide characters.
func DisplayWidth(value string) int {
	width := 0
	for _, r := range stripAnsi(value) {
		width += charWidth(r)
	}
	return width
}

// TruncateToWidth truncates a string to fit within maxWidth display columns.
func TruncateToWidth(value string, maxWidth int) string {
	text := strings.TrimSpace(stripAnsi(value))
	text = replaceWhitespace(text)
	if DisplayWidth(text) <= maxWidth {
		return text
	}
	if maxWidth <= 3 {
		return strings.Repeat(".", max(0, maxWidth))
	}

	suffix := "..."
	allowedWidth := maxWidth - DisplayWidth(suffix)
	var output strings.Builder
	width := 0
	for _, r := range text {
		nextWidth := charWidth(r)
		if width+nextWidth > allowedWidth {
			break
		}
		output.WriteRune(r)
		width += nextWidth
	}
	return output.String() + suffix
}

func replaceWhitespace(s string) string {
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		} else {
			b.WriteRune(r)
			prevSpace = false
		}
	}
	return b.String()
}

// PadDisplay pads a string to a given display width.
func PadDisplay(value string, width int, align string) string {
	text := value
	padding := width - DisplayWidth(text)
	if padding <= 0 {
		return text
	}
	pad := strings.Repeat(" ", padding)
	if align == "right" {
		return pad + text
	}
	return text + pad
}

// FitLine truncates a line to fit within the given width.
func FitLine(value string, width int) string {
	if DisplayWidth(value) <= width {
		return value
	}
	return TruncateToWidth(value, width)
}

// ShortSessionID returns the first 8 chars of the first segment of a session ID.
func ShortSessionID(id string) string {
	parts := strings.SplitN(id, "-", 2)
	if len(parts[0]) > 8 {
		return parts[0][:8]
	}
	return parts[0]
}

// FormatSessionTime formats a timestamp as a relative time string.
func FormatSessionTime(timestamp string, now time.Time) string {
	if timestamp == "" {
		return "-"
	}
	t, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		// Try parsing as ISO format without timezone.
		t, err = time.Parse("2006-01-02T15:04:05", timestamp)
		if err != nil {
			return "-"
		}
	}
	diffMs := now.Sub(t).Milliseconds()
	if diffMs < 0 {
		diffMs = 0
	}
	minuteMs := int64(60 * 1000)
	hourMs := int64(60 * minuteMs)
	dayMs := int64(24 * hourMs)

	if diffMs < minuteMs {
		return "刚刚"
	}
	if diffMs < hourMs {
		return fmt.Sprintf("%d分钟前", diffMs/minuteMs)
	}
	if diffMs < dayMs {
		return fmt.Sprintf("%d小时前", diffMs/hourMs)
	}
	if diffMs < 7*dayMs {
		return fmt.Sprintf("%d天前", diffMs/dayMs)
	}
	return t.Format("2006-01-02")
}

// FormatDateTime formats a time for detailed display.
func FormatDateTime(t time.Time) string {
	return t.Format("2006-01-02 15:04:05")
}

// DisplayFirstUserMessage returns the first user message or fallback.
func DisplayFirstUserMessage(s provider.Session) string {
	if s.FirstUserMessage != "" {
		return s.FirstUserMessage
	}
	return s.LastUserMessage
}

// DisplayLastUserMessage returns the last user message or fallback.
func DisplayLastUserMessage(s provider.Session) string {
	if s.LastUserMessage != "" {
		return s.LastUserMessage
	}
	return s.FirstUserMessage
}

// SessionSearchText builds a searchable text from a session.
func SessionSearchText(s provider.Session) string {
	parts := []string{
		s.ID,
		ShortSessionID(s.ID),
		s.Cwd,
		s.GitBranch,
		s.Version,
		s.UpdatedAt,
		s.StartedAt,
		s.FirstUserMessage,
		s.LastUserMessage,
	}
	return strings.ToLower(strings.Join(filterNonEmpty(parts), " "))
}

func filterNonEmpty(parts []string) []string {
	var result []string
	for _, p := range parts {
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

// FilterSessions filters sessions by query terms.
func FilterSessions(sessions []provider.Session, query string) []provider.Session {
	terms := session.SearchTerms(query)
	if len(terms) == 0 {
		return sessions
	}
	var result []provider.Session
	for _, s := range sessions {
		text := SessionSearchText(s)
		if session.MatchSearch(text, terms) {
			result = append(result, s)
		}
	}
	return result
}

// SplitPromptWidths divides available width between first and last prompt columns.
func SplitPromptWidths(availableWidth int) (firstWidth, lastWidth int) {
	if availableWidth < 5 {
		return max(0, availableWidth), 0
	}
	separatorWidth := 2
	promptsWidth := availableWidth - separatorWidth
	firstWidth = max(1, promptsWidth/2)
	lastWidth = max(1, promptsWidth-firstWidth)
	return
}

// PermissionModeColor returns the ANSI color for a permission mode.
func PermissionModeColor(mode string) string {
	switch mode {
	case "auto":
		return ANSIPermAuto
	case "full":
		return ANSIPermFull
	default:
		return ANSIPermDefault
	}
}

// PickerStatusLine renders the status bar for the interactive picker.
func PickerStatusLine(permissionMode string, filteredCount int, query string, useColor bool) string {
	mode := session.NormalizePermissionMode(permissionMode, nil)
	modeStr := Colorize(mode, PermissionModeColor(mode), useColor)
	perm := PadDisplay("Permission: "+modeStr, 24, "left")
	matches := PadDisplay(fmt.Sprintf("Matches: %d", filteredCount), 18, "left")
	return perm + matches + "Search: " + query
}

// FormatPicker formats sessions for the non-interactive numbered picker.
func FormatPicker(sessions []provider.Session, now time.Time) string {
	lines := []string{"0. new"}
	for i, s := range sessions {
		updated := FormatSessionTime(s.UpdatedAt, now)
		first := DisplayFirstUserMessage(s)
		last := DisplayLastUserMessage(s)
		prompt := first
		if last != "" && last != first {
			prompt = first + "  |  " + last
		}
		if len(prompt) > 96 {
			prompt = prompt[:95] + "..."
		}
		if prompt == "" {
			prompt = "-"
		}
		lines = append(lines, fmt.Sprintf("%d. %s  %d messages  %s", i+1, updated, s.MessageCount, prompt))
	}
	return strings.Join(lines, "\n")
}

// FormatSessions formats sessions as a text table.
func FormatSessions(sessions []provider.Session, providerName string) string {
	if len(sessions) == 0 {
		return "当前目录没有找到 " + providerName + " session。"
	}

	type row struct {
		number      string
		messages    string
		updated     string
		started     string
		firstPrompt string
		lastPrompt  string
	}

	rows := make([]row, len(sessions))
	for i, s := range sessions {
		first := DisplayFirstUserMessage(s)
		last := DisplayLastUserMessage(s)
		r := replaceWhitespace(first)
		if len(r) > 40 {
			r = r[:39] + "..."
		}
		l := replaceWhitespace(last)
		if len(l) > 40 {
			l = l[:39] + "..."
		}
		rows[i] = row{
			number:      fmt.Sprintf("%d", i+1),
			messages:    fmt.Sprintf("%d", s.MessageCount),
			updated:     s.UpdatedAt,
			started:     s.StartedAt,
			firstPrompt: r,
			lastPrompt:  l,
		}
	}

	// Calculate column widths.
	numberWidth := 1
	messagesWidth := 8
	updatedWidth := 7
	startedWidth := 7
	firstPromptWidth := 17

	for _, r := range rows {
		if len(r.number) > numberWidth {
			numberWidth = len(r.number)
		}
		if len(r.messages) > messagesWidth {
			messagesWidth = len(r.messages)
		}
		if len(r.updated) > updatedWidth {
			updatedWidth = len(r.updated)
		}
		if len(r.started) > startedWidth {
			startedWidth = len(r.started)
		}
		if DisplayWidth(r.firstPrompt) > firstPromptWidth {
			firstPromptWidth = DisplayWidth(r.firstPrompt)
		}
	}

	pad := func(s string, w int) string {
		return s + strings.Repeat(" ", max(0, w-len(s)))
	}

	var lines []string
	lines = append(lines, fmt.Sprintf("%s  %s  %s  %s  %s  LAST USER MESSAGE",
		pad("#", numberWidth),
		pad("MESSAGES", messagesWidth),
		pad("UPDATED", updatedWidth),
		pad("STARTED", startedWidth),
		PadDisplay("FIRST USER MESSAGE", firstPromptWidth, "left"),
	))
	lines = append(lines, fmt.Sprintf("%s  %s  %s  %s  %s  %s",
		strings.Repeat("-", numberWidth),
		strings.Repeat("-", messagesWidth),
		strings.Repeat("-", updatedWidth),
		strings.Repeat("-", startedWidth),
		strings.Repeat("-", firstPromptWidth),
		strings.Repeat("-", 17),
	))

	for _, r := range rows {
		lines = append(lines, fmt.Sprintf("%s  %s  %s  %s  %s  %s",
			pad(r.number, numberWidth),
			pad(r.messages, messagesWidth),
			pad(r.updated, updatedWidth),
			pad(r.started, startedWidth),
			PadDisplay(r.firstPrompt, firstPromptWidth, "left"),
			r.lastPrompt,
		))
	}
	return strings.Join(lines, "\n")
}

// WrapText wraps text to fit within the given display width.
func WrapText(value string, width int) []string {
	text := replaceWhitespace(strings.TrimSpace(value))
	return wrapSingleLine(text, width)
}

// WrapTextPreserveNewlines wraps text while preserving explicit line breaks.
func WrapTextPreserveNewlines(value string, width int) []string {
	text := strings.TrimRight(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	if strings.TrimSpace(text) == "" {
		return []string{"-"}
	}
	var lines []string
	for _, part := range strings.Split(text, "\n") {
		wrapped := wrapSingleLine(strings.TrimRight(part, "\r"), width)
		lines = append(lines, wrapped...)
	}
	if len(lines) == 0 {
		return []string{"-"}
	}
	return lines
}

func wrapSingleLine(text string, width int) []string {
	if text == "" {
		return []string{""}
	}
	if width <= 1 {
		return []string{TruncateToWidth(text, width)}
	}

	var lines []string
	var line strings.Builder
	lineWidth := 0

	for _, r := range text {
		nextWidth := charWidth(r)
		if line.Len() > 0 && lineWidth+nextWidth > width {
			lines = append(lines, line.String())
			line.Reset()
			lineWidth = 0
		}
		line.WriteRune(r)
		lineWidth += nextWidth
	}

	if line.Len() > 0 {
		lines = append(lines, line.String())
	}
	if len(lines) == 0 {
		return []string{"-"}
	}
	return lines
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ClampSelectedIndex ensures the index is within valid bounds.
func ClampSelectedIndex(selected, itemCount int) int {
	if itemCount <= 0 {
		return 0
	}
	if selected < 0 {
		return 0
	}
	if selected >= itemCount {
		return itemCount - 1
	}
	return selected
}
