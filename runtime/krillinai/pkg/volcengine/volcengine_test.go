package volcengine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/internal/types"
	"krillin-ai/log"
)

func TestAsrTranscriptionSubmitsBase64AudioAndMapsUtterances(t *testing.T) {
	log.InitLogger()
	originalProcess := processAudioFile
	processAudioFile = func(filePath string) (string, error) {
		return filePath, nil
	}
	t.Cleanup(func() { processAudioFile = originalProcess })

	source := filepath.Join(t.TempDir(), "clip.mp3")
	if err := os.WriteFile(source, []byte("fake-mp3"), 0644); err != nil {
		t.Fatal(err)
	}
	var requestIDs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-App-Key") != "app-1" {
			t.Fatalf("app key = %q", r.Header.Get("X-Api-App-Key"))
		}
		if r.Header.Get("X-Api-Access-Key") != "token-1" {
			t.Fatalf("access key = %q", r.Header.Get("X-Api-Access-Key"))
		}
		if r.Header.Get("X-Api-Resource-Id") != DefaultAsrResourceID {
			t.Fatalf("resource = %q", r.Header.Get("X-Api-Resource-Id"))
		}
		requestIDs = append(requestIDs, r.Header.Get("X-Api-Request-Id"))
		switch r.URL.Path {
		case submitPath:
			var body asrSubmitRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode submit: %v", err)
			}
			decoded, err := base64.StdEncoding.DecodeString(body.Audio.Data)
			if err != nil || string(decoded) != "fake-mp3" {
				t.Fatalf("audio data = %q", decoded)
			}
			if body.Audio.Format != "mp3" {
				t.Fatalf("format = %q", body.Audio.Format)
			}
			w.Header().Set("X-Api-Status-Code", statusSuccess)
			_, _ = w.Write([]byte("{}"))
		case queryPath:
			w.Header().Set("X-Api-Status-Code", statusSuccess)
			_ = json.NewEncoder(w).Encode(asrQueryResponse{
				Result: &asrResult{
					Text: "Hello world",
					Utterances: []asrUtterance{{
						Text:      "Hello world",
						StartTime: 120,
						EndTime:   1800,
						Words: []asrWord{
							{Text: "Hello", StartTime: 120, EndTime: 700},
							{Text: "world", StartTime: 720, EndTime: 1800},
						},
					}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewAsrClient(server.URL, "app-1", "token-1", "", "")
	client.pollInterval = 0
	result, err := client.Transcription(source, "en", t.TempDir())
	if err != nil {
		t.Fatalf("Transcription() error = %v", err)
	}
	if result.Text != "Hello world" {
		t.Fatalf("text = %q", result.Text)
	}
	if len(result.Words) != 2 || result.Words[0].Text != "Hello" || result.Words[0].Start != 0.12 {
		t.Fatalf("words = %#v", result.Words)
	}
	if len(requestIDs) < 2 || requestIDs[0] == "" || requestIDs[0] != requestIDs[1] {
		t.Fatalf("request ids = %#v", requestIDs)
	}
}

func TestTtsSynthesizeUsesV1HTTPQueryAndWritesAudio(t *testing.T) {
	output := filepath.Join(t.TempDir(), "speech.mp3")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ttsPath {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer;token-1" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var request ttsRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode tts: %v", err)
		}
		if request.App.AppID != "app-1" || request.App.Cluster != DefaultTTSCluster {
			t.Fatalf("app = %#v", request.App)
		}
		if request.Audio.VoiceType != "BV001_streaming" || request.Request.Operation != "query" {
			t.Fatalf("audio/request = %#v %#v", request.Audio, request.Request)
		}
		_ = json.NewEncoder(w).Encode(ttsResponse{
			Code:    ttsSuccessCode,
			Message: "Success",
			Data:    base64.StdEncoding.EncodeToString([]byte("mp3-bytes")),
		})
	}))
	defer server.Close()

	client := NewTtsClient(server.URL, "app-1", "token-1", "", "")
	if err := client.Synthesize(context.Background(), types.TTSSpeechOptions{
		Text:       "你好，火山。",
		Voice:      "BV001_streaming",
		OutputFile: output,
		Format:     "mp3",
	}); err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "mp3-bytes" {
		t.Fatalf("audio = %q", content)
	}
}

