package pipeline

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/internal/service"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	pkgimage "krillin-ai/pkg/image"
	"krillin-ai/pkg/util"
	"krillin-ai/pkg/whisper"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type fakeStageService struct {
	downloadErr         error
	processErr          error
	calls               []string
	prepareVTT          []bool
	prepareEmbedTypes   []string
	lastPrepare         *types.SubtitleTaskStepParam
	lastYouTube         *service.YoutubeSubtitleReq
	lastSpeech          *types.SubtitleTaskStepParam
	lastCoverPrompt     string
	lastCoverSize       string
	coverImageB64       string
	preparedVideoPath   string
	preparedAudioPath   string
	audioProgress       []uint8
	audioErr            error
	omitPreparedVideo   bool
	translatedBlocks    []*util.SrtBlock
	translationProgress []ProgressCounts
	detailedProgress    []types.TaskProgress
}

func TestImportedSubtitlesSkipRecognitionAndPreserveMultilineText(t *testing.T) {
	for _, translated := range []bool{false, true} {
		t.Run(fmtBool(translated), func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "input.srt")
			content := "1\n00:00:00,000 --> 00:00:01,000\nfirst line\nsecond line\n"
			if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			fake := &fakeStageService{}
			response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{Input: "https://www.youtube.com/watch?v=import", Workdir: root, TaskID: "import", OriginLang: "en", TargetLang: "zh_cn", PrepareVideo: true, InputSRT: path, SRTTranslated: translated})
			if err != nil {
				t.Fatal(err)
			}
			expected := []string{"prepare"}
			if !translated {
				expected = append(expected, "translate-import")
			}
			if !reflect.DeepEqual(fake.calls, expected) {
				t.Fatalf("calls = %v, want %v", fake.calls, expected)
			}
			if translated && (response.Outputs.OriginSRT != "" || response.Outputs.BilingualSRT != "") {
				t.Fatal("translated import fabricated source subtitles")
			}
			output, err := os.ReadFile(response.Outputs.TargetSRT)
			if err != nil || !strings.Contains(string(output), "first line\nsecond line") {
				t.Fatalf("multiline content lost: %s, %v", output, err)
			}
			original, _ := os.ReadFile(path)
			if string(original) != content {
				t.Fatal("input was overwritten")
			}
		})
	}
}

func TestStandaloneSRTTranslatesWithoutMediaAndPreservesTimeline(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.srt")
	content := "1\n00:00:02,250 --> 00:00:04,750\nHello\nworld\n\n2\n00:00:05,000 --> 00:00:06,500\nNext cue\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	fake := &fakeStageService{}
	response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{Workdir: root, TaskID: "srt-only", OriginLang: "en", TargetLang: "zh_cn", InputSRT: path})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fake.calls, []string{"translate-import"}) {
		t.Fatalf("unexpected media or ASR calls: %v", fake.calls)
	}
	if response.Outputs.OriginVideo != "" {
		t.Fatalf("unexpected video: %+v", response.Outputs)
	}
	for _, output := range []string{response.Outputs.OriginSRT, response.Outputs.TargetSRT, response.Outputs.BilingualSRT} {
		data, err := os.ReadFile(output)
		if err != nil || !strings.Contains(string(data), "00:00:02,250 --> 00:00:04,750") || !strings.Contains(string(data), "00:00:05,000 --> 00:00:06,500") {
			t.Fatalf("timeline changed: %s, %v", data, err)
		}
	}
}

