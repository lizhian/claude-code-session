package picker

import "testing"

func TestClearTerminalAndScrollbackClearsVisibleScreenAndScrollback(t *testing.T) {
	const want = "\x1b[H\x1b[2J\x1b[3J"
	if clearTerminalAndScrollback != want {
		t.Fatalf("clearTerminalAndScrollback = %q, want %q", clearTerminalAndScrollback, want)
	}
}
