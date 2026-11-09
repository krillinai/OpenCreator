package dubbing

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"krillin-ai/internal/storage"
)

func TestAssembleAudioPreservesSpeechAfterInternalPause(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is unavailable")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is unavailable")
	}
	previousFFmpeg, previousFFprobe := storage.FfmpegPath, storage.FfprobePath
	storage.FfmpegPath, storage.FfprobePath = ffmpeg, ffprobe
	t.Cleanup(func() {
		storage.FfmpegPath, storage.FfprobePath = previousFFmpeg, previousFFprobe
	})

	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	raw := filepath.Join(rawDir, "1.wav")
	input := []string{
		"-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100:d=0.1",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.6",
		"-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100:d=0.2",
		"-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=0.6",
		"-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100:d=0.15",
		"-filter_complex", "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1", "-c:a", "pcm_s16le", raw,
	}
	if output, err := exec.Command(ffmpeg, input...).CombinedOutput(); err != nil {
		t.Fatalf("create speech with internal pause: %v: %s", err, output)
	}

	outputAudio := filepath.Join(dir, "out.wav")
	plan := []PlanItem{{Index: 1, NewStart: 0, NewEnd: 1.4, ActualDuration: 1.4, SpeedFactor: 1, SpokenText: "speech resumes after a pause"}}
	if err := AssembleAudio(plan, dir, outputAudio, func(args []string) error {
		if output, err := exec.Command(ffmpeg, args...).CombinedOutput(); err != nil {
			return fmt.Errorf("ffmpeg: %w: %s", err, output)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	probe, err := exec.Command(ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputAudio).Output()
	if err != nil {
		t.Fatal(err)
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(probe)), 64)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(duration-1.4) > 0.05 {
		t.Fatalf("assembled audio duration = %.3fs, want 1.4s including speech after the pause", duration)
	}
}

func TestAssembleAudioSavedTTSFixture(t *testing.T) {
	fixture := os.Getenv("OPENCREATOR_DUBBING_FIXTURE")
	if fixture == "" {
		t.Skip("no saved TTS fixture")
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Fatal(err)
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Fatal(err)
	}
	previousFFmpeg, previousFFprobe := storage.FfmpegPath, storage.FfprobePath
	storage.FfmpegPath, storage.FfprobePath = ffmpeg, ffprobe
	t.Cleanup(func() {
		storage.FfmpegPath, storage.FfprobePath = previousFFmpeg, previousFFprobe
	})

	data, err := os.ReadFile(filepath.Join(fixture, DubbingPlanFileName))
	if err != nil {
		t.Fatal(err)
	}
	var plan []PlanItem
	if err := json.Unmarshal(data, &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan) == 0 {
		t.Fatal("fixture plan is empty")
	}
	dir := t.TempDir()
	if err := os.Symlink(filepath.Join(fixture, "segments", "raw"), filepath.Join(dir, "raw")); err != nil {
		t.Fatal(err)
	}
	outputAudio := filepath.Join(dir, "assembled.wav")
	if err := AssembleAudio(plan, dir, outputAudio, func(args []string) error {
		if output, err := exec.Command(ffmpeg, args...).CombinedOutput(); err != nil {
			return fmt.Errorf("ffmpeg: %w: %s", err, output)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	probe, err := exec.Command(ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputAudio).Output()
	if err != nil {
		t.Fatal(err)
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(probe)), 64)
	if err != nil {
		t.Fatal(err)
	}
	want := plan[len(plan)-1].NewEnd
	if duration > want+0.25 || duration < want-0.5 {
		t.Fatalf("assembled audio duration = %.3fs, want near %.3fs from plan", duration, want)
	}
}

func TestAssembleAudioWritesConcatListInFittedDir(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rawDir, "1.wav"), []byte("raw"), 0644); err != nil {
		t.Fatal(err)
	}
	plan := []PlanItem{{Index: 1, NewStart: 0.5, NewEnd: 1.3, SpeedFactor: 1.0}}
	err := AssembleAudio(plan, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		return os.WriteFile(args[len(args)-1], []byte("media"), 0644)
	})
	if err != nil {
		t.Fatalf("AssembleAudio() error = %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "fitted", "concat.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "silence_1.wav") || !strings.Contains(string(data), "1.wav") {
		t.Fatalf("concat list = %q", string(data))
	}
}

func TestAssembleAudioRejectsInvalidWindowBeforeRunner(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rawDir, "1.wav"), []byte("raw"), 0644); err != nil {
		t.Fatal(err)
	}
	calls := 0
	plan := []PlanItem{{Index: 1, NewStart: 1.0, NewEnd: 1.0, SpeedFactor: 1.0}}
	err := AssembleAudio(plan, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		calls++
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "new end must be greater than new start") {
		t.Fatalf("AssembleAudio() error = %v, want invalid window error", err)
	}
	if calls != 0 {
		t.Fatalf("runner calls = %d, want 0", calls)
	}
}

