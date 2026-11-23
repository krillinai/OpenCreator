package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
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

type recordingTranscriber struct {
	mu    sync.Mutex
	calls []string
}

func (r *recordingTranscriber) Transcription(audioFile, _, _ string) (*types.TranscriptionData, error) {
	r.mu.Lock()
	r.calls = append(r.calls, audioFile)
	r.mu.Unlock()
	return &types.TranscriptionData{Text: "fresh transcript"}, nil
}

func TestTranscribeWorkersReuseSegmentCheckpoint(t *testing.T) {
	log.InitLogger()
	previous := config.Conf.App
	t.Cleanup(func() { config.Conf.App = previous })
	config.Conf.App.TranscribeParallelNum = 1
	config.Conf.App.TranscribeMaxAttempts = 1

	workDir := t.TempDir()
	cached := &types.TranscriptionData{Language: "en", Text: "cached transcript"}
	checkpoint := filepath.Join(workDir, fmt.Sprintf(types.SubtitleTaskAudioTranscriptionDataPersistenceFileNamePattern, 0))
	if err := util.SaveToDisk(cached, checkpoint); err != nil {
		t.Fatalf("save transcription checkpoint: %v", err)
	}
	if _, err := os.Stat(checkpoint); err != nil {
		t.Fatalf("transcription checkpoint was not created: %v", err)
	}
	corruptCheckpoint := filepath.Join(workDir, fmt.Sprintf(types.SubtitleTaskAudioTranscriptionDataPersistenceFileNamePattern, 2))
	if err := os.WriteFile(corruptCheckpoint, []byte("not-json"), 0o600); err != nil {
		t.Fatalf("save corrupt transcription checkpoint: %v", err)
	}

	transcriber := &recordingTranscriber{}
	pending := make(chan DataWithId[string], 3)
	pending <- DataWithId[string]{Id: 0, Data: "cached.wav"}
	pending <- DataWithId[string]{Id: 1, Data: "missing.wav"}
	pending <- DataWithId[string]{Id: 2, Data: "corrupt.wav"}
	close(pending)
	transcribed := make(chan DataWithId[*types.TranscriptionData], 3)
	group, ctx := errgroup.WithContext(context.Background())
	(Service{Transcriber: transcriber}).startTranscribeWorkers(
		ctx,
		group,
		&types.SubtitleTaskStepParam{TaskBasePath: workDir},
		pending,
		make(chan DataWithId[float64], 2),
		transcribed,
	)
	if err := group.Wait(); err != nil {
		t.Fatalf("transcription workers failed: %v", err)
	}

	results := make(map[int]*types.TranscriptionData, 3)
	for range 3 {
		item := <-transcribed
		results[item.Id] = item.Data
	}
	if got := len(transcriber.calls); got != 2 {
		t.Fatalf("transcriber calls = %d, want 2 for missing and corrupt segments", got)
	}
	if got := fmt.Sprint(transcriber.calls); got != "[missing.wav corrupt.wav]" {
		t.Fatalf("transcriber calls = %s, want missing.wav and corrupt.wav", got)
	}
	if got := results[0]; got == nil || got.Text != cached.Text {
		t.Fatalf("cached segment = %#v, want checkpoint data %#v", got, cached)
	}
	if got := results[1]; got == nil || got.Text != "fresh transcript" {
		t.Fatalf("missing segment = %#v, want fresh transcript", got)
	}
	if got := results[2]; got == nil || got.Text != "fresh transcript" {
		t.Fatalf("corrupt segment = %#v, want fresh transcript", got)
	}
}
