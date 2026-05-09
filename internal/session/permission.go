package session

// DefaultPermissionModes is the standard set of permission modes.
var DefaultPermissionModes = []string{"default", "auto", "full"}

// OpenCodePermissionModes is the reduced set for OpenCode (no "auto").
var OpenCodePermissionModes = []string{"default", "full"}

// NormalizePermissionMode returns a valid permission mode from the supported
// set, defaulting to "default" if the input is not recognized.
func NormalizePermissionMode(mode string, supported []string) string {
	if supported == nil {
		supported = DefaultPermissionModes
	}
	if mode == "" {
		return "default"
	}
	// Map legacy launch modes.
	switch mode {
	case "trust":
		mode = "full"
	case "normal":
		mode = "default"
	}
	for _, m := range supported {
		if m == mode {
			return mode
		}
	}
	return "default"
}

// NextPermissionMode cycles through the supported permission modes.
func NextPermissionMode(current string, supported []string) string {
	if supported == nil {
		supported = DefaultPermissionModes
	}
	for i, m := range supported {
		if m == current && i < len(supported)-1 {
			return supported[i+1]
		}
	}
	return supported[0]
}

// SupportedPermissionModes filters a candidate list down to valid modes,
// returning DefaultPermissionModes if none are valid.
func SupportedPermissionModes(candidates []string) []string {
	valid := []string{}
	for _, c := range candidates {
		for _, d := range DefaultPermissionModes {
			if c == d {
				valid = append(valid, c)
				break
			}
		}
	}
	if len(valid) == 0 {
		return DefaultPermissionModes
	}
	return valid
}
