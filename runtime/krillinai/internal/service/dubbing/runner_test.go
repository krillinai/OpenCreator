package dubbing

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeRunnerWritingOutputs(dir string) CommandRunner {
	return func(args []string) error {
		out := args[len(args)-1]
		if strings.HasSuffix(out, ".wav") || strings.HasSuffix(out, ".mp4") {
			return os.WriteFile(out, []byte("media"), 0644)
		}
		return nil
	}
}

func fakeRunnerWritingOutputsWithoutMkdir() CommandRunner {
	return func(args []string) error {
		out := args[len(args)-1]
		if strings.HasSuffix(out, ".wav") || strings.HasSuffix(out, ".mp4") {
			return os.WriteFile(out, []byte("media"), 0644)
		}
		return nil
	}
}

func TestAudioOnlyRunnerDoesNotRequireOrMuxVideo(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := NewRunner(Dependencies{
		TTS: &fakeTTS{writeOnReturn: true}, Language: "zh_cn", Voice: "voice", Workdir: root, InputSRT: input, AudioOnly: true,
		OutputAudio: filepath.Join(root, "output.wav"), Config: DefaultConfig(),
		FFmpeg: func(args []string) error {
			if strings.HasSuffix(args[len(args)-1], ".mp4") {
				t.Fatal("audio-only runner attempted video muxing")
			}
			return fakeRunnerWritingOutputs(root)(args)
		},
		Duration: func(string) (float64, error) { return 0.8, nil },
	}).Run(context.Background())
	if err != nil || result.Audio == "" || result.Video != "" {
		t.Fatalf("result = %+v, error = %v", result, err)
	}
}

func TestRunWritesDubbingArtifactsWithFakeTTS(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	video := filepath.Join(dir, "origin.mp4")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(video, []byte("video"), 0644); err != nil {
		t.Fatal(err)
	}
	var phases []string
	deps := Dependencies{
		ReportPhase: func(phase string) { phases = append(phases, phase) },
		TTS:         &fakeTTS{writeOnReturn: true},
		Language:    "zh_cn",
		Voice:       "voice",
		Workdir:     dir,
		InputSRT:    input,
		InputVideo:  video,
		OutputAudio: filepath.Join(dir, "tts_final_audio.wav"),
		OutputVideo: filepath.Join(dir, "video_with_tts.mp4"),
		Config:      DefaultConfig(),
		FFmpeg:      fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) {
			return 0.8, nil
		},
	}
	result, err := NewRunner(deps).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if strings.Join(phases, ",") != "planning_voice,generating_voice,fitting_voice,assembling_voice,muxing_voice" {
		t.Fatalf("missing dubbing phase details: %v", phases)
	}
	for _, path := range []string{
		filepath.Join(dir, DubbingDirName, DubbingInputFileName),
		filepath.Join(dir, DubbingDirName, DubbingPlanFileName),
		filepath.Join(dir, DubbingDirName, DubbingReportName),
		filepath.Join(dir, DubbingDirName, DubSubtitleFileName),
		result.Audio,
		result.Video,
	} {
		if info, err := os.Stat(path); err != nil || info.Size() == 0 {
			t.Fatalf("missing output %s: info=%v err=%v", path, info, err)
		}
	}
}

func TestRunWritesCleanedDubbingInput(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	video := filepath.Join(dir, "origin.mp4")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n(music) 你好 ™\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(video, []byte("video"), 0644); err != nil {
		t.Fatal(err)
	}
	deps := Dependencies{
		TTS:         &fakeTTS{writeOnReturn: true},
		Language:    "zh_cn",
		Voice:       "voice",
		Workdir:     dir,
		InputSRT:    input,
		InputVideo:  video,
		OutputAudio: filepath.Join(dir, "tts_final_audio.wav"),
		OutputVideo: filepath.Join(dir, "video_with_tts.mp4"),
		Config:      DefaultConfig(),
		FFmpeg:      fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) {
			return 0.8, nil
		},
	}
	if _, err := NewRunner(deps).Run(context.Background()); err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, DubbingDirName, DubbingInputFileName))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, "music") || strings.Contains(text, "™") {
		t.Fatalf("dubbing input contains unclean text: %q", text)
	}
	if !strings.Contains(text, "你好") {
		t.Fatalf("dubbing input missing speech text: %q", text)
	}
}

