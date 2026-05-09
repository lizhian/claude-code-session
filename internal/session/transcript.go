package session

import (
	"strconv"
	"strings"

	"github.com/lizhian/agent-session/internal/provider"
)

// TranscriptResult holds normalized conversation messages with truncation info.
type TranscriptResult struct {
	Messages      []ConversationMessage `json:"messages"`
	TotalMessages int                   `json:"totalMessages"`
	Truncated     bool                  `json:"truncated"`
	SkippedCount  int                   `json:"skippedCount"`
	MessageLimit  int                   `json:"messageLimit"`
	HeadCount     int                   `json:"headCount"`
}

// ConversationMessage is a useful user or assistant message in a conversation transcript.
type ConversationMessage struct {
	Role      string `json:"role"`
	Timestamp string `json:"timestamp"`
	Text      string `json:"text"`
	Ordinal   int    `json:"ordinal"`
}

const (
	DefaultTranscriptMessageLimit = 30
	DefaultTranscriptHeadCount    = 10
)

// NormalizeTranscriptMessages filters useful dialogue messages and applies head/tail truncation.
func NormalizeTranscriptMessages(messages []provider.TranscriptMessage, messageLimit, headCount int) TranscriptResult {
	if messageLimit <= 0 {
		messageLimit = DefaultTranscriptMessageLimit
	}
	if headCount <= 0 {
		headCount = DefaultTranscriptHeadCount
	}
	tailCount := messageLimit - headCount
	if tailCount < 0 {
		tailCount = 0
	}

	var dialogue []ConversationMessage
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		text := strings.TrimSpace(msg.Text)
		if !isUsefulDialogueText(text) {
			continue
		}
		dialogue = append(dialogue, ConversationMessage{
			Role:      role,
			Timestamp: msg.Timestamp,
			Text:      text,
			Ordinal:   len(dialogue) + 1,
		})
	}

	leadingCount := headCount
	if leadingCount > messageLimit {
		leadingCount = messageLimit
	}
	trailingCount := tailCount
	if trailingCount > messageLimit-leadingCount {
		trailingCount = messageLimit - leadingCount
	}
	if trailingCount < 0 {
		trailingCount = 0
	}

	var selected []ConversationMessage
	if len(dialogue) > messageLimit {
		selected = make([]ConversationMessage, 0, leadingCount+trailingCount+1)
		selected = append(selected, dialogue[:leadingCount]...)
		skippedCount := len(dialogue) - leadingCount - trailingCount
		if skippedCount > 0 {
			selected = append(selected, ConversationMessage{Role: "omitted", Text: skippedMessageText(skippedCount)})
		}
		if trailingCount > 0 {
			selected = append(selected, dialogue[len(dialogue)-trailingCount:]...)
		}
	} else {
		selected = dialogue
	}

	skippedCount := len(dialogue) - len(selected)
	if len(dialogue) > messageLimit {
		skippedCount = len(dialogue) - leadingCount - trailingCount
	}
	if skippedCount < 0 {
		skippedCount = 0
	}

	return TranscriptResult{
		Messages:      selected,
		TotalMessages: len(dialogue),
		Truncated:     skippedCount > 0,
		SkippedCount:  skippedCount,
		MessageLimit:  messageLimit,
		HeadCount:     headCount,
	}
}

func isUsefulDialogueText(text string) bool {
	if strings.TrimSpace(text) == "" {
		return false
	}
	lower := strings.ToLower(text)
	noiseMarkers := []string{
		"<local-command-stdout>",
		"<local-command-stderr>",
		"<command-name>",
		"<command-message>",
		"<command-args>",
		"tool_use",
		"tool_result",
	}
	for _, marker := range noiseMarkers {
		if strings.Contains(lower, marker) {
			return false
		}
	}
	return true
}

func skippedMessageText(count int) string {
	if count == 1 {
		return "[1 message omitted]"
	}
	return "[" + strconv.Itoa(count) + " messages omitted]"
}
