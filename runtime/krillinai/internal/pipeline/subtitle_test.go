package pipeline

import (
	"context"
	"errors"
	"krillin-ai/internal/service"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	pkgimage "krillin-ai/pkg/image"
	"krillin-ai/pkg/util"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type fakeStageService struct {
	downloadErr       error
	processErr        error
	calls             []string
	prepareVTT        []bool
	prepareEmbedTypes []string
	lastPrepare       *types.SubtitleTaskStepParam
	lastYouTube       *service.YoutubeSubtitleReq
	lastSpeech        *types.SubtitleTaskStepParam
	lastCoverPrompt   string
	lastCoverSize     string
	coverImageB64     string
	preparedVideoPath string
	preparedAudioPath string
	audioProgress     []uint8
	omitPreparedVideo bool
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

func fmtBool(value bool) string {
	if value {
		return "translated"
	}
	return "source"
}

func (f *fakeStageService) TranslateSubtitleBlocks(_ context.Context, blocks []*util.SrtBlock, _ *types.SubtitleTaskStepParam) error {
	f.calls = append(f.calls, "translate-import")
	for _, block := range blocks {
		block.TargetLanguageSentence = "translated " + block.OriginLanguageSentence
	}
	return f.processErr
}

func (f *fakeStageService) PrepareMedia(_ context.Context, p *types.SubtitleTaskStepParam) error {
	f.calls = append(f.calls, "prepare")
	f.prepareVTT = append(f.prepareVTT, p.VttSwitch)
	f.prepareEmbedTypes = append(f.prepareEmbedTypes, p.EmbedSubtitleVideoType)
	f.lastPrepare = p
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
	for _, percent := range f.audioProgress {
		p.TaskPtr.SetProgress(percent)
	}
	return nil
}

func (f *fakeStageService) GenerateSpeechFromSRT(_ context.Context, p *types.SubtitleTaskStepParam) error {
	f.calls = append(f.calls, "speech")
	f.lastSpeech = p
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
		req.TaskPtr.SetProgress(90)
	}
	return "bilingual_srt.srt", f.processErr
}

func (f *fakeStageService) RenderVideo(context.Context, service.RenderVideoRequest) (string, error) {
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
	if got := fake.calls; len(got) != 4 || got[0] != "prepare" || got[1] != "download-youtube" || got[2] != "prepare" || got[3] != "audio" {
		t.Fatalf("calls = %v", got)
	}
	if got := fake.prepareVTT; len(got) != 2 || got[0] != true || got[1] != false {
		t.Fatalf("prepare VttSwitch values = %v, want [true false]", got)
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
		ReportProgress: func(_ string, percent int, _ string) {
			reported = append(reported, percent)
		},
	}

	if _, err := GenerateSubtitles(context.Background(), fake, req); err != nil {
		t.Fatal(err)
	}

	want := []int{39, 45, 52, 58, 67, 75, 83}
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
	if got := fake.calls; len(got) != 2 || got[1] != "download-youtube" {
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
	if got := fake.calls; len(got) != 4 || got[0] != "prepare" || got[1] != "download-youtube" || got[2] != "process-youtube" || got[3] != "prepare" {
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
	if got := fake.calls; len(got) != 3 || got[0] != "prepare" || got[1] != "download-youtube" || got[2] != "process-youtube" {
		t.Fatalf("calls = %v, want source preparation and platform captions only", got)
	}
	if fake.lastPrepare == nil || fake.lastPrepare.SubtitleResultType != types.SubtitleResultTypeOriginOnly {
		t.Fatalf("SubtitleResultType = %v, want origin only", fake.lastPrepare.SubtitleResultType)
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
	}
	resp, err := GenerateSubtitles(context.Background(), fake, req)
	if err != nil {
		t.Fatalf("GenerateSubtitles() error = %v", err)
	}
	if !resp.OK {
		t.Fatalf("OK = false, want true")
	}
	if got := fake.calls; len(got) != 4 || got[0] != "prepare" || got[1] != "download-youtube" || got[2] != "process-youtube" || got[3] != "prepare" {
		t.Fatalf("calls = %v", got)
	}
	if got := fake.prepareVTT; len(got) != 2 || got[0] != true || got[1] != false {
		t.Fatalf("prepare VttSwitch values = %v, want [true false]", got)
	}
	if got := fake.prepareEmbedTypes; len(got) != 2 || got[1] != "all" {
		t.Fatalf("prepare EmbedSubtitleVideoType values = %v, want second value all", got)
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
		ReportProgress: func(phase string, percent int, _ string) {
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
	assertProgress("translating_subtitles", 57)
	assertProgress("preparing_original_media", 76)
	assertProgress("collecting_outputs", 95)
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
	if got := fake.prepareEmbedTypes; len(got) != 2 || got[0] != "none" || got[1] != "all" {
		t.Fatalf("prepare EmbedSubtitleVideoType values = %v, want [none all]", got)
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
