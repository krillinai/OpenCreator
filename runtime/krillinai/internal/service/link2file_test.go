package service

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestYouTubeMediaRefreshesRejectedURLs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell downloader fixture requires POSIX")
	}
	log.InitLogger()
	originalPath, originalPrefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	t.Cleanup(func() { storage.YtdlpPath, storage.YtdlpPrefixArgs = originalPath, originalPrefix })
	for _, test := range []struct {
		name     string
		failures int
		message  string
		attempts int
		audio    bool
	}{
		{"refresh-403", 1, "ERROR: unable to download video data: HTTP Error 403: Forbidden", 2, false},
		{"limit-403", 9, "ERROR: HTTP Error 403: Forbidden", 3, false},
		{"no-bot-retry", 9, "ERROR: Sign in to confirm you are not a bot", 1, false},
		{"hls-audio-fallback", 2, "ERROR: HTTP Error 403: Forbidden", 3, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			counter := filepath.Join(dir, "attempts")
			downloader := filepath.Join(dir, "yt-dlp")
			t.Setenv("YTDLP_MEDIA_COUNTER", counter)
			t.Setenv("YTDLP_MEDIA_ERROR", test.message)
			fixture := fmt.Sprintf("#!/bin/sh\nn=0\nif [ -f \"$YTDLP_MEDIA_COUNTER\" ]; then n=$(cat \"$YTDLP_MEDIA_COUNTER\"); fi\nn=$((n+1))\nprintf '%%s' \"$n\" > \"$YTDLP_MEDIA_COUNTER\"\nif [ \"$n\" -le %d ]; then printf '%%s\\n' \"$YTDLP_MEDIA_ERROR\" >&2; exit 1; fi\nprintf 'audio ready\\n'\nprintf '%%s\\n' \"$@\"\n", test.failures)
			if err := os.WriteFile(downloader, []byte(fixture), 0700); err != nil {
				t.Fatal(err)
			}
			storage.YtdlpPath, storage.YtdlpPrefixArgs = downloader, nil
			args := []string{"https://www.youtube.com/watch?v=demo"}
			if test.audio {
				args = append(args, "--extract-audio", "-f", "bestaudio[ext=m4a]/bestaudio")
			}
			output, err := downloadYouTubeMedia(context.Background(), args)
			if (err == nil) != (test.failures < test.attempts) {
				t.Fatalf("error = %v", err)
			}
			count, readErr := os.ReadFile(counter)
			if readErr != nil || string(count) != fmt.Sprint(test.attempts) {
				t.Fatalf("attempts = %s, error = %v", count, readErr)
			}
			if test.audio && !strings.Contains(string(output), "bestaudio[protocol^=m3u8]/bestaudio[ext=m4a]/bestaudio\n--concurrent-fragments\n4") {
				t.Fatalf("final audio retry did not select HLS: %s", output)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := downloadYouTubeMedia(ctx, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want cancellation", err)
	}
}

func TestCompactCommandOutputPrioritizesFatalDownloadError(t *testing.T) {
	output := "[youtube] Downloading webpage\nWARNING: " + strings.Repeat("runtime warning ", 100) + "\nERROR: unable to download video data: HTTP Error 403: Forbidden\n"
	message := compactCommandOutput([]byte(output))
	if len(message) > 1200 || !strings.HasPrefix(message, "ERROR: unable to download video data: HTTP Error 403: Forbidden") {
		t.Fatalf("fatal download error was lost: %s", message)
	}
}

func TestAdditionalVideoSourcesMatchOpenCreator(t *testing.T) {
	for _, source := range []string{
		"https://www.reddit.com/r/videos/comments/abc123/example/",
		"https://v.redd.it/abc123",
		"https://www.douyin.com/jingxuan?modal_id=123456",
	} {
		if !isAdditionalVideoSource(source) {
			t.Errorf("source was rejected: %s", source)
		}
	}
	if isAdditionalVideoSource("https://www.reddit.com/user/settings") {
		t.Fatal("non-video Reddit URL was accepted")
	}
}

func TestBilibiliDownloadsOnlySelectedPart(testRunner *testing.T) {
	if runtime.GOOS == "windows" {
		testRunner.Skip("shell downloader fixture requires POSIX")
	}
	originalYtdlp, originalPrefix, originalFfmpeg, originalProxy := storage.YtdlpPath, storage.YtdlpPrefixArgs, storage.FfmpegPath, config.Conf.App.Proxy
	testRunner.Cleanup(func() {
		storage.YtdlpPath, storage.YtdlpPrefixArgs, storage.FfmpegPath, config.Conf.App.Proxy = originalYtdlp, originalPrefix, originalFfmpeg, originalProxy
	})
	dir := testRunner.TempDir()
	argsPath := filepath.Join(dir, "arguments")
	downloader := filepath.Join(dir, "yt-dlp")
	testRunner.Setenv("BILIBILI_TEST_ARGS", argsPath)
	if err := os.WriteFile(downloader, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$BILIBILI_TEST_ARGS\"\nprintf '\\n' >> \"$BILIBILI_TEST_ARGS\"\n"), 0700); err != nil {
		testRunner.Fatal(err)
	}
	storage.YtdlpPath, storage.YtdlpPrefixArgs, storage.FfmpegPath, config.Conf.App.Proxy = downloader, nil, "ffmpeg", ""
	for _, test := range []struct {
		compose   string
		skipAudio bool
		commands  int
	}{
		{"none", false, 1},
		{"horizontal", false, 2},
		{"horizontal", true, 1},
	} {
		if err := os.WriteFile(argsPath, nil, 0600); err != nil {
			testRunner.Fatal(err)
		}
		step := &types.SubtitleTaskStepParam{Link: "https://www.bilibili.com/video/BV18E421w7bf/?spm_id_from=share&p=3",
			TaskBasePath: dir, TaskPtr: &types.SubtitleTask{}, EmbedSubtitleVideoType: test.compose, SkipAudio: test.skipAudio}
		if err := (Service{}).linkToFile(context.Background(), step); err != nil {
			testRunner.Fatal(err)
		}
		arguments, err := os.ReadFile(argsPath)
		if err != nil {
			testRunner.Fatal(err)
		}
		wantCommands := test.commands
		if strings.Count(string(arguments), "--no-playlist\n") != wantCommands || strings.Count(string(arguments), "https://www.bilibili.com/video/BV18E421w7bf?p=3\n") != wantCommands {
			testRunner.Fatalf("expected %d single-part downloads with preserved P3, got %s", wantCommands, arguments)
		}
		if step.Link != "https://www.bilibili.com/video/BV18E421w7bf?p=3" {
			testRunner.Fatalf("unexpected normalized link: %s", step.Link)
		}
	}
}

func TestResolveLocalMediaInput(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "source.webm")
	if err := os.WriteFile(path, []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}

	for _, input := range []string{path, "local:" + path} {
		got, ok := resolveLocalMediaInput(input)
		if !ok || got != path {
			t.Fatalf("resolveLocalMediaInput(%q) = %q, %v; want %q, true", input, got, ok, path)
		}
	}

	if got, ok := resolveLocalMediaInput(filepath.Join(dir, "missing.mp4")); ok || got != "" {
		t.Fatalf("missing input = %q, %v; want empty, false", got, ok)
	}
}

