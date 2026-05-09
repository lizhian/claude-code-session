package session

import (
	"strings"

	"github.com/lizhian/agent-session/internal/provider"
)

// TranscriptResult holds normalized transcript messages with truncation info.
type TranscriptResult struct {
	Messages      []TranscriptUserMessage `json:"messages"`
	TotalMessages int                      `json:"totalMessages"`
	Truncated     bool                     `json:"truncated"`
	SkippedCount  int                      `json:"skippedCount"`
	MessageLimit  int                      `json:"messageLimit"`
	HeadCount     int                      `json:"headCount"`
}

// TranscriptUserMessage is a user-visible message in a transcript.
type TranscriptUserMessage struct {
	Role      string `json:"role"`
	Timestamp string `json:"timestamp"`
	Text      string `json:"text"`
	Ordinal   int    `json:"ordinal"`
}

const (
	DefaultTranscriptMessageLimit = 100
	DefaultTranscriptHeadCount    = 20
)

// NormalizeTranscriptMessages filters user messages and applies head/tail truncation.
func NormalizeTranscriptMessages(messages []provider.TranscriptMessage, messageLimit, headCount int) TranscriptResult {
	if messageLimit <= 0 {
		messageLimit = DefaultTranscriptMessageLimit
	}
	if headCount < 0 {
		headCount = DefaultTranscriptHeadCount
	}
	tailCount := messageLimit - headCount
	if tailCount < 0 {
		tailCount = 0
	}

	var userMessages []TranscriptUserMessage
	for _, msg := range messages {
		role := strings.ToLower(msg.Role)
		if role != "user" {
			continue
		}
		text := strings.TrimSpace(msg.Text)
		if text == "" {
			continue
		}
		userMessages = append(userMessages, TranscriptUserMessage{
			Role:      "user",
			Timestamp: msg.Timestamp,
			Text:      text,
			Ordinal:   len(userMessages) + 1,
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

	var selected []TranscriptUserMessage
	if len(userMessages) > messageLimit {
		selected = make([]TranscriptUserMessage, 0, leadingCount+trailingCount)
		selected = append(selected, userMessages[:leadingCount]...)
		if trailingCount > 0 {
			selected = append(selected, userMessages[len(userMessages)-trailingCount:]...)
		}
	} else {
		selected = userMessages
	}

	skippedCount := len(userMessages) - len(selected)
	if skippedCount < 0 {
		skippedCount = 0
	}

	return TranscriptResult{
		Messages:      selected,
		TotalMessages: len(userMessages),
		Truncated:     skippedCount > 0,
		SkippedCount:  skippedCount,
		MessageLimit:  messageLimit,
		HeadCount:     headCount,
	}
}
