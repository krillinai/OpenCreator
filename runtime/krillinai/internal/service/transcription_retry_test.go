package service

import (
	"context"
	"errors"
	"testing"

	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/whisper"

	"golang.org/x/sync/errgroup"
)

type failingTranscriber struct {
	calls int
	err   error
}

func (f *failingTranscriber) Transcription(_, _, _ string) (*types.TranscriptionData, error) {
	f.calls++
	return nil, f.err
}

func TestTranscriptionRetriesOnlyRetryableFailures(t *testing.T) {
	log.InitLogger()
	previous := config.Conf.App
	t.Cleanup(func() { config.Conf.App = previous })
	config.Conf.App.TranscribeParallelNum = 1
	for _, test := range []struct {
		code     string
		attempts int
		calls    int
	}{
		{"audio_transcription_empty", 3, 1},
		{"audio_no_speech", 3, 1},
		{"audio_transcription_invalid_response", 3, 1},
		{"audio_transcription_timestamps_missing", 3, 1},
		{"audio_transcription_pending", 3, 1},
		{"audio_transcription_rate_limited", 3, 1},
		{"credits_insufficient", 3, 1},
		{"audio_transcription_api_failed", 3, 3},
		{"audio_transcription_api_failed", 0, 1},
	} {
		t.Run(test.code, func(t *testing.T) {
			config.Conf.App.TranscribeMaxAttempts = test.attempts
			transcriber := &failingTranscriber{err: &whisper.TranscriptionError{Code: test.code, Message: "fixture failure"}}
			pending := make(chan DataWithId[string], 1)
			pending <- DataWithId[string]{Id: 1, Data: "fixture.wav"}
			close(pending)
			group, ctx := errgroup.WithContext(context.Background())
			(Service{Transcriber: transcriber}).startTranscribeWorkers(ctx, group, &types.SubtitleTaskStepParam{TaskBasePath: t.TempDir()},
				pending, make(chan DataWithId[float64], 1), make(chan DataWithId[*types.TranscriptionData], 1))
			err := group.Wait()
			var classified *whisper.TranscriptionError
			if !errors.As(err, &classified) || classified.Code != test.code || transcriber.calls != test.calls {
				t.Fatalf("calls = %d, error = %v", transcriber.calls, err)
			}
			var positioned interface{ TranscriptionPosition() (int, int) }
			if !errors.As(err, &positioned) {
				t.Fatal("failed transcription did not identify the segment and attempt")
			}
			if segment, attempt := positioned.TranscriptionPosition(); segment != 2 || attempt != test.calls {
				t.Fatalf("transcription position = %d, %d; want 2, %d", segment, attempt, test.calls)
			}
		})
	}
}
