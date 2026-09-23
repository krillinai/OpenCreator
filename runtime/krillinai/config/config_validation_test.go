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
