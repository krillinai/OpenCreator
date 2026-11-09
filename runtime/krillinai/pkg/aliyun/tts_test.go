package aliyun

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"krillin-ai/internal/resourcepath"
	"krillin-ai/internal/types"
)

func TestSynthesizeUsesQwenTTSRequestAndDownloadsAudio(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/services/aigc/multimodal-generation/generation":
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if r.Header.Get("Authorization") != "Bearer dashscope-key" {
				t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
			}
			if r.Header.Get("api-key") != "dashscope-key" {
				t.Fatalf("api-key = %q", r.Header.Get("api-key"))
			}
			var request map[string]any
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if request["model"] != "qwen3-tts-flash" {
				t.Fatalf("model = %#v", request["model"])
			}
			input, ok := request["input"].(map[string]any)
			if !ok {
				t.Fatalf("input = %#v", request["input"])
			}
			if input["text"] != "你好，\"百炼\"\n下一行" {
				t.Fatalf("text = %#v", input["text"])
			}
			if input["voice"] != "Cherry" {
				t.Fatalf("voice = %#v", input["voice"])
			}
			if input["language_type"] != "Auto" {
				t.Fatalf("language_type = %#v", input["language_type"])
			}
			if _, exists := request["parameters"]; exists {
				t.Fatalf("parameters = %#v, Qwen-TTS does not accept CosyVoice parameters", request["parameters"])
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"audio": map[string]string{"url": server.URL + "/audio.wav"},
				},
				"request_id": "request-1",
			})
		case "/audio.wav":
			_, _ = w.Write([]byte("RIFF-test-audio"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output := filepath.Join(t.TempDir(), "speech.wav")
	client := NewTtsClient(server.URL, "dashscope-key", "qwen3-tts-flash", "")
	if err := client.Synthesize(context.Background(), types.TTSSpeechOptions{
		Text:       "你好，\"百炼\"\n下一行",
		Voice:      "Cherry",
		OutputFile: output,
		Format:     "wav",
		Speed:      1,
	}); err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "RIFF-test-audio" {
		t.Fatalf("audio = %q", content)
	}
}

func TestListVoicesUsesBuiltinQwenCatalogWithoutCredentials(t *testing.T) {
	client := NewTtsClient("http://127.0.0.1:1", "unused-key", "", "")
	voices, err := client.ListVoices(context.Background())
	if err != nil {
		t.Fatalf("ListVoices() error = %v", err)
	}
	for _, code := range []string{"Cherry", "Nofish", "Jennifer", "Jada", "Kiki"} {
		if !containsVoice(voices, code) {
			t.Fatalf("ListVoices() missing %q", code)
		}
	}
}

func TestTranscodeAudioUsesPackagedFFmpegForFormatAndSpeed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is POSIX-only")
	}
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatal(err)
	}
	argsPath := filepath.Join(root, "ffmpeg-args.txt")
	ffmpeg := filepath.Join(binDir, "ffmpeg")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' \"$@\" > \"" + argsPath + "\"\n" +
		"input=''\noutput=''\nprevious=''\n" +
		"for value in \"$@\"; do\n" +
		"  if [ \"$previous\" = '-i' ]; then input=\"$value\"; fi\n" +
		"  previous=\"$value\"\n" +
		"  output=\"$value\"\n" +
		"done\n" +
		"cp \"$input\" \"$output\"\n"
	if err := os.WriteFile(ffmpeg, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv(resourcepath.RootEnv, root)

	input := filepath.Join(root, "input.wav")
	output := filepath.Join(root, "output.mp3")
	if err := os.WriteFile(input, []byte("audio"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := transcodeAudio(context.Background(), input, output, "mp3", 1.25); err != nil {
		t.Fatalf("transcodeAudio() error = %v", err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	joined := string(args)
	for _, expected := range []string{"atempo=1.250", "libmp3lame", "192k", output} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("ffmpeg args = %q, want %q", joined, expected)
		}
	}
}

func containsVoice(voices []types.TTSVoice, code string) bool {
	for _, voice := range voices {
		if voice.Code == code {
			return true
		}
	}
	return false
}
