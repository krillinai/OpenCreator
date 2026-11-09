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
	if !strings.Contains(chat.query, "source original") || !strings.Contains(chat.query, "目标原文") || !strings.Contains(chat.query, "简体中文（zh_cn）") {
		t.Fatalf("source-aware prompt omitted source, target, or target language: %q", chat.query)
	}
}

func TestRunnerKeepsOriginalTranslationAndNeighborsAcrossRewriteAttempts(t *testing.T) {
	chat := &fakeChat{responses: []string{`{"target_text":"较短候选"}`, `{"target_text":"短候选"}`}}
	runner := NewRunner(Dependencies{
		TTS: &fakeTTS{writeOnReturn: true}, Language: "zh_cn", Voice: "voice", Config: DefaultConfig(),
		Duration: func(string) (float64, error) {
			if chat.calls == 1 {
				return 1.4, nil
			}
			return 0.8, nil
		},
	})
	plan := []PlanItem{
		{Index: 1, OriginalStart: 0, OriginalEnd: 1, OriginalText: "前一条原译文", SourceText: "previous source", SpokenText: "前一条原译文", ActualDuration: 0.8},
		{Index: 2, OriginalStart: 1, OriginalEnd: 2, OriginalText: "最初目标语言文案", SourceText: "current source", SpokenText: "最初目标语言文案", ActualDuration: 1.8},
		{Index: 3, OriginalStart: 2, OriginalEnd: 3, OriginalText: "后一条原译文", SourceText: "next source", SpokenText: "后一条原译文", ActualDuration: 0.8},
	}
	got, err := runner.rewriteOverlongSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), t.TempDir())
	if err != nil || chat.calls != 2 || got[1].SpokenText != "短候选" {
		t.Fatalf("rewrite result = %+v, calls = %d, error = %v", got, chat.calls, err)
	}
	for _, text := range []string{"最初目标语言文案", "较短候选", "previous source", "前一条原译文", "next source", "后一条原译文"} {
		if !strings.Contains(chat.query, text) {
			t.Fatalf("second rewrite lost %q: %s", text, chat.query)
		}
	}
}

