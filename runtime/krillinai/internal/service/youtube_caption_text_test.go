package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/config"
)

func TestCleanVttTextDecodesSpeakerMarkersBeforeFiltering(t *testing.T) {
	s := &YouTubeSubtitleService{}
	for _, input := range []string{">> Mhm.", "&gt;&gt; Mhm.", "&#62;&#62; Mhm."} {
		if got := s.cleanVttText(input); got != "Mhm." {
			t.Fatalf("cleanVttText(%q) = %q", input, got)
		}
	}
}

func TestProcessYouTubeMusicCaptionsPreservesBriefUtterance(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "captions.vtt")
	content := "WEBVTT\n\n00:00:20.305 --> 00:00:25.535\n[music]\n\n00:04:30.400 --> 00:04:32.520\n&gt;&gt; Mhm.\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	previous := config.Conf.App.MaxSentenceLength
	config.Conf.App.MaxSentenceLength = 50
	t.Cleanup(func() { config.Conf.App.MaxSentenceLength = previous })
	s := &YouTubeSubtitleService{}
	words, err := s.ExtractWordsFromVtt(path)
	if err != nil || len(words) != 1 || words[0].Text != "Mhm." {
		t.Fatalf("words = %v, error = %v", words, err)
	}
	output, err := s.processYouTubeSubtitle(context.Background(), &YoutubeSubtitleReq{VttFile: path, TaskBasePath: dir, SourceOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(output)
	if err != nil || !strings.Contains(string(data), "Mhm.") || strings.Contains(string(data), "music") {
		t.Fatalf("subtitle = %s, error = %v", data, err)
	}
}