func TestStandaloneSRTReportsActualTranslationProgress(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.srt")
	if err := os.WriteFile(path, []byte("1\n00:00:00,000 --> 00:00:02,000\nHello world.\n"), 0600); err != nil {
		t.Fatal(err)
	}
	fake := &fakeStageService{translationProgress: []ProgressCounts{{0, 12}, {3, 12}, {9, 12}, {12, 12}}}
	var percentages []int
	var translated []ProgressCounts
	translationStarted := false
	_, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{
		Workdir: root, TaskID: "srt-progress", OriginLang: "en", TargetLang: "zh_cn", InputSRT: path,
		ReportProgress: func(phase string, percent int, _ string, counts ...ProgressCounts) {
			if translationStarted && phase == "preparing_source" {
				t.Error("translation reused the video preparation reporter")
			}
			if phase == "translating_subtitles" {
				translationStarted = true
			}
			if len(counts) > 0 {
				translated = append(translated, counts[0])
			}
			if len(percentages) > 0 && percent < percentages[len(percentages)-1] || percent >= 100 {
				t.Errorf("invalid progress: %v followed by %d", percentages, percent)
			}
			percentages = append(percentages, percent)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(translated, fake.translationProgress) {
		t.Fatalf("translation counts = %v, want %v", translated, fake.translationProgress)
	}
	if !reflect.DeepEqual(percentages, []int{1, 3, 5, 5, 27, 72, 95, 96, 98}) {
		t.Fatalf("progress = %v", percentages)
	}
}

func fmtBool(value bool) string {
	if value {
		return "translated"
	}
	return "source"
}

func (f *fakeStageService) TranslateSubtitleBlocks(_ context.Context, blocks []*util.SrtBlock, step *types.SubtitleTaskStepParam) ([]*util.SrtBlock, error) {
	f.calls = append(f.calls, "translate-import")
	for _, counts := range f.translationProgress {
		step.TaskPtr.SetProgress(40 + uint8(counts.Completed*50/counts.Total))
		step.TaskPtr.SetTranslationProgress(counts.Completed, counts.Total)
	}
	if f.translatedBlocks != nil {
		return f.translatedBlocks, f.processErr
	}
	for _, block := range blocks {
		block.TargetLanguageSentence = "translated " + block.OriginLanguageSentence
	}
	return blocks, f.processErr
}

func (f *fakeStageService) PrepareMedia(_ context.Context, p *types.SubtitleTaskStepParam) error {
	f.calls = append(f.calls, "prepare")
	f.prepareVTT = append(f.prepareVTT, p.VttSwitch)
	f.prepareEmbedTypes = append(f.prepareEmbedTypes, p.EmbedSubtitleVideoType)
	f.lastPrepare = p
	for _, event := range f.detailedProgress {
		p.TaskPtr.ReportProgress(event)
	}
	if f.preparedVideoPath != "" {
		p.InputVideoPath = f.preparedVideoPath
	}
	if !f.omitPreparedVideo && (p.EmbedSubtitleVideoType == "all" || f.preparedVideoPath != "") {
		if p.InputVideoPath == "" {
			p.InputVideoPath = filepath.Join(p.TaskBasePath, "origin_video.mp4")
		}
		if err := os.WriteFile(p.InputVideoPath, []byte("fixture-video"), 0600); err != nil {
			return err
		}
	}
	if f.preparedAudioPath != "" {
		p.AudioFilePath = f.preparedAudioPath
	}
	return nil
}

func (f *fakeStageService) GenerateSubtitlesFromAudio(_ context.Context, p *types.SubtitleTaskStepParam) error {
	f.calls = append(f.calls, "audio")
	for _, event := range f.detailedProgress {
		p.TaskPtr.ReportProgress(event)
	}
	for _, percent := range f.audioProgress {
		p.TaskPtr.SetProgress(percent)
	}
	return f.audioErr
}

func (f *fakeStageService) GenerateSpeechFromSRT(_ context.Context, p *types.SubtitleTaskStepParam) error {
	f.calls = append(f.calls, "speech")
	f.lastSpeech = p
	for _, event := range f.detailedProgress {
		p.TaskPtr.ReportProgress(event)
	}
	return nil
}

func (f *fakeStageService) FinalizeSubtitleResults(context.Context, *types.SubtitleTaskStepParam) error {
	return nil
}

func (f *fakeStageService) DownloadYouTubeSubtitle(context.Context, *service.YoutubeSubtitleReq) (string, error) {
	f.calls = append(f.calls, "download-youtube")
	return "demo.en.vtt", f.downloadErr
}

func (f *fakeStageService) ProcessYouTubeSubtitle(_ context.Context, req *service.YoutubeSubtitleReq) (string, error) {
	f.calls = append(f.calls, "process-youtube")
	f.lastYouTube = req
	if req.SourceOnly {
		path := filepath.Join(req.TaskBasePath, types.SubtitleTaskOriginLanguageSrtFileName)
		if err := os.WriteFile(path, []byte("1\n00:00:00,000 --> 00:00:01,000\nsource\n\n"), 0600); err != nil {
			return "", err
		}
	}
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(40)
		req.TaskPtr.SetProgress(65)
		for _, counts := range f.translationProgress {
			req.TaskPtr.SetTranslationProgress(counts.Completed, counts.Total)
		}
		req.TaskPtr.SetProgress(90)
	}
	return "bilingual_srt.srt", f.processErr
}

func (f *fakeStageService) RenderVideo(_ context.Context, req service.RenderVideoRequest) (string, error) {
	for _, event := range f.detailedProgress {
		req.StepParam.TaskPtr.ReportProgress(event)
	}
	return "", nil
}

func (f *fakeStageService) GenerateCoverImage(_ context.Context, req pkgimage.GenerateRequest) (pkgimage.GenerateResult, error) {
	f.calls = append(f.calls, "cover-image")
	f.lastCoverPrompt = req.Prompt
	f.lastCoverSize = req.Size
	return pkgimage.GenerateResult{B64JSON: f.coverImageB64}, nil
}

func TestGenerateSubtitlesFallsBackToAudioWhenAnySourceFails(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{downloadErr: errors.New("no captions")}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
	}
	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if got := fake.calls; len(got) != 3 || got[0] != "download-youtube" || got[1] != "prepare" || got[2] != "audio" {
		t.Fatalf("calls = %v", got)
	}
	if got := fake.prepareVTT; len(got) != 1 || got[0] != false {
		t.Fatalf("prepare VttSwitch values = %v, want [false]", got)
	}
}