func TestRunnerKeepsAlreadyFittingCompleteSentencesSeparate(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.srt")
	source := filepath.Join(dir, "source.srt")
	if err := os.WriteFile(target, []byte("23\n00:00:49,928 --> 00:00:51,654\n这叫帕金森定律。\n\n24\n00:00:51,654 --> 00:00:54,130\n工作会把你给它的时间填满。\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("23\n00:00:49,928 --> 00:00:51,654\nThis is called Parkinson's Law.\n\n24\n00:00:51,654 --> 00:00:54,130\nWork expands to fill the time you give it.\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	chat := &fakeChat{response: `{"merge":true}`}
	result, err := NewRunner(Dependencies{
		TTS: &fakeTTS{writeOnReturn: true}, Chat: chat, Language: "zh_cn", SourceSRT: source,
		Voice: "voice", Workdir: dir, InputSRT: target, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(path string) (float64, error) {
			if strings.HasSuffix(path, string(filepath.Separator)+"23.wav") {
				return 1.222, nil
			}
			return 2.139, nil
		},
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(result.Plan) != 2 || result.Report.SemanticMergeCount != 0 || chat.calls != 0 {
		t.Fatalf("plan = %+v, report = %+v, chat calls = %d; want separate fitted sentences", result.Plan, result.Report, chat.calls)
	}
	if result.Plan[0].DurationRatio >= 1 || result.Plan[1].DurationRatio >= 1 {
		t.Fatalf("ratios = %.3f, %.3f, want both to fit", result.Plan[0].DurationRatio, result.Plan[1].DurationRatio)
	}
}

func TestRunnerMergesOnlyMeasuredStubbornContinuation(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.srt")
	source := filepath.Join(dir, "source.srt")
	if err := os.WriteFile(target, []byte("1\n00:00:00,000 --> 00:00:01,000\n因为我们已经准备好了\n\n2\n00:00:01,000 --> 00:00:02,000\n所以现在可以开始。\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("1\n00:00:00,000 --> 00:00:01,000\nBecause we are ready\n\n2\n00:00:01,000 --> 00:00:02,000\nwe can begin.\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	chat := &fakeChat{responses: []string{`{"target_text":"因为已准备好"}`, "invalid", "invalid", `{"merge":true}`}}
	tts := &fakeTTS{writeOnReturn: true}
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", SourceSRT: source,
		Voice: "voice", Workdir: dir, InputSRT: target, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(path string) (float64, error) {
			if strings.Contains(path, string(filepath.Separator)+"merge_candidates"+string(filepath.Separator)) {
				return 1.85, nil
			}
			if strings.HasSuffix(path, string(filepath.Separator)+"1.wav") {
				return 1.40, nil
			}
			return 0.50, nil
		},
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(result.Plan) != 1 || result.Report.SemanticMergeCount != 1 || chat.calls != 4 {
		t.Fatalf("plan = %+v, report = %+v, chat calls = %d; want late merge", result.Plan, result.Report, chat.calls)
	}
	item := result.Plan[0]
	if item.SpokenText != "因为已准备好 所以现在可以开始。" || item.SourceText != "Because we are ready we can begin." ||
		item.RewriteAttempts != 3 || item.DurationRatio > 1 || len(item.CueIndexes) != 2 {
		t.Fatalf("merged item = %+v", item)
	}
	if len(tts.texts) != 4 || tts.texts[0] != "因为我们已经准备好了" || tts.texts[1] != "所以现在可以开始。" || tts.texts[3] != item.SpokenText {
		t.Fatalf("TTS texts = %+v, want measured originals, rewrite, then merge", tts.texts)
	}
	data, err := os.ReadFile(source)
	if err != nil || !strings.Contains(string(data), "Because we are ready\n") {
		t.Fatalf("source SRT changed: %q, %v", data, err)
	}
}

func TestRunnerKeepsSourceMeaningWhenSourceAwareRewriteFails(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.srt")
	source := filepath.Join(dir, "source.srt")
	if err := os.WriteFile(target, []byte("1\n00:00:00,000 --> 00:00:01,000\n只重读的学生记住40%。\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("1\n00:00:00,000 --> 00:00:01,000\nStudents who just reread it, 40%.\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{responses: []string{"invalid JSON", "学生占40%", "invalid JSON"}}
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", SourceSRT: source, Voice: "voice", Workdir: dir,
		InputSRT: target, AudioOnly: true, OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(),
		FFmpeg:   fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) { return 1.8, nil },
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v, want atempo fallback", err)
	}
	if len(tts.texts) != 1 || tts.texts[0] != "只重读的学生记住40%。" || result.Plan[0].SpokenText != tts.texts[0] {
		t.Fatalf("TTS texts = %q, plan = %+v; source-free fallback changed the meaning", tts.texts, result.Plan[0])
	}
	if chat.calls != 3 || result.Plan[0].RewriteAttempts != 3 || len(result.Report.Warnings) != 1 {
		t.Fatalf("calls = %d, plan = %+v, report = %+v; want three source-aware attempts and atempo fallback", chat.calls, result.Plan[0], result.Report)
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

func TestRunnerUsesAtempoFallbackWhenMeasuredOverflowCannotBeRewritten(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "target.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\n一\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	tts := &fakeTTS{writeOnReturn: true}
	chat := &fakeChat{response: "二"}
	result, err := NewRunner(Dependencies{
		TTS: tts, Chat: chat, Language: "zh_cn", Voice: "voice", Workdir: dir, InputSRT: input, AudioOnly: true,
		OutputAudio: filepath.Join(dir, "output.wav"), Config: DefaultConfig(), FFmpeg: fakeRunnerWritingOutputs(dir),
		Duration: func(string) (float64, error) { return 1.8, nil },
	}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v, want successful atempo fallback", err)
	}
	if len(tts.texts) != 2 || chat.calls != 3 {
		t.Fatalf("TTS calls = %d, chat calls = %d, want three rewrite attempts", len(tts.texts), chat.calls)
	}
	if result.Plan[0].SpeedFactor != 1.8 || len(result.Report.Warnings) != 1 || !strings.Contains(result.Report.Warnings[0], "atempo_required=true") {
		t.Fatalf("fallback result = %+v, want forced atempo report", result)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "output.wav")); statErr != nil {
		t.Fatalf("output stat error = %v, want assembled output", statErr)
	}
}
