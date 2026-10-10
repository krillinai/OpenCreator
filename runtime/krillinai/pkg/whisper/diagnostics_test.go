package whisper

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/internal/storage"
	"krillin-ai/log"
)

func TestTranscriptionResponseClassification(t *testing.T) {
	log.InitLogger()
	previousFFmpeg := storage.FfmpegPath
	storage.FfmpegPath = ""
	t.Cleanup(func() { storage.FfmpegPath = previousFFmpeg })
	for _, test := range []struct {
		name      string
		status    int
		payload   string
		code      string
		retryable bool
	}{
		{"empty", 200, `{"text":"","segments":[],"usage":{"seconds":270}}`, "audio_transcription_empty", false},
		{"blank_segment", 200, `{"text":" ","segments":[{"start":0,"end":16,"text":" "}]}`, "audio_transcription_empty", false},
		{"missing_timestamps", 200, `{"text":"Hello"}`, "audio_transcription_timestamps_missing", false},
		{"invalid_timestamps", 200, `{"text":"","segments":[{"start":2,"end":1,"text":"Hello"}]}`, "audio_transcription_timestamps_missing", false},
		{"error_envelope", 200, `{"text":"","error":{"message":"upstream unavailable"}}`, "audio_transcription_invalid_response", false},
		{"missing_text", 200, `{}`, "audio_transcription_invalid_response", false},
		{"null_text", 200, `{"text":null}`, "audio_transcription_invalid_response", false},
		{"wrong_text_type", 200, `{"text":12}`, "audio_transcription_invalid_response", false},
		{"wrong_segments_type", 200, `{"text":"Hello","segments":"bad"}`, "audio_transcription_invalid_response", false},
		{"malformed_json", 200, `<html>upstream error</html>`, "audio_transcription_invalid_response", false},
		{"http_error", 503, `{"error":{"message":"unavailable","type":"server_error"}}`, "audio_transcription_api_failed", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.payload))
			}))
			defer server.Close()
			dir := t.TempDir()
			audio := filepath.Join(dir, "audio.wav")
			if err := os.WriteFile(audio, []byte("audio"), 0600); err != nil {
				t.Fatal(err)
			}
			_, err := NewOfficialClient(server.URL, "test", "", "chosen-asr").Transcription(audio, "en", dir)
			var classified *TranscriptionError
			if !errors.As(err, &classified) || classified.Code != test.code || classified.Retryable() != test.retryable {
				t.Fatalf("error = %v, want %s (retryable %v)", err, test.code, test.retryable)
			}
		})
	}
}

func TestTranscriptionReconstructsEmptyTextFromTimedSegments(t *testing.T) {
	testTranscription(t, true, `{"text":"","language":"en","segments":[{"start":1.25,"end":3.5,"text":"Hello world"}]}`, false)
}

func TestEmptyTranscriptionAudioEvidence(t *testing.T) {
	for _, test := range []struct {
		name   string
		output string
		code   string
	}{
		{"silence", "mean_volume: -91.0 dB\nmax_volume: -91.0 dB", "audio_no_speech"},
		{"near_silence", "mean_volume: -70.0 dB\nmax_volume: -61.0 dB", "audio_no_speech"},
		{"infinite_silence", "mean_volume: -inf dB\nmax_volume: -inf dB", "audio_no_speech"},
		{"sound", "mean_volume: -18.0 dB\nmax_volume: 0.0 dB", "audio_transcription_empty"},
		{"quiet_with_peak", "mean_volume: -70.0 dB\nmax_volume: -20.0 dB", "audio_transcription_empty"},
		{"unavailable", "invalid audio", "audio_transcription_empty"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := emptyTranscriptionError(parseAudioSignal([]byte(test.output)))
			if err.Code != test.code || err.Retryable() {
				t.Fatalf("error = %+v", err)
			}
			if test.code == "audio_transcription_empty" && !strings.Contains(err.Message, "does not prove") {
				t.Fatal("empty response must preserve uncertainty about speech")
			}
		})
	}
}

func TestEmptyTranscriptionWithRealAudio(t *testing.T) {
	ffmpeg := os.Getenv("KRILLIN_TEST_FFMPEG")
	if ffmpeg == "" {
		t.Skip("set KRILLIN_TEST_FFMPEG to verify real silent and non-silent audio")
	}
	previousFFmpeg := storage.FfmpegPath
	storage.FfmpegPath = ffmpeg
	t.Cleanup(func() { storage.FfmpegPath = previousFFmpeg })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"","segments":[]}`))
	}))
	defer server.Close()
	for _, test := range []struct {
		name, source, code string
	}{
		{"silence", "anullsrc=r=16000:cl=mono", "audio_no_speech"},
		{"tone", "sine=frequency=440:sample_rate=16000", "audio_transcription_empty"},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			audio := filepath.Join(dir, "audio.wav")
			output, err := exec.Command(ffmpeg, "-hide_banner", "-nostdin", "-f", "lavfi", "-i", test.source, "-t", "0.5", audio).CombinedOutput()
			if err != nil {
				t.Fatalf("generate fixture: %v: %s", err, output)
			}
			_, err = NewOfficialClient(server.URL, "test", "", "chosen-asr").Transcription(audio, "en", dir)
			var classified *TranscriptionError
			if !errors.As(err, &classified) || classified.Code != test.code {
				t.Fatalf("error = %v, want %s", err, test.code)
			}
		})
	}
}