func TestAssembleAudioRejectsOverlappingPlanBeforeRunner(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"1.wav", "2.wav"} {
		if err := os.WriteFile(filepath.Join(rawDir, name), []byte("raw"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	calls := 0
	plan := []PlanItem{
		{Index: 1, NewStart: 1.0, NewEnd: 2.0, SpeedFactor: 1.0},
		{Index: 2, NewStart: 0.5, NewEnd: 1.5, SpeedFactor: 1.0},
	}
	err := AssembleAudio(plan, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		calls++
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "starts before previous end") {
		t.Fatalf("AssembleAudio() error = %v, want overlap error", err)
	}
	if calls != 0 {
		t.Fatalf("runner calls = %d, want 0", calls)
	}
}

func TestAssembleAudioRejectsInvalidSpeedFactorBeforeRunner(t *testing.T) {
	tests := []struct {
		name        string
		speedFactor float64
	}{
		{name: "zero", speedFactor: 0},
		{name: "infinity", speedFactor: math.Inf(1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			rawDir := filepath.Join(dir, "raw")
			if err := os.MkdirAll(rawDir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(rawDir, "1.wav"), []byte("raw"), 0644); err != nil {
				t.Fatal(err)
			}
			calls := 0
			plan := []PlanItem{{Index: 1, NewStart: 0, NewEnd: 1, SpeedFactor: tt.speedFactor}}
			err := AssembleAudio(plan, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
				calls++
				t.Fatalf("runner called with args = %v", args)
				return nil
			})
			if err == nil {
				t.Fatal("AssembleAudio() error = nil, want invalid speed factor error")
			}
			if calls != 0 {
				t.Fatalf("runner calls = %d, want 0", calls)
			}
		})
	}
}

func TestAssembleAudioRejectsMissingRawSegmentBeforeRunner(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	calls := 0
	plan := []PlanItem{{Index: 1, NewStart: 0, NewEnd: 1, SpeedFactor: 1}}
	err := AssembleAudio(plan, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		calls++
		t.Fatalf("runner called with args = %v", args)
		return nil
	})
	if err == nil {
		t.Fatal("AssembleAudio() error = nil, want missing raw segment error")
	}
	if calls != 0 {
		t.Fatalf("runner calls = %d, want 0", calls)
	}
}

func TestAssembleAudioRejectsEmptyPlan(t *testing.T) {
	dir := t.TempDir()
	calls := 0
	err := AssembleAudio(nil, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		calls++
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "plan is empty") {
		t.Fatalf("AssembleAudio() error = %v, want empty plan error", err)
	}
	if calls != 0 {
		t.Fatalf("runner calls = %d, want 0", calls)
	}
}

