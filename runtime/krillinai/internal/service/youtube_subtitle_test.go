package service

import (
	"context"
	"errors"
	"krillin-ai/config"
	"krillin-ai/internal/deps"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestProcessYouTubeSubtitleClassifiesUnusableVTT(t *testing.T) {
	service := subtitleRoutingTestService(t)
	service.translator = nil
	for name, content := range map[string]string{
		"empty":      "WEBVTT\n\n",
		"music-only": "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n[Music]\n\n",
		"block-text": "WEBVTT\nKind: captions\nLanguage: en\n\n00:00:11.840 --> 00:00:17.360\nuh these efforts by lawmakers to pass some form of&nbsp;\nAI regulation. There have been more than a hundred\n\n",
		"malformed":  "WEBVTT\n\ninvalid --> timestamps\nNormal speech\n\n",
	} {
		t.Run(name, func(t *testing.T) {
			request := subtitleRoutingTestRequest(t, content)
			request.SourceOnly = true
			output, err := service.processYouTubeSubtitle(context.Background(), request)
			if name == "block-text" {
				if err != nil {
					t.Fatalf("有效整句字幕应成功: %v", err)
				}
				data, err := os.ReadFile(output)
				if err != nil || !strings.Contains(string(data), "AI regulation. There have been more than a hundred") {
					t.Fatalf("整句正文丢失: %s, %v", data, err)
				}
				return
			}
			if !errors.Is(err, ErrYouTubeCaptionInvalid) {
				t.Fatalf("不可用字幕应使用平台字幕无效分类: %v", err)
			}
		})
	}
	_, err := service.processYouTubeSubtitle(context.Background(), &YoutubeSubtitleReq{
		VttFile: filepath.Join(t.TempDir(), "missing.vtt"),
	})
	if !errors.Is(err, ErrYouTubeCaptionInvalid) {
		t.Fatalf("缺少VTT应使用平台字幕无效分类: %v", err)
	}
}

func TestSelectYouTubeSubtitleTrackPrefersManualOriginLanguage(t *testing.T) {
	metadata := youtubeSubtitleMetadata{
		Language: "en",
		Subtitles: map[string][]youtubeSubtitleFormat{
			"en": {{URL: "https://example.test/caption?lang=en"}},
			"es": {{URL: "https://example.test/caption?lang=es"}},
		},
		AutomaticCaptions: map[string][]youtubeSubtitleFormat{
			"en": {{URL: "https://example.test/auto?lang=en"}},
		},
	}

	track, err := selectYouTubeSubtitleTrack(metadata, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if track.Language != "en" || track.Automatic {
		t.Fatalf("track = %+v, want manual en", track)
	}
}

func TestSelectYouTubeSubtitleTrackUsesOriginalAutomaticCaption(t *testing.T) {
	metadata := youtubeSubtitleMetadata{
		Language: "en",
		AutomaticCaptions: map[string][]youtubeSubtitleFormat{
			"en": {{URL: "https://example.test/auto?lang=en"}},
			"es": {{URL: "https://example.test/auto?lang=en&tlang=es"}},
		},
	}

	track, err := selectYouTubeSubtitleTrack(metadata, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if track.Language != "en" || !track.Automatic {
		t.Fatalf("track = %+v, want automatic en", track)
	}
	if got := automaticOriginLanguageKeys(metadata.AutomaticCaptions); !reflect.DeepEqual(got, []string{"en"}) {
		t.Fatalf("automatic origin languages = %v, want [en]", got)
	}
}

func TestSelectYouTubeSubtitleTrackPrefersMarkedOriginalCaptionForAuto(t *testing.T) {
	metadata := youtubeSubtitleMetadata{
		Language: "en",
		Subtitles: map[string][]youtubeSubtitleFormat{
			"en": {{URL: "https://example.test/caption?lang=en"}},
		},
		AutomaticCaptions: map[string][]youtubeSubtitleFormat{
			"en-orig": {{URL: "https://example.test/auto?lang=en", Name: "English (Original)"}},
		},
	}

	track, err := selectYouTubeSubtitleTrack(metadata, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if track.Language != "en-orig" || !track.Automatic {
		t.Fatalf("track = %+v, want automatic en-orig", track)
	}
}

func TestSelectYouTubeSubtitleTrackPrefersMarkedOriginalCaptionForExplicitLanguage(t *testing.T) {
	metadata := youtubeSubtitleMetadata{
		Language: "en",
		Subtitles: map[string][]youtubeSubtitleFormat{
			"en": {{URL: "https://example.test/caption?lang=en"}},
		},
		AutomaticCaptions: map[string][]youtubeSubtitleFormat{
			"en-orig": {{URL: "https://example.test/auto?lang=en", Name: "English (Original)"}},
		},
	}

	track, err := selectYouTubeSubtitleTrack(metadata, "en")
	if err != nil {
		t.Fatal(err)
	}
	if track.Language != "en-orig" || !track.Automatic {
		t.Fatalf("track = %+v, want automatic en-orig", track)
	}
}

func TestSelectYouTubeSubtitleTrackFallsBackOnlyForUniqueTrack(t *testing.T) {
	metadata := youtubeSubtitleMetadata{
		Subtitles: map[string][]youtubeSubtitleFormat{
			"ja": {{URL: "https://example.test/caption?lang=ja"}},
		},
	}
	track, err := selectYouTubeSubtitleTrack(metadata, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if track.Language != "ja" || track.Automatic {
		t.Fatalf("track = %+v, want manual ja", track)
	}

	metadata.Subtitles["en"] = []youtubeSubtitleFormat{{URL: "https://example.test/caption?lang=en"}}
	if _, err := selectYouTubeSubtitleTrack(metadata, "auto"); err == nil {
		t.Fatal("selectYouTubeSubtitleTrack() error = nil, want ambiguous origin error")
	}
}

func TestSelectYouTubeSubtitleTrackMatchesExplicitLanguage(t *testing.T) {
	metadata := youtubeSubtitleMetadata{
		Subtitles: map[string][]youtubeSubtitleFormat{
			"zh-Hans": {{URL: "https://example.test/caption?lang=zh-Hans"}},
		},
	}
	track, err := selectYouTubeSubtitleTrack(metadata, "zh_cn")
	if err != nil {
		t.Fatal(err)
	}
	if track.Language != "zh-Hans" || track.Automatic {
		t.Fatalf("track = %+v, want manual zh-Hans", track)
	}
}

func TestYouTubeSubtitleCommandArgsUsesResolvedTrack(t *testing.T) {
	manualArgs := youtubeSubtitleCommandArgs(youtubeSubtitleTrack{Language: "en"}, "video.%(ext)s")
	joinedManual := strings.Join(manualArgs, " ")
	if strings.Contains(joinedManual, "auto") || !strings.Contains(joinedManual, "--write-subs --sub-langs en --sub-format vtt") {
		t.Fatalf("manual args = %v", manualArgs)
	}

	automaticArgs := youtubeSubtitleCommandArgs(youtubeSubtitleTrack{Language: "en", Automatic: true}, "video.%(ext)s")
	joinedAutomatic := strings.Join(automaticArgs, " ")
	if strings.Contains(joinedAutomatic, "--sub-langs auto") || !strings.Contains(joinedAutomatic, "--write-auto-subs --sub-langs en --sub-format vtt") {
		t.Fatalf("automatic args = %v", automaticArgs)
	}
}

func TestYouTubeSubtitleUsesAppProxy(t *testing.T) {
	previous := config.Conf.App.Proxy
	config.Conf.App.Proxy = "http://127.0.0.1:7897"
	t.Cleanup(func() { config.Conf.App.Proxy = previous })

	args := appendYouTubeAccessArgs([]string{"--skip-download"})
	if !strings.Contains(strings.Join(args, "\n"), "--proxy\n"+config.Conf.App.Proxy) {
		t.Fatalf("YouTube subtitle args = %v, want app proxy", args)
	}
}

func TestDownloadYouTubeSubtitleAutoIntegration(t *testing.T) {
	if os.Getenv("KRILLIN_RUN_YOUTUBE_SUBTITLE_AUTO_INTEGRATION") != "1" {
		t.Skip("set KRILLIN_RUN_YOUTUBE_SUBTITLE_AUTO_INTEGRATION=1 to run the YouTube auto-language integration test")
	}
	log.InitLogger()
	ytdlpPath, err := exec.LookPath("yt-dlp")
	if err != nil {
		t.Fatalf("find yt-dlp: %v", err)
	}
	previousPath, previousPrefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	storage.YtdlpPath, storage.YtdlpPrefixArgs = ytdlpPath, nil
	t.Cleanup(func() {
		storage.YtdlpPath, storage.YtdlpPrefixArgs = previousPath, previousPrefix
	})

	req := &YoutubeSubtitleReq{
		TaskBasePath:   t.TempDir(),
		TaskId:         "youtube-auto-origin",
		OriginLanguage: "auto",
		URL:            "https://www.youtube.com/watch?v=paF--WGA8dU",
	}
	path, err := NewYouTubeSubtitleService().downloadYouTubeSubtitle(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if req.OriginLanguage != "en" {
		t.Fatalf("origin language = %q, want en", req.OriginLanguage)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat downloaded subtitle: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("downloaded subtitle is empty")
	}
	if !strings.Contains(filepath.Base(path), ".en-orig.") {
		t.Fatalf("downloaded subtitle = %q, want the en-orig track", path)
	}
}

func TestDownloadYouTubeSubtitleExplicitLanguageIntegration(t *testing.T) {
	if os.Getenv("KRILLIN_RUN_YOUTUBE_SUBTITLE_AUTO_INTEGRATION") != "1" {
		t.Skip("set KRILLIN_RUN_YOUTUBE_SUBTITLE_AUTO_INTEGRATION=1 to run the YouTube subtitle integration test")
	}
	log.InitLogger()
	ytdlpPath, err := exec.LookPath("yt-dlp")
	if err != nil {
		t.Fatalf("find yt-dlp: %v", err)
	}
	previousPath, previousPrefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	storage.YtdlpPath, storage.YtdlpPrefixArgs = ytdlpPath, nil
	t.Cleanup(func() {
		storage.YtdlpPath, storage.YtdlpPrefixArgs = previousPath, previousPrefix
	})

	req := &YoutubeSubtitleReq{
		TaskBasePath:   t.TempDir(),
		TaskId:         "youtube-explicit-origin",
		OriginLanguage: "en",
		URL:            "https://www.youtube.com/watch?v=paF--WGA8dU",
	}
	service := NewYouTubeSubtitleService()
	path, err := service.downloadYouTubeSubtitle(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if req.OriginLanguage != "en" {
		t.Fatalf("origin language = %q, want en", req.OriginLanguage)
	}
	if !strings.Contains(filepath.Base(path), ".en-orig.") {
		t.Fatalf("downloaded subtitle = %q, want the en-orig track", path)
	}
	hasWordTimestamps, err := service.DetectVttFormat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !hasWordTimestamps {
		t.Fatalf("downloaded subtitle = %q, want word-level timestamps", path)
	}
}

func Test_YoutubeSubtitle(t *testing.T) {
	skipYouTubeSubtitleIntegrationTest(t)

	s := initService()
	deps.CheckDependency()
	config.Conf.App.MaxSentenceLength = 50

	req := &YoutubeSubtitleReq{
		TaskBasePath:   t.TempDir(),
		TaskId:         "CuxmTJqpc0U",
		OriginLanguage: "en",
		TargetLanguage: "zh_cn",
		URL:            "https://www.youtube.com/watch?v=CuxmTJqpc0U",
	}

	_, err := s.YouTubeSubtitleSrv.Process(context.Background(), req)
	if err != nil {
		t.Errorf("HandleYouTubeSubtitle() error = %v, want nil", err)
	}

}

func Test_ExtractWordsFromVtt(t *testing.T) {
	log.InitLogger()
	s := NewYouTubeSubtitleService()
	config.Conf.App.MaxSentenceLength = 100

	workdir := t.TempDir()
	vttFile := copyTestVtt(t, workdir, "GjickmuG0vU.en.vtt")
	words, err := s.ExtractWordsFromVtt(vttFile)
	if err != nil {
		t.Errorf("ExtractWordsFromVtt() error = %v, want nil", err)
	}
	if len(words) == 0 {
		t.Fatal("ExtractWordsFromVtt() returned no words")
	}

	//将words输出到文件
	outputFile := filepath.Join(workdir, "extracted_words.txt")
	file, err := os.Create(outputFile)
	if err != nil {
		t.Errorf("Failed to create output file: %v", err)
		return
	}
	defer file.Close()
	for _, word := range words {
		file.WriteString(word.Start + "-->" + word.End + "\n")
		file.WriteString(word.Text + "\n\n")
	}
}

func Test_processYouTubeSubtitle(t *testing.T) {
	skipYouTubeSubtitleIntegrationTest(t)

	s := initService()
	deps.CheckDependency()
	config.Conf.App.MaxSentenceLength = 50
	workdir := t.TempDir()
	vttFile := copyTestVtt(t, workdir, "1srQ7Mq_ToI.en.vtt")

	req := &YoutubeSubtitleReq{
		TaskBasePath:        workdir,
		TaskId:              "1srQ7Mq__UcQG",
		OriginLanguage:      "en",
		TargetLanguage:      "zh_cn",
		URL:                 "https://www.youtube.com/watch?v=1srQ7Mq_ToI",
		VttFile:             vttFile,
		TargetLanguageFirst: config.Conf.App.TargetLanguageFirst,
	}

	_, err := s.YouTubeSubtitleSrv.processYouTubeSubtitle(context.Background(), req)
	if err != nil {
		t.Errorf("HandleYouTubeSubtitle() error = %v, want nil", err)
	}
}

func TestProcessYouTubeSubtitleSourceOnlySkipsTranslator(t *testing.T) {
	log.InitLogger()
	service := NewYouTubeSubtitleService()
	service.translator = nil
	workdir := t.TempDir()
	vttFile := copyTestVtt(t, workdir, "source-only.en.vtt")
	task := &types.SubtitleTask{}
	req := &YoutubeSubtitleReq{
		TaskBasePath:   workdir,
		TaskId:         "source-only",
		OriginLanguage: "en",
		TargetLanguage: "zh_cn",
		VttFile:        vttFile,
		TaskPtr:        task,
		SourceOnly:     true,
	}

	output, err := service.processYouTubeSubtitle(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(workdir, types.SubtitleTaskOriginLanguageSrtFileName)
	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
	if task.ProcessPct != 100 {
		t.Fatalf("progress = %d, want 100", task.ProcessPct)
	}
	if _, err := os.Stat(filepath.Join(workdir, types.SubtitleTaskTargetLanguageSrtFileName)); !os.IsNotExist(err) {
		t.Fatalf("target subtitle should not be generated, stat error = %v", err)
	}
}

func skipYouTubeSubtitleIntegrationTest(t *testing.T) {
	t.Helper()
	if os.Getenv("KRILLIN_RUN_YOUTUBE_SUBTITLE_INTEGRATION") != "1" {
		t.Skip("set KRILLIN_RUN_YOUTUBE_SUBTITLE_INTEGRATION=1 to run YouTube subtitle integration tests")
	}
}

func copyTestVtt(t *testing.T, dir, name string) string {
	t.Helper()

	data, err := os.ReadFile("test.vtt")
	if err != nil {
		t.Fatalf("read test fixture: %v", err)
	}

	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write test fixture: %v", err)
	}
	return path
}
