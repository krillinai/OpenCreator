package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func main() {
	args := os.Args[1:]
	if len(args) == 1 && args[0] == "--version" {
		fmt.Println("codex-cli 0.149.0")
		return
	}
	if outputIndex := argumentIndex(args, "--output-last-message"); outputIndex >= 0 {
		runProbe(args, outputIndex)
		return
	}
	runJavaScriptFixture(args)
}

func runProbe(args []string, outputIndex int) {
	stateDir := requireEnv("CLAWEE_E2E_FAKE_CODEX_STATE_DIR")
	must(os.MkdirAll(stateDir, 0o755))
	increment(filepath.Join(stateDir, "probe-count.txt"))
	must(os.WriteFile(filepath.Join(stateDir, "probe-pid.txt"), []byte(strconv.Itoa(os.Getpid())), 0o644))

	mode := os.Getenv("CLAWEE_E2E_FAKE_CODEX_MODE")
	switch mode {
	case "probe-failure":
		fmt.Fprintln(os.Stderr, "fake Codex probe failed by request")
		os.Exit(17)
	case "probe-no-response":
		return
	case "probe-tool-used":
		writeJSON(map[string]any{
			"type": "item.completed",
			"item": map[string]any{"type": "command_execution", "command": "echo unsafe"},
		})
		writeJSON(map[string]any{
			"type": "item.completed",
			"item": map[string]any{"type": "agent_message", "text": "unsafe response"},
		})
		return
	case "probe-hang", "probe-hang-ignore-term":
		for {
			time.Sleep(time.Hour)
		}
	}

	prompt, err := io.ReadAll(bufio.NewReader(os.Stdin))
	must(err)
	marker := regexp.MustCompile(`CLAWEE_READY_[a-f0-9]+`).FindString(string(prompt))
	response := "hello from fake Codex"
	if marker != "" {
		response += " " + marker
	}
	if outputIndex+1 < len(args) {
		must(os.WriteFile(args[outputIndex+1], []byte(response), 0o644))
	}
	writeJSON(map[string]any{
		"type": "item.completed",
		"item": map[string]any{"type": "agent_message", "text": response},
	})
}

func runJavaScriptFixture(args []string) {
	recordCurrentProcess()
	nodeBinary := requireEnv("CLAWEE_E2E_NODE_BINARY")
	script := requireEnv("CLAWEE_E2E_FAKE_CODEX_SCRIPT")
	command := exec.Command(nodeBinary, append([]string{script}, args...)...)
	command.Env = os.Environ()
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			os.Exit(exitError.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func recordCurrentProcess() {
	stateDir := requireEnv("CLAWEE_E2E_FAKE_CODEX_STATE_DIR")
	must(os.MkdirAll(stateDir, 0o755))
	file, err := os.OpenFile(
		filepath.Join(stateDir, "app-server-pids.txt"),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY,
		0o644,
	)
	must(err)
	_, err = fmt.Fprintln(file, os.Getpid())
	must(err)
	must(file.Close())
}

func argumentIndex(args []string, target string) int {
	for index, argument := range args {
		if argument == target {
			return index
		}
	}
	return -1
}

func increment(path string) {
	value := 0
	if current, err := os.ReadFile(path); err == nil {
		value, _ = strconv.Atoi(strings.TrimSpace(string(current)))
	}
	must(os.WriteFile(path, []byte(strconv.Itoa(value+1)), 0o644))
}

func writeJSON(value any) {
	encoded, err := json.Marshal(value)
	must(err)
	fmt.Println(string(encoded))
}

func requireEnv(name string) string {
	value := os.Getenv(name)
	if value == "" {
		fmt.Fprintf(os.Stderr, "%s is required\n", name)
		os.Exit(2)
	}
	return value
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
