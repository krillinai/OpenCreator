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

func TestYouTubeProxyPrefersDedicatedProxyAndFallsBackToAppProxy(t *testing.T) {
	previous := Conf
	t.Cleanup(func() { Conf = previous })

	Conf.App.Proxy = "http://fallback.example:7890"
	Conf.App.YouTubeProxy = ""
	if got := YouTubeProxy(); got != Conf.App.Proxy {
		t.Fatalf("YouTubeProxy() fallback = %q, want %q", got, Conf.App.Proxy)
	}

	Conf.App.YouTubeProxy = " http://media.example:7891 "
	if got := YouTubeProxy(); got != "http://media.example:7891" {
		t.Fatalf("YouTubeProxy() dedicated = %q, want trimmed dedicated proxy", got)
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
