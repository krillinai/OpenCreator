package localtts

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"krillin-ai/internal/types"
)

func TestOmniVoiceSegment(t *testing.T) {
	reference := filepath.Join(t.TempDir(), "voice.wav")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test" || r.URL.Path != "/speech" {
			t.Error("incorrect worker request")
		}
		var body struct {
			Text, Language, Reference, Format string
			Speed                             float64
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Language != "ms" || body.Text != "Selamat pagi" || body.Reference != reference || body.Speed != 1 || body.Format != "wav" {
			t.Errorf("unexpected segment parameters: %+v", body)
		}
		io.WriteString(w, "RIFF-audio")
	}))
	defer server.Close()
	endpoint, _ := url.Parse(server.URL)
	t.Setenv("OPENCREATOR_OMNIVOICE_PORT", endpoint.Port())
	t.Setenv("OPENCREATOR_OMNIVOICE_TOKEN", "test")
	client := OmniVoice{Reference: reference}
	output := filepath.Join(t.TempDir(), "segment.wav")
	opts := types.TTSSpeechOptions{Text: "Selamat pagi", Voice: "omnivoice-ms", OutputFile: output}
	if err := client.Synthesize(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(output); err != nil || string(data) != "RIFF-audio" {
		t.Fatal("missing output", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.Synthesize(ctx, opts); err == nil {
		t.Fatal("canceled request succeeded")
	}
}