func TestRunRejectsEmptySRTBeforeWritingArtifacts(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	video := filepath.Join(dir, "origin.mp4")
	if err := os.WriteFile(input, []byte(""), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(video, []byte("video"), 0644); err != nil {
		t.Fatal(err)
	}
	deps := Dependencies{
		TTS:         &fakeTTS{writeOnReturn: true},
		Language:    "zh_cn",
		Voice:       "voice",
		Workdir:     dir,
		InputSRT:    input,
		InputVideo:  video,
		OutputAudio: filepath.Join(dir, "tts_final_audio.wav"),
		OutputVideo: filepath.Join(dir, "video_with_tts.mp4"),
		Config:      DefaultConfig(),
		FFmpeg:      fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) {
			return 0.8, nil
		},
	}

	_, err := NewRunner(deps).Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "input srt has no cues") {
		t.Fatalf("Run() error = %v, want no cues error", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, DubbingDirName, DubbingInputFileName)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("dubbing input stat error = %v, want not exist", statErr)
	}
}

func TestRunCreatesCustomOutputParentDirs(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	video := filepath.Join(dir, "origin.mp4")
	outputAudio := filepath.Join(dir, "nested", "audio", "tts_final_audio.wav")
	outputVideo := filepath.Join(dir, "nested", "video", "video_with_tts.mp4")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(video, []byte("video"), 0644); err != nil {
		t.Fatal(err)
	}
	deps := Dependencies{
		TTS:         &fakeTTS{writeOnReturn: true},
		Language:    "zh_cn",
		Voice:       "voice",
		Workdir:     dir,
		InputSRT:    input,
		InputVideo:  video,
		OutputAudio: outputAudio,
		OutputVideo: outputVideo,
		Config:      DefaultConfig(),
		FFmpeg:      fakeRunnerWritingOutputsWithoutMkdir(),
		Duration: func(string) (float64, error) {
			return 0.8, nil
		},
	}

	result, err := NewRunner(deps).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	for _, path := range []string{result.Audio, result.Video} {
		if info, err := os.Stat(path); err != nil || info.Size() == 0 {
			t.Fatalf("missing output %s: info=%v err=%v", path, info, err)
		}
	}
}

func TestRunFailsWhenMuxDoesNotCreateOutput(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	video := filepath.Join(dir, "origin.mp4")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(video, []byte("video"), 0644); err != nil {
		t.Fatal(err)
	}
	deps := Dependencies{
		TTS:         &fakeTTS{writeOnReturn: true},
		Language:    "zh_cn",
		Voice:       "voice",
		Workdir:     dir,
		InputSRT:    input,
		InputVideo:  video,
		OutputAudio: filepath.Join(dir, "tts_final_audio.wav"),
		OutputVideo: filepath.Join(dir, "video_with_tts.mp4"),
		Config:      DefaultConfig(),
		FFmpeg: func(args []string) error {
			out := args[len(args)-1]
			if strings.HasSuffix(out, ".wav") {
				return os.WriteFile(out, []byte("media"), 0644)
			}
			return nil
		},
		Duration: func(string) (float64, error) {
			return 0.8, nil
		},
	}
	_, err := NewRunner(deps).Run(context.Background())
	if err == nil {
		t.Fatalf("Run() error = nil, want missing mux output error")
	}
}

func TestRunnerRequiresInputVideoForMux(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	deps := Dependencies{
		TTS:         &fakeTTS{writeOnReturn: true},
		Language:    "zh_cn",
		Voice:       "voice",
		Workdir:     dir,
		InputSRT:    input,
		OutputAudio: filepath.Join(dir, "tts_final_audio.wav"),
		OutputVideo: filepath.Join(dir, "video_with_tts.mp4"),
		Config:      DefaultConfig(),
		FFmpeg:      fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) {
			return 0.8, nil
		},
	}
	_, err := NewRunner(deps).Run(context.Background())
	if err == nil {
		t.Fatalf("Run() error = nil, want missing input video error")
	}
}

func TestRunnerRewritesOnlyMeasuredOverflowAndKeepsSubtitleWindow(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "target.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n一\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{response: "二"}
	measurements := 0
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", Voice: "voice", Workdir: dir, InputSRT: input, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(path string) (float64, error) {
			if strings.HasSuffix(path, string(filepath.Separator)+"1.wav") {
				measurements++
				if measurements == 1 {
					return 1.8, nil
				}
			}
			return 0.8, nil
		},
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(tts.texts) != 2 || tts.texts[0] != "一" || tts.texts[1] != "二" {
		t.Fatalf("TTS texts = %+v, want one retry with rewritten text", tts.texts)
	}
	if len(result.Plan) != 1 || result.Plan[0].RewriteAttempts != 1 || result.Plan[0].SpeedFactor != 1 {
		t.Fatalf("plan = %+v, want one rewrite and natural speed", result.Plan)
	}
	data, err := os.ReadFile(input)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if !strings.Contains(content, "00:00:00,000 --> 00:00:01,000") || !strings.Contains(content, "二") || strings.Contains(content, "一") {
		t.Fatalf("final target SRT = %q, want original window and rewritten text", content)
	}
}

