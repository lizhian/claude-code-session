package session

import (
	"os"
	"os/exec"
	"syscall"
)

// RunCommand launches a subprocess with the given command, args, cwd, and env.
func RunCommand(command string, args []string, cwd string, env map[string]string) error {
	cmd := exec.Command(command, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if cwd != "" {
		cmd.Dir = cwd
	}
	if env != nil {
		cmd.Env = os.Environ()
		for k, v := range env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	}
	return cmd.Run()
}

// RunCommandExitCode runs a command and returns its exit code.
// Returns -1 if the command fails to start.
func RunCommandExitCode(command string, args []string, cwd string, env map[string]string) (int, error) {
	cmd := exec.Command(command, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if cwd != "" {
		cmd.Dir = cwd
	}
	if env != nil {
		cmd.Env = os.Environ()
		for k, v := range env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	}
	err := cmd.Run()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				return status.ExitStatus(), nil
			}
		}
		return -1, err
	}
	return 0, nil
}
