package openai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/internal/types"
)

func TestSynthesizeSendsOpenAITTSControlsAndWritesAudio(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audio/speech" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer openai-key" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request["model"] != "gpt-4o-mini-tts" {
			t.Fatalf("model = %#v", request["model"])
		}
		if request["input"] != "say \"hello\"\nnext" {
			t.Fatalf("input = %#v", request["input"])
		}
		if request["voice"] != "marin" {
			t.Fatalf("voice = %#v", request["voice"])
		}
		if request["response_format"] != "mp3" {
			t.Fatalf("response_format = %#v", request["response_format"])
		}
		if request["speed"] != 1.15 {
			t.Fatalf("speed = %#v", request["speed"])
		}
		if request["instructions"] != "Speak warmly." {
			t.Fatalf("instructions = %#v", request["instructions"])
		}
		_, _ = w.Write([]byte("ID3-test-audio"))
	}))
	defer server.Close()

	output := filepath.Join(t.TempDir(), "speech.mp3")
	client := NewTtsClient(server.URL, "openai-key", "gpt-4o-mini-tts", "http://127.0.0.1:1")
	if err := client.Synthesize(context.Background(), types.TTSSpeechOptions{
		Text:         "say \"hello\"\nnext",
		OutputFile:   output,
		Format:       "mp3",
		Speed:        1.15,
		Instructions: " Speak warmly. ",
	}); err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "ID3-test-audio" {
		t.Fatalf("audio = %q", content)
	}
}

func TestDefaultVoiceMatchesOpenCreator(t *testing.T) {
	if DefaultTTSVoice != "marin" {
		t.Fatalf("DefaultTTSVoice = %q, want marin", DefaultTTSVoice)
	}
}

func TestSynthesizeHTTPDiagnostics(t *testing.T) {
	for _, status := range []int{401, 429, 503} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Request-ID", "ocreq_"+strings.Repeat("b", 48))
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"code":"credits_insufficient","message":"private detail"}}`))
		}))
		client := NewTtsClient(server.URL, "test", "model", "")
		err := client.Synthesize(context.Background(), types.TTSSpeechOptions{Text: "hello", OutputFile: filepath.Join(t.TempDir(), "audio.mp3")})
		server.Close()
		var classified *SpeechHTTPError
		if !errors.As(err, &classified) || classified.StatusCode != status || classified.UpstreamCode != "credits_insufficient" || classified.RequestID != "ocreq_"+strings.Repeat("b", 48) {
			t.Fatalf("status %d: diagnostics = %+v, error = %v", status, classified, err)
		}
	}
}
