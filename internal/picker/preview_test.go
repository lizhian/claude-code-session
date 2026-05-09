package picker

import (
	"strings"
	"testing"
)

func TestTruncatePreviewMessageTextKeepsFirstAndLastRunes(t *testing.T) {
	text := strings.Repeat("你", 251) + strings.Repeat("中", 10) + strings.Repeat("好", 251)

	got := truncatePreviewMessageText(text)

	wantPrefix := strings.Repeat("你", 250)
	wantSuffix := strings.Repeat("好", 250)
	if !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("missing prefix")
	}
	if !strings.HasSuffix(got, wantSuffix) {
		t.Fatalf("missing suffix")
	}
	if !strings.Contains(got, "\n\n.\n.\n.\n[12 chars truncated]\n.\n.\n.\n\n") {
		t.Fatalf("missing truncation marker in %q", got)
	}
}

func TestTruncatePreviewMessageTextLeavesShortTextUnchanged(t *testing.T) {
	text := strings.Repeat("a", 500)
	if got := truncatePreviewMessageText(text); got != text {
		t.Fatalf("got %q, want unchanged", got)
	}
}

func TestTruncatePreviewMessageTextCountsNonWhitespaceRunes(t *testing.T) {
	text := strings.Repeat("a ", 250) + strings.Repeat("m ", 10) + strings.Repeat("z ", 250)

	got := truncatePreviewMessageText(text)

	if !strings.HasPrefix(got, strings.Repeat("a ", 250)) {
		t.Fatalf("missing whitespace-preserving prefix")
	}
	if !strings.HasSuffix(got, strings.Repeat("z ", 250)) {
		t.Fatalf("missing whitespace-preserving suffix")
	}
	if !strings.Contains(got, "[10 chars truncated]") {
		t.Fatalf("missing non-whitespace truncation count in %q", got)
	}
}