func TestGenerateSubtitlesPreservesPlatformAndAudioFallbackErrors(t *testing.T) {
	fake := &fakeStageService{
		downloadErr: errors.New("no original YouTube captions"),
		audioErr:    errors.New("whisperkit-cli exited with status 64"),
	}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       t.TempDir(),
		TaskID:        "demo",
		OriginLang:    "auto",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
	}

	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err == nil {
		t.Fatal("GenerateSubtitles() error = nil, want fallback error")
	}
	if !strings.Contains(err.Error(), "no original YouTube captions") ||
		!strings.Contains(err.Error(), "whisperkit-cli exited with status 64") {
		t.Fatalf("GenerateSubtitles() error = %q, want both failure reasons", err)
	}
	if resp.Error == nil || resp.Error.Code != "audio_transcription_failed" {
		t.Fatalf("response error = %+v", resp.Error)
	}
}

func TestGenerateSubtitlesPreservesTranscriptionClassification(t *testing.T) {
	for _, code := range []string{"audio_no_speech", "audio_transcription_empty", "audio_transcription_invalid_response", "audio_transcription_timestamps_missing", "audio_transcription_api_failed"} {
		for _, fallback := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/fallback=%v", code, fallback), func(t *testing.T) {
				classified := &whisper.TranscriptionError{Code: code, Message: "fixture reason"}
				fake := &fakeStageService{audioErr: fmt.Errorf("service wrapper: %w", classified)}
				req := SubtitleRequest{Input: "local:fixture.mp4", Workdir: t.TempDir(), CaptionSource: CaptionSourceWhisper}
				if fallback {
					req.Input, req.CaptionSource = "https://youtu.be/1_iv-S02hJ0", CaptionSourceAny
					fake.downloadErr = errors.New("no captions")
				}
				response, err := GenerateSubtitles(context.Background(), fake, req)
				if !errors.Is(err, classified) || response.Error == nil || response.Error.Code != code || response.Error.Retryable != classified.Retryable() {
					t.Fatalf("response = %+v, error = %v", response.Error, err)
				}
			})
		}
	}
}

func TestGenerateSubtitlesPassesSubtitleStyleToStepParam(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	style := subtitlestyle.DefaultStyleSet()
	req := SubtitleRequest{
		Input:         "local:demo.mp4",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceWhisper,
		SubtitleStyle: style,
	}

	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if fake.lastPrepare == nil || fake.lastPrepare.SubtitleStyle != style {
		t.Fatalf("SubtitleStyle was not passed to stepParam")
	}
}

func TestGenerateSubtitlesReportsPreparedLocalMediaOutputs(t *testing.T) {
	dir := t.TempDir()
	source := dir + "/source.webm"
	audio := dir + "/origin_audio.mp3"
	fake := &fakeStageService{
		preparedVideoPath: source,
		preparedAudioPath: audio,
	}
	req := SubtitleRequest{
		Input:         "local:" + source,
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceWhisper,
	}

	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if resp.Outputs.OriginVideo != source {
		t.Fatalf("OriginVideo = %q, want %q", resp.Outputs.OriginVideo, source)
	}
	if resp.Outputs.OriginAudio != audio {
		t.Fatalf("OriginAudio = %q, want %q", resp.Outputs.OriginAudio, audio)
	}
}

