package main

import "testing"

func TestResolveProviderInvocation(t *testing.T) {
	tests := []struct {
		name          string
		bin           string
		args          []string
		wantProvider  string
		wantRemaining []string
		wantUsage     bool
		wantErr       bool
	}{
		{
			name:          "canonical claude symlink",
			bin:           "c",
			args:          []string{"--cwd", "/tmp/project"},
			wantProvider:  "claude",
			wantRemaining: []string{"--cwd", "/tmp/project"},
		},
		{
			name:          "legacy claude symlink",
			bin:           "cc",
			args:          []string{"--cwd", "/tmp/project"},
			wantProvider:  "claude",
			wantRemaining: []string{"--cwd", "/tmp/project"},
		},
		{
			name:          "canonical claude subcommand",
			bin:           "agent-session",
			args:          []string{"c", "--cwd", "/tmp/project"},
			wantProvider:  "claude",
			wantRemaining: []string{"--cwd", "/tmp/project"},
		},
		{
			name:          "legacy claude subcommand",
			bin:           "agent-session",
			args:          []string{"cc", "--cwd", "/tmp/project"},
			wantProvider:  "claude",
			wantRemaining: []string{"--cwd", "/tmp/project"},
		},
		{
			name:          "windows extension",
			bin:           "c.exe",
			args:          []string{"--help"},
			wantProvider:  "claude",
			wantRemaining: []string{"--help"},
		},
		{
			name:          "top level help",
			bin:           "agent-session",
			args:          []string{"--help"},
			wantRemaining: []string{"--help"},
			wantUsage:     true,
		},
		{
			name:          "unknown command",
			bin:           "agent-session",
			args:          []string{"unknown"},
			wantRemaining: []string{"unknown"},
			wantErr:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotProvider, gotRemaining, gotUsage, err := resolveProviderInvocation(tt.bin, tt.args)
			if (err != nil) != tt.wantErr {
				t.Fatalf("resolveProviderInvocation() error = %v, wantErr %v", err, tt.wantErr)
			}
			if gotProvider != tt.wantProvider {
				t.Fatalf("provider = %q, want %q", gotProvider, tt.wantProvider)
			}
			if gotUsage != tt.wantUsage {
				t.Fatalf("showUsage = %v, want %v", gotUsage, tt.wantUsage)
			}
			if len(gotRemaining) != len(tt.wantRemaining) {
				t.Fatalf("remaining args = %v, want %v", gotRemaining, tt.wantRemaining)
			}
			for i := range gotRemaining {
				if gotRemaining[i] != tt.wantRemaining[i] {
					t.Fatalf("remaining args = %v, want %v", gotRemaining, tt.wantRemaining)
				}
			}
		})
	}
}
