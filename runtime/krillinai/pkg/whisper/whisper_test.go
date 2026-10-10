package whisper

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestOfficialSelectedModelUsesReturnedSegmentTimestamps(t *testing.T) {
	testTranscription(t, true, `{"text":"Hello world","language":"en","segments":[{"start":1.25,"end":3.5,"text":"Hello world"}]}`, false)
}

func TestCustomWhisperKeepsWordTimestampsAndLegacyModel(t *testing.T) {
	testTranscription(t, false, `{"text":"Hello world","language":"en","words":[{"start":1.25,"end":3.5,"word":"Hello world"}]}`, false)
}

func TestOfficialTranscriptionRejectsMissingTimestamps(t *testing.T) {
	testTranscription(t, true, `{"text":"Hello world","language":"en"}`, true)
}

func testTranscription(t *testing.T, official bool, payload string, wantError bool) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
		}
		model, granularity := "whisper-1", "word"
		if official {
			model, granularity = "vendor/chosen-asr", "segment"
		}
		if r.FormValue("model") != model || r.FormValue("timestamp_granularities[]") != granularity || r.FormValue("response_format") != "verbose_json" {
			t.Errorf("unexpected transcription parameters: %v", r.MultipartForm.Value)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(payload))
	}))
	defer server.Close()
	dir := t.TempDir()
	audio := filepath.Join(dir, "audio.wav")
	if err := os.WriteFile(audio, []byte("audio"), 0600); err != nil {
		t.Fatal(err)
	}
	client := NewClient(server.URL, "test", "")
	if official {
		client = NewOfficialClient(server.URL, "test", "", "vendor/chosen-asr")
	}
	result, err := client.Transcription(audio, "en", dir)
	if wantError {
		if err == nil {
			t.Fatal("missing timestamps were accepted")
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Words) != 1 || result.Words[0].Start != 1.25 || result.Words[0].End != 3.5 || result.Words[0].Text != "Hello world" {
		t.Fatal(result)
	}
}
