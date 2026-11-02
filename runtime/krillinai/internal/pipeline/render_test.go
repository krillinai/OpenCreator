package pipeline

import (
	"context"
	"encoding/json"
	"krillin-ai/internal/service"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type renderFakeService struct {
	fakeStageService
	lastRender service.RenderVideoRequest
}

func (f *renderFakeService) RenderVideo(_ context.Context, req service.RenderVideoRequest) (string, error) {
	f.lastRender = req
	return req.OutputFile, nil
}

func TestRenderHorizontalDubbedOutputName(t *testing.T) {
	dir := t.TempDir()
	fake := &renderFakeService{}
	req := RenderRequest{
		Workdir:    dir,
		TaskID:     "demo",
		Video:      "origin_video.mp4",
		Audio:      "tts_final_audio.wav",
		Subtitle:   "target_language_srt.srt",
		Horizontal: true,
		Dubbed:     true,
	}
	resp, err := Render(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if !strings.HasSuffix(fake.lastRender.OutputFile, "horizontal_dubbed.mp4") {
		t.Fatalf("OutputFile = %q, want horizontal_dubbed.mp4 suffix", fake.lastRender.OutputFile)
	}
}

func TestRenderPassesSubtitleStyleToService(t *testing.T) {
	dir := t.TempDir()
	fake := &renderFakeService{}
	style := subtitlestyle.DefaultStyleSet()
	req := RenderRequest{
		Workdir:       dir,
		TaskID:        "demo",
		Video:         "origin_video.mp4",
		Subtitle:      "bilingual_srt.srt",
		Horizontal:    true,
		SubtitleStyle: style,
		LineMode:      LineModeBilingualTargetBottom,
	}

	resp, err := Render(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if fake.lastRender.StepParam == nil || fake.lastRender.StepParam.SubtitleStyle != style {
		t.Fatalf("SubtitleStyle was not passed to service")
	}
	if fake.lastRender.StepParam.SubtitleResultType != types.SubtitleResultTypeBilingualTranslationOnBottom {
		t.Fatal("subtitle line ordering was not passed to service")
	}
}

func TestRenderPassesSubtitleDocumentToService(t *testing.T) {
	dir := t.TempDir()
	fake := &renderFakeService{}
	req := RenderRequest{
		Workdir:          dir,
		TaskID:           "demo",
		Video:            "origin_video.mp4",
		Subtitle:         "bilingual_srt.srt",
		SubtitleDocument: "subtitle-document.json",
		Horizontal:       true,
	}

	if _, err := Render(context.Background(), fake, req); err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if fake.lastRender.SubtitleDocument != req.SubtitleDocument {
		t.Fatalf("SubtitleDocument = %q, want %q", fake.lastRender.SubtitleDocument, req.SubtitleDocument)
	}
}

func TestRenderVerticalBilingualOutputName(t *testing.T) {
	dir := t.TempDir()
	fake := &renderFakeService{}
	req := RenderRequest{
		Workdir:    dir,
		TaskID:     "demo",
		Video:      "origin_video.mp4",
		Subtitle:   "short_origin_mixed_srt.srt",
		Horizontal: false,
		Dubbed:     false,
	}
	resp, err := Render(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if !strings.HasSuffix(fake.lastRender.OutputFile, "vertical_bilingual.mp4") {
		t.Fatalf("OutputFile = %q, want vertical_bilingual.mp4 suffix", fake.lastRender.OutputFile)
	}
}

func TestRenderDubbedDefaultsToVideoWithTTSAndTargetSubtitle(t *testing.T) {
	dir := t.TempDir()
	manifest := NewManifest("demo", dir)
	manifest.Outputs.OriginVideo = filepath.Join(dir, "custom_origin.mp4")
	manifest.Outputs.VideoWithTTS = filepath.Join(dir, "custom_tts_video.mp4")
	manifest.Outputs.TargetSRT = filepath.Join(dir, "custom_target.srt")
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ManifestPath(dir), data, 0644); err != nil {
		t.Fatal(err)
	}

	fake := &renderFakeService{}
	req := RenderRequest{
		Workdir:    dir,
		TaskID:     "demo",
		Horizontal: true,
		Dubbed:     true,
	}
	resp, err := Render(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("Render() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if fake.lastRender.InputVideo != manifest.Outputs.VideoWithTTS {
		t.Fatalf("InputVideo = %q, want %q", fake.lastRender.InputVideo, manifest.Outputs.VideoWithTTS)
	}
	if fake.lastRender.SubtitleFile != manifest.Outputs.TargetSRT {
		t.Fatalf("SubtitleFile = %q, want %q", fake.lastRender.SubtitleFile, manifest.Outputs.TargetSRT)
	}
	if !strings.HasSuffix(resp.Outputs.HorizontalVideo, "horizontal_dubbed.mp4") {
		t.Fatalf("HorizontalVideo = %q, want horizontal_dubbed.mp4 suffix", resp.Outputs.HorizontalVideo)
	}
}
