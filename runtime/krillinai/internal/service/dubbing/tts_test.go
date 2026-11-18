package dubbing

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeTTS struct {
	failures      int
	failText      string
	calls         int
	texts         []string
	writeOnReturn bool
}

func (f *fakeTTS) Text2Speech(text, voice, outputFile string) error {
	f.calls++
	f.texts = append(f.texts, text)
	if f.calls <= f.failures || (f.failText != "" && text == f.failText) {
		return errors.New("tts failed")
	}
	if !f.writeOnReturn {
		return nil
	}
	return os.WriteFile(outputFile, []byte("wav"), 0644)
}

func TestGenerateRawSegmentsRetriesAndWritesFiles(t *testing.T) {
	dir := t.TempDir()
	tts := &fakeTTS{failures: 1, writeOnReturn: true}
	plan := []PlanItem{{Index: 1, SpokenText: "你好"}}
	got, err := GenerateRawSegments(context.Background(), tts, plan, "voice", dir, nil, func(string) (float64, error) {
		return 1.2, nil
	})
	if err != nil {
		t.Fatalf("GenerateRawSegments() error = %v", err)
	}
	if tts.calls != 2 {
		t.Fatalf("calls = %d, want 2", tts.calls)
	}
	if got[0].ActualDuration != 1.2 {
		t.Fatalf("ActualDuration = %v", got[0].ActualDuration)
	}
	if _, err := os.Stat(filepath.Join(dir, "raw", "1.wav")); err != nil {
		t.Fatalf("raw file missing: %v", err)
	}
}

func TestRetryTTSRejectsNonPositiveAttempts(t *testing.T) {
	err := retryTTS(&fakeTTS{}, "hello", "voice", filepath.Join(t.TempDir(), "out.wav"), 0)
	if err == nil || !strings.Contains(err.Error(), "attempts must be > 0") {
		t.Fatalf("retryTTS() error = %v, want attempts validation", err)
	}
}

func TestRetryTTSDoesNotTreatStaleOutputAsSuccess(t *testing.T) {
	output := filepath.Join(t.TempDir(), "out.wav")
	if err := os.WriteFile(output, []byte("stale"), 0644); err != nil {
		t.Fatalf("write stale output: %v", err)
	}

	tts := &fakeTTS{writeOnReturn: false}
	err := retryTTS(tts, "hello", "voice", output, 1)
	if err == nil {
		t.Fatal("retryTTS() error = nil, want missing output error")
	}
	if _, statErr := os.Stat(output); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("stale output stat error = %v, want removed output", statErr)
	}
}

func TestGenerateRawSegmentsWrapsDurationProbeError(t *testing.T) {
	dir := t.TempDir()
	tts := &fakeTTS{writeOnReturn: true}
	plan := []PlanItem{{Index: 1, SpokenText: "你好"}}

	_, err := GenerateRawSegments(context.Background(), tts, plan, "voice", dir, nil, func(string) (float64, error) {
		return 0, errors.New("probe failed")
	})
	if err == nil {
		t.Fatal("GenerateRawSegments() error = nil, want duration error")
	}
	output := filepath.Join(dir, "raw", "1.wav")
	if !strings.Contains(err.Error(), "measure segment 1 duration failed") || !strings.Contains(err.Error(), output) {
		t.Fatalf("GenerateRawSegments() error = %q, want segment index and output path", err)
	}
}

func TestGenerateRawChunkSegmentsCallsTTSOncePerChunk(t *testing.T) {
	dir := t.TempDir()
	tts := &fakeTTS{writeOnReturn: true}
	plan := []PlanItem{
		{Index: 1, SpokenText: "我认为学习速记是一项技能"},
		{Index: 2, SpokenText: "它能够改变你的人生。"},
		{Index: 3, SpokenText: "学习是免费的。"},
	}
	chunks := []Chunk{
		{ID: 1, Items: []int{0, 1}, Start: 0, End: 5},
		{ID: 2, Items: []int{2}, Start: 6, End: 8},
	}

	var progress [][2]int
	gotPlan, gotChunks, err := GenerateRawChunkSegments(
		context.Background(),
		tts,
		plan,
		chunks,
		"voice",
		dir,
		nil,
		func(path string) (float64, error) {
			if strings.Contains(path, "chunk_1.wav") {
				return 3.2, nil
			}
			return 1.1, nil
		},
		func(completed, total int) {
			progress = append(progress, [2]int{completed, total})
		},
	)
	if err != nil {
		t.Fatalf("GenerateRawChunkSegments() error = %v", err)
	}
	if tts.calls != 2 {
		t.Fatalf("TTS calls = %d, want one call per chunk", tts.calls)
	}
	if got := tts.texts[0]; got != "我认为学习速记是一项技能 它能够改变你的人生。" {
		t.Fatalf("first TTS text = %q", got)
	}
	if gotChunks[0].ActualDuration != 3.2 || gotChunks[1].ActualDuration != 1.1 {
		t.Fatalf("chunk durations = %+v", gotChunks)
	}
	if gotPlan[0].ActualDuration != 0 || gotPlan[1].ActualDuration != 0 {
		t.Fatalf("item actual durations should remain chunk-derived later: %+v", gotPlan)
	}
	if len(progress) != 3 || progress[0] != [2]int{0, 2} || progress[1] != [2]int{1, 2} || progress[2] != [2]int{2, 2} {
		t.Fatalf("progress = %+v, want [[0 2] [1 2] [2 2]]", progress)
	}
	if _, err := os.Stat(filepath.Join(dir, "raw", "chunk_1.wav")); err != nil {
		t.Fatalf("chunk raw file missing: %v", err)
	}
}