func TestRunnerRewritesMeasuredOverflowUsingSourceContextKeepsSourceOriginal(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.srt")
	source := filepath.Join(dir, "source.srt")
	if err := os.WriteFile(target, []byte("1\n00:00:00,000 --> 00:00:01,000\n目标原文\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("1\n00:00:00,000 --> 00:00:01,000\nsource original\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{response: `{"target_text":"压缩"}`}
	measurements := 0
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", SourceSRT: source, Voice: "voice", Workdir: dir,
		InputSRT: target, AudioOnly: true, OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(),
		FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(path string) (float64, error) {
			if strings.HasSuffix(path, string(filepath.Separator)+"1.wav") {
				measurements++
				if measurements == 1 {
					return 1.8, nil
				}
			}
			return 0.8, nil
		},
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(tts.texts) != 2 || tts.texts[0] != "目标原文" || tts.texts[1] != "压缩" {
		t.Fatalf("TTS texts = %+v, want paired rewrite retry", tts.texts)
	}
	if len(result.Plan) != 1 || result.Plan[0].SourceText != "source original" || result.Plan[0].SpokenText != "压缩" {
		t.Fatalf("plan = %+v, want original source and rewritten target", result.Plan)
	}
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "1\n00:00:00,000 --> 00:00:01,000\nsource original\n\n" {
		t.Fatalf("source SRT was modified: %q", data)
	}
	if !strings.Contains(chat.query, "source original") || !strings.Contains(chat.query, "目标原文") {
		t.Fatalf("source-aware prompt did not include both texts: %q", chat.query)
	}
}

func TestRunnerRewritesAnyOverflowBeforeAcceptingTenPercentTolerance(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "target.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n一\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{response: "二"}
	measurements := 0
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", Voice: "voice", Workdir: dir, InputSRT: input, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(path string) (float64, error) {
			if strings.HasSuffix(path, string(filepath.Separator)+"1.wav") {
				measurements++
				if measurements == 1 {
					// Any measured overrun above 1.0 must enter the LLM path,
					// even when it is far below the final 10% acceptance bound.
					return 1.0001, nil
				}
			}
			return 1.05, nil
		},
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(tts.texts) != 2 || tts.texts[0] != "一" || tts.texts[1] != "二" {
		t.Fatalf("TTS texts = %+v, want initial generation and one rewrite", tts.texts)
	}
	if len(result.Plan) != 1 || result.Plan[0].RewriteAttempts != 1 {
		t.Fatalf("plan = %+v, want one mandatory rewrite", result.Plan)
	}
	if result.Plan[0].SpeedFactor <= 1 || result.Plan[0].SpeedFactor > 1.10 {
		t.Fatalf("speed = %.4f, want accepted speed within ten percent", result.Plan[0].SpeedFactor)
	}
}

func TestRunnerAllowsThreeRewriteAttemptsBeforeTenPercentFallback(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "target.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n一\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{responses: []string{"二", "三", "四"}}
	measurements := 0
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", Voice: "voice", Workdir: dir, InputSRT: input, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(path string) (float64, error) {
			if strings.HasSuffix(path, string(filepath.Separator)+"1.wav") {
				measurements++
				switch measurements {
				case 1:
					return 1.50, nil
				case 2:
					return 1.30, nil
				case 3:
					return 1.20, nil
				}
			}
			return 1.08, nil
		},
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(tts.texts) != 4 || result.Plan[0].RewriteAttempts != 3 || chat.calls != 3 {
		t.Fatalf("TTS calls=%d plan=%+v, want three rewrites", len(tts.texts), result.Plan)
	}
	if result.Plan[0].SpeedFactor <= 1 || result.Plan[0].SpeedFactor > 1.10 {
		t.Fatalf("speed = %.4f, want accepted speed within ten percent", result.Plan[0].SpeedFactor)
	}
}

func TestRunnerFailsWhenMeasuredOverflowCannotBeRewritten(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "target.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n一\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{response: "二"}
	_, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", Voice: "voice", Workdir: dir, InputSRT: input, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) { return 1.8, nil },
	}).Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "subtitle 1") || !strings.Contains(err.Error(), "rewrite attempts") {
		t.Fatalf("Run() error = %v, want measured overflow error", err)
	}
	if len(tts.texts) != 2 || chat.calls != 3 {
		t.Fatalf("TTS calls = %d, chat calls = %d, want three rewrite attempts", len(tts.texts), chat.calls)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "output.wav")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("output stat error = %v, want no assembled output after overflow", statErr)
	}
}
