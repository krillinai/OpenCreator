package pipeline

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateTTSExtractsBilingualTargetBeforeSpeech(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "bilingual.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\nhello\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeStageService{}
	req := TTSRequest{
		Workdir:  dir,
		TaskID:   "demo",
		InputSRT: input,
		LineMode: LineModeBilingualTargetBottom,
	}
	resp, err := GenerateTTS(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateTTS() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	extracted := filepath.Join(dir, "tts_input.srt")
	data, err := os.ReadFile(extracted)
	if err != nil {
		t.Fatalf("tts input not written: %v", err)
	}
	if string(data) != "1\n00:00:00,000 --> 00:00:01,000\n你好\n\n" {
		t.Fatalf("tts input = %q", string(data))
	}
	if fake.lastSpeech == nil {
		t.Fatalf("GenerateSpeechFromSRT was not called")
	}
	if fake.lastSpeech.TtsSourceFilePath != extracted {
		t.Fatalf("TtsSourceFilePath = %q, want %q", fake.lastSpeech.TtsSourceFilePath, extracted)
	}
}

func TestGenerateTTSUsesManifestTargetSRTWhenInputEmpty(t *testing.T) {
	dir := t.TempDir()
	customTarget := filepath.Join(dir, "custom_target.srt")
	if err := os.WriteFile(customTarget, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	manifest := NewManifest("demo", dir)
	manifest.Outputs.TargetSRT = customTarget
	manifest.FailedIndexes = []int{2}
	manifest.TargetLanguage = "zh_cn"
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ManifestPath(dir), data, 0644); err != nil {
		t.Fatal(err)
	}

	fake := &fakeStageService{}
	req := TTSRequest{
		Workdir:          dir,
		TaskID:           "demo",
		Video:            "custom_video.mp4",
		Voice:            "voice-a",
		VoiceCloneSource: "clone.wav",
	}
	resp, err := GenerateTTS(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateTTS() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if fake.lastSpeech == nil {
		t.Fatalf("GenerateSpeechFromSRT was not called")
	}
	if fake.lastSpeech.TtsSourceFilePath != customTarget {
		t.Fatalf("TtsSourceFilePath = %q, want %q", fake.lastSpeech.TtsSourceFilePath, customTarget)
	}
	if fake.lastSpeech.TtsResultSrtFilePath != customTarget {
		t.Fatalf("TtsResultSrtFilePath = %q, want %q", fake.lastSpeech.TtsResultSrtFilePath, customTarget)
	}
	if fake.lastSpeech.TtsOriginSrtFilePath != filepath.Join(dir, "origin_language_srt.srt") {
		t.Fatalf("TtsOriginSrtFilePath = %q, want default origin path", fake.lastSpeech.TtsOriginSrtFilePath)
	}
	if fake.lastSpeech.TtsBilingualSrtFilePath != filepath.Join(dir, "bilingual_srt.srt") {
		t.Fatalf("TtsBilingualSrtFilePath = %q, want default bilingual path", fake.lastSpeech.TtsBilingualSrtFilePath)
	}
	if !fake.lastSpeech.EnableTts {
		t.Fatalf("EnableTts = false, want true")
	}
	if fake.lastSpeech.InputVideoPath != "custom_video.mp4" {
		t.Fatalf("InputVideoPath = %q", fake.lastSpeech.InputVideoPath)
	}
	if fake.lastSpeech.TtsVoiceCode != "voice-a" {
		t.Fatalf("TtsVoiceCode = %q", fake.lastSpeech.TtsVoiceCode)
	}
	if fake.lastSpeech.VoiceCloneAudioUrl != "clone.wav" {
		t.Fatalf("VoiceCloneAudioUrl = %q", fake.lastSpeech.VoiceCloneAudioUrl)
	}
	if fake.lastSpeech.TargetLanguage != "zh_cn" {
		t.Fatalf("TargetLanguage = %q, want zh_cn", fake.lastSpeech.TargetLanguage)
	}
	if len(resp.FailedIndexes) != 1 || resp.FailedIndexes[0] != 2 {
		t.Fatalf("FailedIndexes = %v, want [2]", resp.FailedIndexes)
	}
}

func TestGenerateTTSReportsVoiceGenerationProgress(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "target.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeStageService{}
	type update struct {
		phase   string
		percent int
	}
	var updates []update
	req := TTSRequest{
		Workdir:  dir,
		TaskID:   "demo",
		InputSRT: input,
		ReportProgress: func(phase string, percent int, _ string, _ ...ProgressCounts) {
			updates = append(updates, update{phase: phase, percent: percent})
		},
	}

	if _, err := GenerateTTS(context.Background(), fake, req); err != nil {
		t.Fatalf("GenerateTTS() error = %v", err)
	}
	if len(updates) < 3 {
		t.Fatalf("progress updates = %+v, want preparing, generating, and collecting", updates)
	}
	if updates[0] != (update{phase: "preparing_voice", percent: 10}) {
		t.Fatalf("first progress = %+v, want preparing_voice/10", updates[0])
	}
	last := updates[len(updates)-1]
	if last != (update{phase: "collecting_outputs", percent: 99}) {
		t.Fatalf("last progress = %+v, want collecting_outputs/99", last)
	}
}

func TestFailTTSStageInvalidatesStaleOutputs(t *testing.T) {
	dir := t.TempDir()
	manifest := NewManifest("demo", dir)
	if err := manifest.ApplyDefaultOutputs(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		manifest.Outputs.TTSAudio,
		manifest.Outputs.VideoWithTTS,
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("stale"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	response, err := failTTSStage(TTSRequest{Workdir: dir, TaskID: "demo"}, manifest, "generate_speech_failed", context.Canceled)
	if err == nil {
		t.Fatal("failTTSStage() error = nil")
	}
	if response.OK {
		t.Fatal("response OK = true, want false")
	}
	if response.Outputs.TTSAudio != "" || response.Outputs.VideoWithTTS != "" {
		t.Fatalf("response outputs = %+v, want TTS outputs cleared", response.Outputs)
	}
	for _, path := range []string{
		filepath.Join(dir, "tts_final_audio.wav"),
		filepath.Join(dir, "video_with_tts.mp4"),
	} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("stale output %s still exists, stat error = %v", path, statErr)
		}
	}
	saved, err := LoadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Stages[string(StageTTS)].OK {
		t.Fatal("saved TTS stage OK = true, want false")
	}
	if saved.Outputs.TTSAudio != "" || saved.Outputs.VideoWithTTS != "" {
		t.Fatalf("saved outputs = %+v, want TTS outputs cleared", saved.Outputs)
	}
}

func TestPrepareTTSOutputsRemovesPreviousArtifacts(t *testing.T) {
	dir := t.TempDir()
	manifest := NewManifest("demo", dir)
	if err := manifest.ApplyDefaultOutputs(); err != nil {
		t.Fatal(err)
	}
	paths := []string{
		manifest.Outputs.TTSAudio,
		manifest.Outputs.VideoWithTTS,
		filepath.Join(dir, "dubbing", "dubbing_plan.json"),
		filepath.Join(dir, "dubbing", "dubbing_report.json"),
		filepath.Join(dir, "dubbing", "dub.srt"),
	}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("stale"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	prepareTTSOutputs(manifest)
	for _, path := range paths {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("previous artifact %s still exists, stat error = %v", path, err)
		}
	}
	if manifest.Outputs.TTSAudio == "" || manifest.Outputs.VideoWithTTS == "" {
		t.Fatalf("prepareTTSOutputs cleared manifest paths: %+v", manifest.Outputs)
	}
}
