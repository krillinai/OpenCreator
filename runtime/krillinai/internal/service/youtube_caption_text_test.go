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

func TestWordCaptionsPreserveDemonstratedHesitation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hesitation.vtt")
	content := "WEBVTT\n\n00:02:04.000 --> 00:02:06.510\nAnd<00:02:04.080><c> the</c><00:02:04.160><c> second</c><00:02:04.440><c> your</c><00:02:04.520><c> explanation</c><00:02:05.120><c> becomes</c>\n\n00:02:06.520 --> 00:02:12.510\nAnd the second your explanation becomes\nuh\n\n00:02:12.520 --> 00:02:14.350\num\n\n00:02:14.360 --> 00:02:15.680\num\nyou<00:02:14.440><c> know</c><00:02:14.560><c> what</c><00:02:14.680><c> you</c><00:02:14.720><c> need</c><00:02:14.880><c> to</c><00:02:14.959><c> work</c><00:02:15.160><c> on.</c>\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	words, err := (&YouTubeSubtitleService{}).ExtractWordsFromVtt(path)
	if err != nil {
		t.Fatal(err)
	}
	var text []string
	for _, word := range words {
		text = append(text, word.Text)
	}
	want := "And the second your explanation becomes uh um you know what you need to work on."
	if strings.Join(text, " ") != want {
		t.Fatalf("有实际含义的演示停顿丢失或重复: %q", strings.Join(text, " "))
	}
}

func TestWordCaptionsPreserveLaterStandaloneWord(t *testing.T) {
	path := filepath.Join(t.TempDir(), "repeated-word.vtt")
	content := `WEBVTT

00:00:59.040 --> 00:01:00.190
which comes from cura, meaning care or
attention.

00:01:00.190 --> 00:01:00.200
attention.

00:01:00.200 --> 00:01:02.230
attention.
Growing<00:01:00.560><c> up,</c>

00:05:46.880 --> 00:05:49.430
Writing<00:05:47.320><c> merely</c><00:05:47.760><c> helps</c><00:05:48.120><c> you</c><00:05:48.320><c> to</c><00:05:48.560><c> pay</c><00:05:48.920><c> closer</c>

00:05:49.440 --> 00:05:50.950
Writing merely helps you to pay closer
attention.

00:05:50.950 --> 00:05:50.960
attention.

00:05:50.960 --> 00:05:53.190
attention.
This<00:05:51.200><c> training</c>
`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	words, err := (&YouTubeSubtitleService{}).ExtractWordsFromVtt(path)
	if err != nil {
		t.Fatal(err)
	}
	var text []string
	var attention []VttWord
	for _, word := range words {
		text = append(text, word.Text)
		if word.Text == "attention." {
			attention = append(attention, word)
		}
	}
	want := "attention. Growing up, Writing merely helps you to pay closer attention. This training"
	if strings.Join(text, " ") != want || len(attention) != 2 || attention[1].Start != "00:05:49.440" || attention[1].End != "00:05:50.950" {
		t.Fatalf("后续真实单词丢失或滚动字幕重复: words=%+v", words)
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