func TestGenerateSubtitlesMapsDetailedAudioProgress(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{
		audioProgress: []uint8{22, 32, 42, 52, 65, 77, 90},
	}
	var reported []int
	req := SubtitleRequest{
		Input:         "local:demo.mp4",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "zh_cn",
		TargetLang:    "en",
		CaptionSource: CaptionSourceWhisper,
		ReportProgress: func(_ string, percent int, _ string, _ ...ProgressCounts) {
			reported = append(reported, percent)
		},
	}

	if _, err := GenerateSubtitles(context.Background(), fake, req); err != nil {
		t.Fatal(err)
	}

	want := []int{31, 39, 48, 57, 68, 78, 90}
	for _, percent := range want {
		if !containsInt(reported, percent) {
			t.Fatalf("reported progress %v does not contain %d", reported, percent)
		}
	}
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestGenerateSubtitlesManualDoesNotFallback(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{downloadErr: errors.New("no captions")}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceManual,
	}
	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err == nil {
		t.Fatalf("GenerateSubtitles() error = nil, want error")
	}
	if resp.OK {
		t.Fatalf("OK = true, want false")
	}
	if got := fake.calls; len(got) != 1 || got[0] != "download-youtube" {
		t.Fatalf("calls = %v", got)
	}
}

func TestGenerateSubtitlesYouTubeCaptionsDoNotUseAudio(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
	}
	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if resp.CaptionSource == "" {
		t.Fatalf("CaptionSource is empty")
	}
	if got := fake.calls; len(got) != 2 || got[0] != "download-youtube" || got[1] != "process-youtube" {
		t.Fatalf("calls = %v", got)
	}
	for _, call := range fake.calls {
		if call == "audio" {
			t.Fatalf("calls = %v, did not expect audio transcription", fake.calls)
		}
	}
}

func TestGenerateSubtitlesSourceOnlySkipsTranslationAndVideoPreparation(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "source-only",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
		SourceOnly:    true,
	}

	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil || !resp.OK {
		t.Fatalf("response = %+v, error = %v", resp, err)
	}
	if got := fake.calls; len(got) != 2 || got[0] != "download-youtube" || got[1] != "process-youtube" {
		t.Fatalf("calls = %v, want platform captions only", got)
	}
	if fake.lastPrepare != nil {
		t.Fatal("source-only captions unexpectedly prepared media")
	}
	if fake.lastYouTube == nil || !fake.lastYouTube.SourceOnly {
		t.Fatal("YouTube request did not preserve SourceOnly")
	}
	if resp.Outputs.OriginSRT == "" {
		t.Fatal("OriginSRT is empty")
	}
	if resp.Outputs.TargetSRT != "" || resp.Outputs.BilingualSRT != "" || resp.Outputs.ShortOriginMixedSRT != "" {
		t.Fatalf("source-only response advertised translated outputs: %+v", resp.Outputs)
	}
}

func TestGenerateSubtitlesYouTubeCaptionsPrepareOriginalMediaForRendering(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
		PrepareVideo:  true,
	}
	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if got := fake.calls; len(got) != 3 || got[0] != "download-youtube" || got[1] != "process-youtube" || got[2] != "prepare" {
		t.Fatalf("calls = %v", got)
	}
	if got := fake.prepareVTT; len(got) != 1 || got[0] != false {
		t.Fatalf("prepare VttSwitch values = %v, want [false]", got)
	}
	if got := fake.prepareEmbedTypes; len(got) != 1 || got[0] != "all" {
		t.Fatalf("prepare EmbedSubtitleVideoType values = %v, want [all]", got)
	}
}

func TestGenerateSubtitlesReportsPlatformTranslationAndMediaProgress(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	type update struct {
		phase   string
		percent int
	}
	updates := []update{}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
		PrepareVideo:  true,
		ReportProgress: func(phase string, percent int, _ string, _ ...ProgressCounts) {
			updates = append(updates, update{phase: phase, percent: percent})
		},
	}

	if _, err := GenerateSubtitles(context.Background(), fake, req); err != nil {
		t.Fatal(err)
	}
	assertProgress := func(phase string, percent int) {
		t.Helper()
		for _, candidate := range updates {
			if candidate.phase == phase && candidate.percent == percent {
				return
			}
		}
		t.Fatalf("missing progress %s/%d in %+v", phase, percent, updates)
	}
	assertProgress("translating_subtitles", 50)
	assertProgress("preparing_original_media", 88)
	assertProgress("collecting_outputs", 98)
}

