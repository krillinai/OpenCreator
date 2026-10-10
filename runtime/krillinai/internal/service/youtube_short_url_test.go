package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/internal/storage"
	"krillin-ai/log"
)

func TestDownloadYouTubeSubtitleAcceptsShortURL(t *testing.T) {
	log.InitLogger()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	previousPath, previousPrefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	storage.YtdlpPath = executable
	storage.YtdlpPrefixArgs = []string{"-test.run=^TestYouTubeShortURLHelper$", "--"}
	t.Cleanup(func() { storage.YtdlpPath, storage.YtdlpPrefixArgs = previousPath, previousPrefix })
	dir := t.TempDir()
	callPath := filepath.Join(dir, "calls.jsonl")
	t.Setenv("KRILLIN_TEST_YOUTUBE_CALLS", callPath)
	req := &YoutubeSubtitleReq{
		URL: "https://youtu.be/1_iv-S02hJ0?si=example", OriginLanguage: "auto", TaskBasePath: dir,
	}
	path, err := (&YouTubeSubtitleService{}).downloadYouTubeSubtitle(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if req.OriginLanguage != "en" || filepath.Base(path) != "1_iv-S02hJ0.en-orig.vtt" {
		t.Fatalf("language = %s, caption = %s", req.OriginLanguage, path)
	}
	calls, err := os.ReadFile(callPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(calls)), "\n")
	if len(lines) != 2 || !strings.Contains(lines[0], "--dump-single-json") || !strings.Contains(lines[1], "--write-auto-subs") {
		t.Fatalf("expected metadata and caption download calls, got %s", calls)
	}
	for _, line := range lines {
		if !strings.Contains(line, req.URL) {
			t.Fatalf("short URL was lost: %s", line)
		}
	}
}

func TestYouTubeShortURLHelper(t *testing.T) {
	callPath := os.Getenv("KRILLIN_TEST_YOUTUBE_CALLS")
	if callPath == "" {
		return
	}
	args := os.Args
	for i, arg := range args {
		if arg == "--" {
			args = args[i+1:]
			break
		}
	}
	file, err := os.OpenFile(callPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(file).Encode(args); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	for _, arg := range args {
		if arg == "--dump-single-json" {
			fmt.Print(`{"language":"en","automatic_captions":{"en-orig":[{"url":"https://example.test/caption?lang=en","name":"English (Original)"}]}}`)
			os.Exit(0)
		}
	}
	for i, arg := range args {
		if arg == "-o" && i+1 < len(args) {
			path := strings.ReplaceAll(args[i+1], "%(ext)s", "en-orig.vtt")
			if err := os.WriteFile(path, []byte("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n"), 0600); err != nil {
				t.Fatal(err)
			}
			os.Exit(0)
		}
	}
	t.Fatal("missing output path")
}
