package service

import (
	"context"
	"fmt"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestMediaDownloadProgressStreamsBeforeProcessCompletes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX command fixture")
	}
	previous, prefix := storage.YtdlpPath, storage.YtdlpPrefixArgs
	t.Cleanup(func() { storage.YtdlpPath, storage.YtdlpPrefixArgs = previous, prefix })
	dir := t.TempDir()
	release := filepath.Join(dir, "release")
	t.Setenv("PROGRESS_TEST_RELEASE", release)
	fixture := filepath.Join(dir, "downloader")
	script := `#!/bin/sh
printf '%s\n' 'OC_DOWNLOAD:{"downloaded_bytes":1048576,"total_bytes":2097152,"speed":1048576,"eta":1,"status":"downloading"}'
while [ ! -f "$PROGRESS_TEST_RELEASE" ]; do sleep 0.02; done
printf '%s\n' 'OC_DOWNLOAD:{"downloaded_bytes":2097152,"total_bytes":2097152,"status":"finished"}'
`
	if err := os.WriteFile(fixture, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	storage.YtdlpPath, storage.YtdlpPrefixArgs = fixture, nil
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var events []types.TaskProgress
	task := &types.SubtitleTask{}
	task.SetDetailedProgressReporter(func(p types.TaskProgress) { events = append(events, p) })
	report := downloadProgressReporter(task, false, 0, 90)
	_, err := runMediaDownload(ctx, nil, func(p mediaDownloadProgress) {
		report(p)
		if err := os.WriteFile(release, nil, 0600); err != nil {
			t.Error(err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[1].Percent != 45 || !strings.Contains(events[1].Message, "1.0 MiB / 2.0 MiB；1.0 MiB/s；预计剩余 1 秒") || events[2].Percent != 90 {
		t.Fatalf("missing streamed download details: %+v", events)
	}
}

func TestMediaDownloadUnknownTotalDoesNotInventPercent(t *testing.T) {
	var events []types.TaskProgress
	task := &types.SubtitleTask{}
	task.SetDetailedProgressReporter(func(p types.TaskProgress) { events = append(events, p) })
	report := downloadProgressReporter(task, true, 5, 90)
	report(mediaDownloadProgress{Downloaded: 1048576})
	if len(events) != 2 || events[1].Percent != 5 || !strings.Contains(events[1].Message, "1.0 MiB") {
		t.Fatalf("unknown total made up progress: %+v", events)
	}
}

func TestFFmpegProgressRendersLocalVideo(t *testing.T) {
	// Use installed media tools, without network, ASR or model requests.
	ffmpeg, probe := os.Getenv("KRILLIN_TEST_FFMPEG"), os.Getenv("KRILLIN_TEST_FFPROBE")
	if ffmpeg == "" || probe == "" {
		t.Skip("set KRILLIN_TEST_FFMPEG and KRILLIN_TEST_FFPROBE to run the local render check")
	}
	previousFFmpeg, previousProbe := storage.FfmpegPath, storage.FfprobePath
	storage.FfmpegPath, storage.FfprobePath = ffmpeg, probe
	t.Cleanup(func() { storage.FfmpegPath, storage.FfprobePath = previousFFmpeg, previousProbe })
	dir := t.TempDir()
	input, subtitle, output := filepath.Join(dir, "input.mp4"), filepath.Join(dir, "input.srt"), filepath.Join(dir, "output.mp4")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if data, err := exec.CommandContext(ctx, ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=2:r=10", "-c:v", "libx264", input).CombinedOutput(); err != nil {
		t.Fatalf("create local fixture: %v: %s", err, data)
	}
	if err := os.WriteFile(subtitle, []byte("1\n00:00:00,000 --> 00:00:02,000\nLocal progress check\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var events []types.TaskProgress
	task := &types.SubtitleTask{}
	task.SetDetailedProgressReporter(func(p types.TaskProgress) { events = append(events, p) })
	_, err := renderSubtitleFile(ctx, RenderVideoRequest{Workdir: dir, InputVideo: input, SubtitleFile: subtitle, OutputFile: output, Horizontal: true, StepParam: &types.SubtitleTaskStepParam{TaskPtr: task}})
	if err != nil {
		t.Fatal(err)
	}
	actualTime := false
	for _, p := range events {
		if p.Percent >= 100 {
			t.Fatalf("render claimed completion before output collection: %+v", p)
		}
		if p.Phase == "rendering_video" && strings.Contains(p.Message, "已处理") && p.Percent > 35 {
			actualTime = true
		}
	}
	if info, err := os.Stat(output); err != nil || info.Size() == 0 || !actualTime {
		t.Fatal(fmt.Sprintf("render missing output or actual time: err=%v, events=%+v", err, events))
	}
}