func TestBilibiliMediaRetriesOnlyExtractionRejections(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell downloader fixture requires POSIX")
	}
	originalPath, originalPrefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	t.Cleanup(func() { storage.YtdlpPath, storage.YtdlpPrefixArgs = originalPath, originalPrefix })
	for _, test := range []struct {
		name, message      string
		failures, attempts int
		wantError          bool
	}{
		{"refresh-risk-control", "ERROR: Bilibili risk control rejected the media request", 1, 2, false},
		{"refresh-legacy-no-formats", "ERROR: No video formats found!", 1, 2, false},
		{"limit-risk-control", "ERROR: Bilibili risk control rejected the media request", 9, 3, true},
		{"no-format-selector-retry", "ERROR: Requested format is not available", 9, 1, true},
		{"no-retry-after-successful-fallback", "WARNING: Bilibili risk control rejected the playback API request; retaining webpage media formats when available\nERROR: Requested format is not available", 9, 1, true},
		{"no-login-retry", "ERROR: Login required", 9, 1, true},
		{"no-storage-retry", "ERROR: No space left on device", 9, 1, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			counter := filepath.Join(dir, "attempts")
			downloader := filepath.Join(dir, "yt-dlp")
			t.Setenv("BILIBILI_MEDIA_COUNTER", counter)
			t.Setenv("BILIBILI_MEDIA_ERROR", test.message)
			fixture := fmt.Sprintf("#!/bin/sh\nn=0\nif [ -f \"$BILIBILI_MEDIA_COUNTER\" ]; then n=$(cat \"$BILIBILI_MEDIA_COUNTER\"); fi\nn=$((n+1))\nprintf '%%s' \"$n\" > \"$BILIBILI_MEDIA_COUNTER\"\nif [ \"$n\" -le %d ]; then printf '%%s\\n' \"$BILIBILI_MEDIA_ERROR\" >&2; exit 1; fi\nprintf 'media ready\\n'\n", test.failures)
			if err := os.WriteFile(downloader, []byte(fixture), 0700); err != nil {
				t.Fatal(err)
			}
			storage.YtdlpPath, storage.YtdlpPrefixArgs = downloader, nil
			output, err := downloadBilibiliMedia(context.Background(), []string{"https://www.bilibili.com/video/BV18Qhf6hE8P?p=3"})
			if (err != nil) != test.wantError {
				t.Fatalf("error = %v, output = %s", err, output)
			}
			count, readErr := os.ReadFile(counter)
			if readErr != nil || string(count) != fmt.Sprint(test.attempts) {
				t.Fatalf("attempts = %s, error = %v", count, readErr)
			}
			if test.name == "limit-risk-control" && !strings.Contains(err.Error(), "Bilibili risk control blocked media extraction after 3 attempts") {
				t.Fatalf("risk-control cause was lost: %v", err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := downloadBilibiliMedia(ctx, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want cancellation", err)
	}
}

func TestBilibiliMediaCancellationStopsRetryWait(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell downloader fixture requires POSIX")
	}
	originalPath, originalPrefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	t.Cleanup(func() { storage.YtdlpPath, storage.YtdlpPrefixArgs = originalPath, originalPrefix })
	dir := t.TempDir()
	downloader := filepath.Join(dir, "yt-dlp")
	if err := os.WriteFile(downloader, []byte("#!/bin/sh\nprintf 'ERROR: Bilibili risk control rejected the media request\\n' >&2\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	storage.YtdlpPath, storage.YtdlpPrefixArgs = downloader, nil
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := downloadBilibiliMedia(ctx, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want deadline exceeded", err)
	}
}

func TestAdditionalPlatformMediaDownloads(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell downloader fixture requires POSIX")
	}
	originalYtdlp, originalPrefix, originalFfmpeg, originalProxy := storage.YtdlpPath, storage.YtdlpPrefixArgs, storage.FfmpegPath, config.Conf.App.Proxy
	t.Cleanup(func() {
		storage.YtdlpPath, storage.YtdlpPrefixArgs, storage.FfmpegPath, config.Conf.App.Proxy = originalYtdlp, originalPrefix, originalFfmpeg, originalProxy
	})
	dir := t.TempDir()
	argsPath := filepath.Join(dir, "arguments")
	downloader := filepath.Join(dir, "yt-dlp")
	t.Setenv("VIDEO_SOURCE_TEST_ARGS", argsPath)
	if err := os.WriteFile(downloader, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$VIDEO_SOURCE_TEST_ARGS\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	storage.YtdlpPath, storage.YtdlpPrefixArgs, storage.FfmpegPath, config.Conf.App.Proxy = downloader, nil, "/custom/ffmpeg", "http://127.0.0.1:7897"
	for _, link := range []string{
		"https://x.com/creator/status/123",
		"https://www.tiktok.com/@creator/video/123",
		"https://vm.tiktok.com/abc123/",
		"https://www.instagram.com/reel/abc123/",
		"https://www.douyin.com/video/123",
		"https://v.douyin.com/abc123/",
		"https://www.facebook.com/watch/?v=123",
		"https://fb.watch/abc123/",
		"https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D",
		"https://www.pinterest.com/pin/123/",
	} {
		t.Run(link, func(t *testing.T) {
			for _, mode := range []struct {
				compose   string
				skipAudio bool
				commands  int
			}{{"none", false, 1}, {"horizontal", false, 2}, {"horizontal", true, 1}} {
				if err := os.WriteFile(argsPath, nil, 0600); err != nil {
					t.Fatal(err)
				}
				step := &types.SubtitleTaskStepParam{Link: link, TaskBasePath: dir, TaskPtr: &types.SubtitleTask{},
					EmbedSubtitleVideoType: mode.compose, SkipAudio: mode.skipAudio}
				if err := (Service{}).linkToFile(context.Background(), step); err != nil {
					t.Fatal(err)
				}
				arguments, err := os.ReadFile(argsPath)
				if err != nil {
					t.Fatal(err)
				}
				args := string(arguments)
				if strings.Count(args, "--no-playlist\n") != mode.commands || strings.Count(args, link+"\n") != mode.commands {
					t.Fatalf("expected %d single-video downloads with source parameters, got %s", mode.commands, args)
				}
				if !strings.Contains(args, "--proxy\nhttp://127.0.0.1:7897\n") || !strings.Contains(args, "--ffmpeg-location\n/custom/ffmpeg\n") {
					t.Fatalf("missing proxy or ffmpeg arguments: %s", args)
				}
				if !mode.skipAudio && (!strings.Contains(args, "bestaudio/best\n") || step.AudioFilePath == "") {
					t.Fatalf("missing audio extraction: %s", args)
				}
				if mode.compose != "none" && !strings.Contains(args, "--recode-video\nmp4\n") {
					t.Fatalf("missing video conversion: %s", args)
				}
			}
		})
	}
}

func TestAdditionalPlatformRejectsUnsupportedSources(t *testing.T) {
	for _, link := range []string{"https://www.instagram.com/creator/", "https://www.pinterest.com/creator/",
		"https://notpinterest.com/pin/123/", "https://instagram.com.example.com/reel/abc/", "http://www.instagram.com/reel/abc/"} {
		if isAdditionalVideoSource(link) {
			t.Fatalf("accepted unsupported source: %s", link)
		}
	}
}
