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