func TestGenerateSubtitlesWhisperSkipsYouTubeDownload(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceWhisper,
	}
	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if got := fake.calls; len(got) != 2 || got[0] != "prepare" || got[1] != "audio" {
		t.Fatalf("calls = %v", got)
	}
	if got := fake.prepareVTT; len(got) != 1 || got[0] != false {
		t.Fatalf("prepare VttSwitch values = %v, want [false]", got)
	}
}

func TestGenerateSubtitlesWhisperPreparesVideoWhenRequested(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceWhisper,
		PrepareVideo:  true,
	}

	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if got := fake.prepareEmbedTypes; len(got) != 1 || got[0] != "all" {
		t.Fatalf("prepare EmbedSubtitleVideoType values = %v, want [all]", got)
	}
}

func TestGenerateSubtitlesRejectsMissingRequestedVideo(t *testing.T) {
	req := SubtitleRequest{Input: "https://www.youtube.com/watch?v=abc", Workdir: t.TempDir(),
		TaskID: "missing-video", OriginLang: "en", TargetLang: "zh_cn", CaptionSource: CaptionSourceWhisper, PrepareVideo: true}
	resp, err := GenerateSubtitles(context.Background(), &fakeStageService{omitPreparedVideo: true}, req)
	if err == nil || resp.OK || resp.Error.Code != "source_video_missing" {
		t.Fatalf("response = %+v, error = %v", resp, err)
	}
	if resp.Outputs.OriginVideo != "" {
		t.Fatal("missing video was advertised")
	}
	manifest, err := LoadManifest(req.Workdir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Stages[string(StageSubtitle)].OK {
		t.Fatal("missing video was marked successful")
	}
}

func TestAudioOnlySubtitlesDoNotAdvertiseMissingVideo(t *testing.T) {
	req := SubtitleRequest{Input: "https://www.youtube.com/watch?v=abc", Workdir: t.TempDir(),
		TaskID: "audio-only", OriginLang: "en", TargetLang: "zh_cn", CaptionSource: CaptionSourceWhisper}
	resp, err := GenerateSubtitles(context.Background(), &fakeStageService{}, req)
	if err != nil || !resp.OK {
		t.Fatalf("response = %+v, error = %v", resp, err)
	}
	if resp.Outputs.OriginVideo != "" {
		t.Fatal("audio-only request advertised nonexistent video")
	}
}

func TestGenerateSubtitlesFallbackPreparesVideoWhenRequested(t *testing.T) {
	dir := t.TempDir()
	fake := &fakeStageService{downloadErr: errors.New("no captions")}
	req := SubtitleRequest{
		Input:         "https://www.youtube.com/watch?v=abc",
		Workdir:       dir,
		TaskID:        "demo",
		OriginLang:    "en",
		TargetLang:    "zh_cn",
		CaptionSource: CaptionSourceAny,
		PrepareVideo:  true,
	}

	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if got := fake.prepareEmbedTypes; len(got) != 1 || got[0] != "all" {
		t.Fatalf("prepare EmbedSubtitleVideoType values = %v, want [all]", got)
	}
}

func TestPlatformTranslationFailureDoesNotDownloadOrTranscribe(t *testing.T) {
	fake := &fakeStageService{processErr: errors.New("translation service unavailable")}
	response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{Input: "https://www.youtube.com/watch?v=abc", Workdir: t.TempDir(), TaskID: "translation-error", OriginLang: "en", TargetLang: "zh_cn", CaptionSource: CaptionSourceAny})
	if err == nil || response.Error.Code != "platform_caption_processing_failed" {
		t.Fatalf("response = %+v, error = %v", response, err)
	}
	if len(fake.calls) != 2 || fake.calls[0] != "download-youtube" || fake.calls[1] != "process-youtube" {
		t.Fatalf("unexpected fallback calls: %v", fake.calls)
	}
}

