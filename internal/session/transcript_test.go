package session

import (
	"testing"

	"github.com/lizhian/agent-session/internal/provider"
)

func TestNormalizeTranscriptMessagesIncludesUserAndAssistant(t *testing.T) {
	result := NormalizeTranscriptMessages([]provider.TranscriptMessage{
		{Role: "user", Text: "hello", Timestamp: "t1"},
		{Role: "assistant", Text: "hi", Timestamp: "t2"},
		{Role: "system", Text: "ignore", Timestamp: "t3"},
	}, 0, 0)

	if len(result.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(result.Messages))
	}
	if result.Messages[0].Role != "user" || result.Messages[1].Role != "assistant" {
		t.Fatalf("roles = %q, %q; want user, assistant", result.Messages[0].Role, result.Messages[1].Role)
	}
}

func TestNormalizeTranscriptMessagesFiltersNoise(t *testing.T) {
	result := NormalizeTranscriptMessages([]provider.TranscriptMessage{
		{Role: "assistant", Text: "<local-command-stdout>noise</local-command-stdout>"},
		{Role: "assistant", Text: "useful reply"},
	}, 0, 0)

	if len(result.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result.Messages))
	}
	if result.Messages[0].Text != "useful reply" {
		t.Fatalf("message = %q", result.Messages[0].Text)
	}
}

func TestNormalizeTranscriptMessagesUsesFirstTenLastTwenty(t *testing.T) {
	var messages []provider.TranscriptMessage
	for i := 1; i <= 40; i++ {
		messages = append(messages, provider.TranscriptMessage{Role: "user", Text: "msg"})
	}

	result := NormalizeTranscriptMessages(messages, 0, 0)
	if result.TotalMessages != 40 {
		t.Fatalf("TotalMessages = %d, want 40", result.TotalMessages)
	}
	if !result.Truncated || result.SkippedCount != 10 {
		t.Fatalf("Truncated=%v SkippedCount=%d, want true/10", result.Truncated, result.SkippedCount)
	}
	if len(result.Messages) != 31 { // first 10 + omitted marker + last 20
		t.Fatalf("len(Messages) = %d, want 31", len(result.Messages))
	}
	if result.Messages[10].Role != "omitted" || result.Messages[10].Text != "[10 messages omitted]" {
		t.Fatalf("omitted marker = %#v", result.Messages[10])
	}
	if result.Messages[0].Ordinal != 1 || result.Messages[9].Ordinal != 10 || result.Messages[11].Ordinal != 21 {
		t.Fatalf("unexpected ordinals around truncation: %d %d %d", result.Messages[0].Ordinal, result.Messages[9].Ordinal, result.Messages[11].Ordinal)
	}
}
