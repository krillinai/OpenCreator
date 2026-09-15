package main

import (
	"bytes"
	"encoding/json"
	"krillin-ai/internal/cli"
	"krillin-ai/internal/pipeline"
	"strings"
	"testing"
)

func TestRequiresTranscriptionAtStart(t *testing.T) {
	tests := []struct {
		name string
		cmd  cli.Command
		want bool
	}{
		{
			name: "imported captions do not require ASR even when platform captions are disabled",
			cmd: cli.Command{Name: "subtitle", Subtitle: pipeline.SubtitleRequest{
				Input: "video.mp4", InputSRT: "local.srt", CaptionSource: pipeline.CaptionSourceWhisper,
			}},
			want: false,
		},
		{
			name: "youtube platform captions can start without ASR",
			cmd: cli.Command{Name: "subtitle", Subtitle: pipeline.SubtitleRequest{
				Input: "https://www.youtube.com/watch?v=demo", CaptionSource: pipeline.CaptionSourceAny,
			}},
			want: false,
		},
		{
			name: "short youtube URLs can start without ASR",
			cmd: cli.Command{Name: "subtitle", Subtitle: pipeline.SubtitleRequest{
				Input: "https://youtu.be/demo", CaptionSource: pipeline.CaptionSourcePlatform,
			}},
			want: false,
		},
		{
			name: "forced speech recognition requires ASR",
			cmd: cli.Command{Name: "subtitle", Subtitle: pipeline.SubtitleRequest{
				Input: "https://www.youtube.com/watch?v=demo", CaptionSource: pipeline.CaptionSourceWhisper,
			}},
			want: true,
		},
		{
			name: "local media requires ASR",
			cmd: cli.Command{Name: "subtitle", Subtitle: pipeline.SubtitleRequest{
				Input: "video.mp4", CaptionSource: pipeline.CaptionSourceAny,
			}},
			want: true,
		},
		{
			name: "render does not require ASR",
			cmd:  cli.Command{Name: "render-horizontal"},
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := requiresTranscriptionAtStart(test.cmd); got != test.want {
				t.Fatalf("requiresTranscriptionAtStart() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestConfigureOpenCreatorProgressWritesJSONLines(t *testing.T) {
	t.Setenv("OPENCREATOR_KRILLINAI_CLI", "1")
	var buffer bytes.Buffer
	output := &jsonLineWriter{output: &buffer}
	cmd := cli.Command{Name: "subtitle"}

	configureOpenCreatorProgress(&cmd, output)
	if cmd.Subtitle.ReportProgress == nil {
		t.Fatal("ReportProgress is nil")
	}
	cmd.Subtitle.ReportProgress("transcribing_audio", 42, "working")

	line := strings.TrimSpace(buffer.String())
	var frame progressFrame
	if err := json.Unmarshal([]byte(line), &frame); err != nil {
		t.Fatalf("invalid progress JSON %q: %v", line, err)
	}
	if frame.Type != "progress" || frame.Phase != "transcribing_audio" || frame.Percent != 42 || frame.Message != "working" {
		t.Fatalf("unexpected progress frame: %+v", frame)
	}
}

func TestConfigureOpenCreatorTTSProgressWritesJSONLines(t *testing.T) {
	t.Setenv("OPENCREATOR_KRILLINAI_CLI", "1")
	var buffer bytes.Buffer
	output := &jsonLineWriter{output: &buffer}
	cmd := cli.Command{Name: "tts"}

	configureOpenCreatorProgress(&cmd, output)
	if cmd.TTS.ReportProgress == nil {
		t.Fatal("TTS ReportProgress is nil")
	}
	cmd.TTS.ReportProgress("generating_voice", 64, "working")

	line := strings.TrimSpace(buffer.String())
	var frame progressFrame
	if err := json.Unmarshal([]byte(line), &frame); err != nil {
		t.Fatalf("invalid progress JSON %q: %v", line, err)
	}
	if frame.Type != "progress" || frame.Phase != "generating_voice" || frame.Percent != 64 || frame.Message != "working" {
		t.Fatalf("unexpected progress frame: %+v", frame)
	}
}

func TestConfigureOpenCreatorProgressStaysDisabledByDefault(t *testing.T) {
	t.Setenv("OPENCREATOR_KRILLINAI_CLI", "")
	cmd := cli.Command{Name: "subtitle"}
	configureOpenCreatorProgress(&cmd, &jsonLineWriter{output: &bytes.Buffer{}})
	if cmd.Subtitle.ReportProgress != nil {
		t.Fatal("ReportProgress should remain nil")
	}
}