func TestListVoicesIncludesDefaultChineseCatalog(t *testing.T) {
	client := NewTtsClient("http://127.0.0.1:1", "unused", "unused", "", "")
	voices, err := client.ListVoices(context.Background())
	if err != nil {
		t.Fatalf("ListVoices() error = %v", err)
	}
	foundDefault := false
	foundChongqing := false
	foundYujie := false
	for _, voice := range voices {
		if voice.Code == DefaultTTSVoice && voice.Recommended {
			foundDefault = true
		}
		if voice.Code == "BV019_streaming" {
			if voice.Name != "重庆小伙" || voice.Gender != "male" {
				t.Fatalf("BV019 = %#v", voice)
			}
			foundChongqing = true
		}
		if voice.Code == "zh_female_gaolengyujie_uranus_bigtts" {
			if voice.Name != "高冷御姐 2.0" || voice.Gender != "female" {
				t.Fatalf("yujie = %#v", voice)
			}
			foundYujie = true
		}
	}
	if !foundDefault || !foundChongqing || !foundYujie {
		t.Fatalf("missing catalog voices default=%v chongqing=%v yujie=%v in %#v", foundDefault, foundChongqing, foundYujie, voices)
	}
}

func TestResolveTTSRouteSelectsV1AndV3Families(t *testing.T) {
	cases := []struct {
		cluster, voice, api, resource string
	}{
		{"volcano_tts", "BV001_streaming", "v1", "volcano_tts"},
		{"volcano_tts", "zh_female_gaolengyujie_uranus_bigtts", "v3", "seed-tts-2.0"},
		{"volcano_tts", "S_cloned_speaker", "v3", "seed-icl-2.0"},
		{"volcano_icl", "S_cloned_speaker", "v1", "volcano_icl"},
		{"seed-icl-2.0", "S_cloned_speaker", "v3", "seed-icl-2.0"},
		{"seed-tts-1.0", "zh_female_cancan_mars_bigtts", "v3", "seed-tts-1.0"},
	}
	for _, tc := range cases {
		api, resource := resolveTTSRoute(tc.cluster, tc.voice)
		if api != tc.api || resource != tc.resource {
			t.Fatalf("route(%q, %q) = %s %s, want %s %s", tc.cluster, tc.voice, api, resource, tc.api, tc.resource)
		}
	}
}

func TestTtsSynthesizeUsesV3ForDoubaoTwoOhVoices(t *testing.T) {
	output := filepath.Join(t.TempDir(), "speech.mp3")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != ttsV3Path {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Api-App-Id") != "app-1" {
			t.Fatalf("app id = %q", r.Header.Get("X-Api-App-Id"))
		}
		if r.Header.Get("X-Api-Access-Key") != "token-1" {
			t.Fatalf("access key = %q", r.Header.Get("X-Api-Access-Key"))
		}
		if r.Header.Get("X-Api-Resource-Id") != "seed-tts-2.0" {
			t.Fatalf("resource = %q", r.Header.Get("X-Api-Resource-Id"))
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode tts 2.0: %v", err)
		}
		params, _ := body["req_params"].(map[string]any)
		if params["speaker"] != "zh_female_gaolengyujie_uranus_bigtts" {
			t.Fatalf("speaker = %#v", params["speaker"])
		}
		_, _ = w.Write([]byte(strings.Join([]string{
			`{"code":0,"data":"` + base64.StdEncoding.EncodeToString([]byte("v3-bytes")) + `"}`,
			`{"code":20000000,"message":"OK"}`,
		}, "\n")))
	}))
	defer server.Close()

	client := NewTtsClient(server.URL, "app-1", "token-1", "volcano_tts", "")
	if err := client.Synthesize(context.Background(), types.TTSSpeechOptions{
		Text:       "高冷御姐",
		Voice:      "zh_female_gaolengyujie_uranus_bigtts",
		OutputFile: output,
		Format:     "mp3",
	}); err != nil {
		t.Fatalf("Synthesize() error = %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "v3-bytes" {
		t.Fatalf("audio = %q", content)
	}
}

func TestSpeechFormatUsesOutputExtension(t *testing.T) {
	if got := speechFormat("", "speech.wav"); got != "wav" {
		t.Fatalf("wav format = %q", got)
	}
	if got := speechFormat("", "speech.mp3"); got != "mp3" {
		t.Fatalf("mp3 format = %q", got)
	}
}

func TestAudioFormatUsesExtension(t *testing.T) {
	if got := audioFormat("a.MP3"); got != "mp3" {
		t.Fatalf("format = %q", got)
	}
	if !strings.HasPrefix(DefaultAsrBaseURL, "https://") {
		t.Fatal(DefaultAsrBaseURL)
	}
}