func TestUnusablePlatformCaptionsFallBackToAudio(t *testing.T) {
	fake := &fakeStageService{processErr: fmt.Errorf("%w: no usable VTT text", service.ErrYouTubeCaptionInvalid)}
	var messages []string
	response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{
		Input: "https://www.youtube.com/watch?v=m5yrQMnc_jQ", Workdir: t.TempDir(), TaskID: "invalid-vtt",
		OriginLang: "en", TargetLang: "zh_cn", CaptionSource: CaptionSourceAny,
		ReportProgress: func(phase string, _ int, message string, _ ...ProgressCounts) {
			if phase == "fallback_to_transcription" {
				messages = append(messages, message)
			}
		},
	})
	if err != nil || !response.OK {
		t.Fatalf("response = %+v, error = %v", response, err)
	}
	if !reflect.DeepEqual(fake.calls, []string{"download-youtube", "process-youtube", "prepare", "audio"}) {
		t.Fatalf("calls = %v, want caption processing followed by audio transcription", fake.calls)
	}
	if !reflect.DeepEqual(fake.prepareVTT, []bool{false}) {
		t.Fatalf("prepare VttSwitch values = %v, want [false]", fake.prepareVTT)
	}
	manifest, err := LoadManifest(response.Workdir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CaptionSource != "whisper" || !reflect.DeepEqual(manifest.Warnings, messages) || len(messages) != 1 {
		t.Fatalf("manifest = %+v, fallback messages = %v", manifest, messages)
	}
}

func TestUnusablePlatformCaptionsSignalDeferredTranscription(t *testing.T) {
	fake := &fakeStageService{processErr: service.ErrYouTubeCaptionInvalid}
	response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{
		Input: "https://www.youtube.com/watch?v=abc", Workdir: t.TempDir(), TaskID: "invalid-vtt",
		CaptionSource: CaptionSourcePlatform,
	})
	if err == nil || response.Error.Code != "platform_caption_invalid" {
		t.Fatalf("response = %+v, error = %v", response, err)
	}
	if !reflect.DeepEqual(fake.calls, []string{"download-youtube", "process-youtube"}) {
		t.Fatalf("calls = %v, want platform-only attempt", fake.calls)
	}
}

func TestUnusableCaptionsPreserveAudioFallbackFailure(t *testing.T) {
	fake := &fakeStageService{
		processErr: fmt.Errorf("%w: invalid VTT timestamps", service.ErrYouTubeCaptionInvalid),
		audioErr:   errors.New("transcription unavailable"),
	}
	response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{
		Input: "https://www.youtube.com/watch?v=abc", Workdir: t.TempDir(), TaskID: "fallback-failed",
		CaptionSource: CaptionSourceAny,
	})
	if err == nil || response.Error.Code != "audio_transcription_failed" ||
		!strings.Contains(err.Error(), "invalid VTT timestamps") || !strings.Contains(err.Error(), "transcription unavailable") {
		t.Fatalf("response = %+v, error = %v", response, err)
	}
}

func TestPlatformAccessFailureDoesNotTriggerWhisperDownload(t *testing.T) {
	for _, captionSource := range []CaptionSource{CaptionSourceAny, CaptionSourcePlatform} {
		t.Run(string(captionSource), func(testCase *testing.T) {
			fake := &fakeStageService{downloadErr: service.ErrYouTubeCaptionAccess}
			response, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{Input: "https://www.youtube.com/watch?v=abc", Workdir: testCase.TempDir(), TaskID: "access-error", CaptionSource: captionSource})
			if err == nil || response.Error.Code != "platform_caption_access_failed" || len(fake.calls) != 1 {
				testCase.Fatalf("response = %+v, error = %v, calls = %v", response, err, fake.calls)
			}
		})
	}
}

func TestIsYouTubeInput(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{input: "https://www.youtube.com/watch?v=demo", want: true},
		{input: "https://m.youtube.com/watch?v=demo", want: true},
		{input: "https://youtu.be/demo", want: true},
		{input: "https://www.youtube-nocookie.com/embed/demo", want: true},
		{input: "https://youtube.com.example.test/watch?v=demo", want: false},
		{input: "local:/tmp/video.mp4", want: false},
	}
	for _, test := range tests {
		if got := IsYouTubeInput(test.input); got != test.want {
			t.Fatalf("IsYouTubeInput(%q) = %v, want %v", test.input, got, test.want)
		}
	}
}
