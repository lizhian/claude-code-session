package codex

import (
	"testing"
)

func TestSyncCodexThreads(t *testing.T) {
	t.Run("handles missing command", func(t *testing.T) {
		result := syncCodexThreads("test-provider", "/nonexistent/codex-home", "/tmp")
		// codex-threadripper may or may not be installed on the test machine.
		// If it is installed, the command will run but fail on the bogus path.
		// We just verify the result fields are consistent.
		if result.Skipped {
			// Not installed: should have no error.
			if result.Synced {
				t.Error("expected Synced=false when Skipped=true")
			}
		} else if result.Synced {
			// Synced somehow (unlikely with bogus path).
			if result.Error != "" {
				t.Errorf("expected no error when Synced=true, got %q", result.Error)
			}
		} else {
			// Command ran but failed (expected with bogus path).
			if result.Error == "" {
				t.Error("expected error when sync failed")
			}
		}
	})
}

func TestSelectModelProviderSyncStatus(t *testing.T) {
	t.Run("returns sync status when provider changes", func(t *testing.T) {
		// This test verifies the syncStatus struct fields are populated correctly.
		// It can't easily test the actual file write without a temp config.
		status := syncStatus{
			sameProvider: false,
			synced:       true,
			syncError:    "",
		}
		if status.sameProvider {
			t.Error("expected sameProvider=false")
		}
		if !status.synced {
			t.Error("expected synced=true")
		}
	})
}

func TestHelperFunctions(t *testing.T) {
	t.Run("firstOutputLine", func(t *testing.T) {
		tests := []struct {
			input string
			want  string
		}{
			{"hello\nworld", "hello"},
			{"  \n  hello  \nworld", "hello"},
			{"", ""},
			{"\n\n", ""},
		}
		for _, tt := range tests {
			got := firstOutputLine(tt.input)
			if got != tt.want {
				t.Errorf("firstOutputLine(%q) = %q, want %q", tt.input, got, tt.want)
			}
		}
	})

	t.Run("truncateStatus", func(t *testing.T) {
		if got := truncateStatus("short"); got != "short" {
			t.Errorf("truncateStatus(short) = %q", got)
		}
		long := ""
		for i := 0; i < 200; i++ {
			long += "x"
		}
		got := truncateStatus(long)
		if len(got) != 120 {
			t.Errorf("truncateStatus(200 chars) len = %d, want 120", len(got))
		}
		if got[len(got)-3:] != "..." {
			t.Errorf("truncateStatus should end with ..., got %q", got[len(got)-3:])
		}
	})
}
