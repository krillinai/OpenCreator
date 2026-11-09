package config

import (
	"runtime"
	"strings"
	"testing"
)

func TestBaseConfigDoesNotRequireTranscriptionCredentials(t *testing.T) {
	previous := Conf
	t.Cleanup(func() { Conf = previous })

	Conf.App.Proxy = ""
	Conf.Transcribe.Provider = "openai"
	Conf.Transcribe.Openai.ApiKey = ""

	if err := CheckBaseConfig(); err != nil {
		t.Fatalf("CheckBaseConfig() error = %v", err)
	}
	if err := ValidateTranscriptionConfig(); err == nil {
		t.Fatal("ValidateTranscriptionConfig() error = nil, want missing API key")
	}
}

func TestProxyForBaseURLBypassesLoopback(t *testing.T) {
	proxy := "http://127.0.0.1:7897"
	for _, baseURL := range []string{
		"http://127.0.0.1:19861/v1",
		"http://localhost:19861/v1",
		"http://[::1]:19861/v1",
	} {
		if got := ProxyForBaseURL(baseURL, proxy); got != "" {
			t.Errorf("ProxyForBaseURL(%q) = %q, want direct connection", baseURL, got)
		}
	}
	if got := ProxyForBaseURL("https://api.example.com/v1", proxy); got != proxy {
		t.Errorf("ProxyForBaseURL(remote) = %q, want %q", got, proxy)
	}
}

func TestValidateTranscriptionConfigAcceptsTinyWhisperCpp(t *testing.T) {
	previous := Conf
	t.Cleanup(func() { Conf = previous })

	Conf.Transcribe.Provider = "whispercpp"
	Conf.Transcribe.Whispercpp.Model = "tiny"

	err := ValidateTranscriptionConfig()
	if runtime.GOOS == "windows" && err != nil {
		t.Fatalf("ValidateTranscriptionConfig() error = %v", err)
	}
	if runtime.GOOS != "windows" && (err == nil || !strings.Contains(err.Error(), "only support windows")) {
		t.Fatalf("ValidateTranscriptionConfig() error = %v, want platform error", err)
	}
}

func TestValidateTranscriptionConfigAcceptsLargeV3TurboWhisperCpp(t *testing.T) {
	previous := Conf
	t.Cleanup(func() { Conf = previous })

	Conf.Transcribe.Provider = "whispercpp"
	Conf.Transcribe.Whispercpp.Model = "large-v3-turbo"

	err := ValidateTranscriptionConfig()
	if runtime.GOOS == "windows" && err != nil {
		t.Fatalf("ValidateTranscriptionConfig() error = %v", err)
	}
	if runtime.GOOS != "windows" && (err == nil || !strings.Contains(err.Error(), "only support windows")) {
		t.Fatalf("ValidateTranscriptionConfig() error = %v, want platform error", err)
	}
}