func TestAssembleChunkAudioUsesOneRawFilePerChunk(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rawDir, "chunk_1.wav"), []byte("raw"), 0644); err != nil {
		t.Fatal(err)
	}
	plan := []PlanItem{
		{Index: 1, NewStart: 1, NewEnd: 2, SpeedFactor: 1, ChunkID: 1},
		{Index: 2, NewStart: 2, NewEnd: 4, SpeedFactor: 1, ChunkID: 1},
	}
	chunks := []Chunk{{ID: 1, Items: []int{0, 1}, Start: 1, End: 4, ActualDuration: 3, SpeedFactor: 1}}
	var fittedInputs []string

	err := AssembleChunkAudio(plan, chunks, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		for i, arg := range args {
			if arg == "-i" && i+1 < len(args) {
				fittedInputs = append(fittedInputs, args[i+1])
			}
		}
		return os.WriteFile(args[len(args)-1], []byte("media"), 0644)
	})
	if err != nil {
		t.Fatalf("AssembleChunkAudio() error = %v", err)
	}
	if len(fittedInputs) < 2 || !strings.Contains(fittedInputs[0], "chunk_1.wav") {
		t.Fatalf("fitted inputs = %+v, want first input raw chunk file", fittedInputs)
	}
	if strings.Contains(strings.Join(fittedInputs, " "), "raw/1.wav") || strings.Contains(strings.Join(fittedInputs, " "), "raw/2.wav") {
		t.Fatalf("fitted inputs = %+v, should not use item raw files for chunk mode", fittedInputs)
	}
	data, err := os.ReadFile(filepath.Join(dir, "fitted", "concat.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "silence_chunk_1.wav") || !strings.Contains(string(data), "chunk_1.wav") {
		t.Fatalf("concat list = %q", string(data))
	}
}

func TestAssembleChunkAudioPreservesGapAfterShortChunkAudio(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"chunk_1.wav", "chunk_2.wav"} {
		if err := os.WriteFile(filepath.Join(rawDir, name), []byte("raw"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	plan := []PlanItem{
		{Index: 1, NewStart: 0, NewEnd: 3, SpeedFactor: 1, ChunkID: 1},
		{Index: 2, NewStart: 7, NewEnd: 8, SpeedFactor: 1, ChunkID: 2},
	}
	chunks := []Chunk{
		{ID: 1, Items: []int{0}, Start: 0, End: 5, ActualDuration: 3, SpeedFactor: 1},
		{ID: 2, Items: []int{1}, Start: 7, End: 8, ActualDuration: 1, SpeedFactor: 1},
	}
	silenceDuration := ""

	err := AssembleChunkAudio(plan, chunks, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		out := args[len(args)-1]
		if strings.Contains(out, "silence_chunk_2.wav") {
			for i, arg := range args {
				if arg == "-t" && i+1 < len(args) {
					silenceDuration = args[i+1]
				}
			}
		}
		return os.WriteFile(out, []byte("media"), 0644)
	})
	if err != nil {
		t.Fatalf("AssembleChunkAudio() error = %v", err)
	}
	if silenceDuration != "4.000" {
		t.Fatalf("silence before second chunk = %q, want 4.000", silenceDuration)
	}
}

func TestAssembleChunkAudioAllowsFloatingPointBoundaryNoise(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"chunk_16.wav", "chunk_17.wav"} {
		if err := os.WriteFile(filepath.Join(rawDir, name), []byte("raw"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	plan := []PlanItem{
		{Index: 42, NewStart: 96.84, NewEnd: 111.00000000000001, SpeedFactor: 1.028, ChunkID: 16},
		{Index: 43, NewStart: 111, NewEnd: 114.08, SpeedFactor: 1, ChunkID: 17},
	}
	chunks := []Chunk{
		{ID: 16, Items: []int{0}, Start: 96.84, End: 111, ActualDuration: 14.56, SpeedFactor: 1.028},
		{ID: 17, Items: []int{1}, Start: 111, End: 114.08, ActualDuration: 3.08, SpeedFactor: 1},
	}

	err := AssembleChunkAudio(plan, chunks, dir, filepath.Join(dir, "out.wav"), func(args []string) error {
		return os.WriteFile(args[len(args)-1], []byte("media"), 0644)
	})
	if err != nil {
		t.Fatalf("AssembleChunkAudio() error = %v, want floating-point boundary accepted", err)
	}
}
