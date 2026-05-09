package picker

import (
	"strings"
	"testing"
)

func TestTruncatePreviewMessageTextKeepsFirstAndLastRunes(t *testing.T) {
	text := strings.Repeat("你", 151) + strings.Repeat("中", 10) + strings.Repeat("好", 151)

	got := truncatePreviewMessageText(text)

	wantPrefix := strings.Repeat("你", 150)
	wantSuffix := strings.Repeat("好", 150)
	if !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("missing prefix")
	}
	if !strings.HasSuffix(got, wantSuffix) {
		t.Fatalf("missing suffix")
	}
	if !strings.Contains(got, "\n\n[12 chars truncated]\n\n") {
		t.Fatalf("missing truncation marker in %q", got)
	}
}

func TestTruncatePreviewMessageTextLeavesShortTextUnchanged(t *testing.T) {
	text := strings.Repeat("a", 300)
	if got := truncatePreviewMessageText(text); got != text {
		t.Fatalf("got %q, want unchanged", got)
	}
}
