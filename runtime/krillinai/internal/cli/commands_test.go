package cli

import (
	"context"
	"errors"
	"krillin-ai/internal/pipeline"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseSubtitleCommand(t *testing.T) {
	cmd, err := Parse([]string{
		"subtitle",
		"https://www.youtube.com/watch?v=abc",
		"--origin-lang", "en",
		"--target-lang", "zh_cn",
		"--workdir", "tasks/demo",
		"--caption-source", "any",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.Name != "subtitle" {
		t.Fatalf("Name = %q, want subtitle", cmd.Name)
	}
	if cmd.Subtitle.Input != "https://www.youtube.com/watch?v=abc" {
		t.Fatalf("Input = %q", cmd.Subtitle.Input)
	}
	if cmd.Subtitle.Workdir != "tasks/demo" {
		t.Fatalf("Workdir = %q", cmd.Subtitle.Workdir)
	}
	if !cmd.Subtitle.BilingualTop {
		t.Fatalf("BilingualTop = false, want true by default")
	}
}

func TestParseStandaloneSRT(t *testing.T) {
	cmd, err := Parse([]string{"subtitle", "--input-srt", "source.srt", "--origin-lang", "en", "--target-lang", "zh_cn"})
	if err != nil || cmd.Subtitle.Input != "" || cmd.Subtitle.InputSRT != "source.srt" || cmd.Subtitle.PrepareVideo {
		t.Fatalf("command = %+v, error = %v", cmd, err)
	}
	for _, args := range [][]string{{"subtitle"}, {"subtitle", "--input-srt", "source.srt", "--prepare-video"}} {
		if _, err := Parse(args); err == nil {
			t.Fatalf("expected missing video error for %v", args)
		}
	}
}

func TestParseDeferredMediaAndAudioOnlyOptions(t *testing.T) {
	cmd, err := Parse([]string{"tts", "--input-srt", "target.srt", "--audio-only", "--source-url", "https://www.youtube.com/watch?v=demo", "--media-workdir", "source-cache"})
	if err != nil || !cmd.TTS.AudioOnly || cmd.TTS.SourceURL == "" || cmd.TTS.MediaWorkdir != "source-cache" {
		t.Fatalf("TTS command = %+v, error = %v", cmd, err)
	}
	cmd, err = Parse([]string{"render-horizontal", "--source-url", "https://www.youtube.com/watch?v=demo", "--media-workdir", "source-cache", "--subtitle", "target.srt", "--audio", "dubbed.wav"})
	if err != nil || cmd.Render.SourceURL == "" || cmd.Render.MediaWorkdir != "source-cache" || cmd.Render.Audio != "dubbed.wav" {
		t.Fatalf("render command = %+v, error = %v", cmd, err)
	}
}

func TestParseSubtitlePrepareVideo(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		args := []string{"subtitle", "https://www.youtube.com/watch?v=abc"}
		if enabled {
			args = append(args, "--prepare-video")
		}
		cmd, err := Parse(args)
		if err != nil {
			t.Fatal(err)
		}
		if cmd.Subtitle.PrepareVideo != enabled {
			t.Fatalf("PrepareVideo = %v, want %v", cmd.Subtitle.PrepareVideo, enabled)
		}
	}
}

func TestParseSubtitleSourceOnly(t *testing.T) {
	cmd, err := Parse([]string{
		"subtitle",
		"https://www.youtube.com/watch?v=abc",
		"--source-only",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !cmd.Subtitle.SourceOnly {
		t.Fatal("SourceOnly = false, want true")
	}
	if !strings.Contains(Help(Command{Name: "subtitle"}), "--source-only") {
		t.Fatal("subtitle help does not advertise --source-only")
	}
}

func TestParseSubtitleCommandCanPutTargetLanguageOnBottom(t *testing.T) {
	cmd, err := Parse([]string{
		"subtitle",
		"https://www.youtube.com/watch?v=abc",
		"--origin-lang", "en",
		"--target-lang", "zh_cn",
		"--workdir", "tasks/demo",
		"--bilingual-top=false",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.Subtitle.BilingualTop {
		t.Fatalf("BilingualTop = true, want false when explicitly disabled")
	}
}

func TestParseSubtitleCommandAcceptsSubtitleStyleFile(t *testing.T) {
	cmd, err := Parse([]string{
		"subtitle",
		"local:demo.mp4",
		"--origin-lang", "en",
		"--target-lang", "zh_cn",
		"--workdir", "tasks/demo",
		"--subtitle-style-file", "style.json",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.SubtitleStyleFile != "style.json" {
		t.Fatalf("SubtitleStyleFile = %q", cmd.SubtitleStyleFile)
	}
}

func TestParseTTSCommandRequiresInputSRT(t *testing.T) {
	_, err := Parse([]string{"tts", "--workdir", "tasks/demo"})
	if err == nil {
		t.Fatalf("Parse() error = nil, want error")
	}
}

func TestParseRenderCommandAcceptsSubtitleStyleFile(t *testing.T) {
	cmd, err := Parse([]string{
		"render-horizontal",
		"--workdir", "tasks/demo",
		"--video", "origin.mp4",
		"--subtitle", "bilingual.srt",
		"--subtitle-style-file", "style.json",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.SubtitleStyleFile != "style.json" {
		t.Fatalf("SubtitleStyleFile = %q", cmd.SubtitleStyleFile)
	}
}

func TestParseRenderCommandAcceptsSubtitleDocument(t *testing.T) {
	cmd, err := Parse([]string{
		"render-horizontal",
		"--workdir", "tasks/demo",
		"--video", "origin.mp4",
		"--subtitle", "bilingual.srt",
		"--subtitle-document", "subtitle-document.json",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.Render.SubtitleDocument != "subtitle-document.json" {
		t.Fatalf("SubtitleDocument = %q", cmd.Render.SubtitleDocument)
	}
}

func TestParseRenderPreviewAndLineMode(t *testing.T) {
	cmd, err := Parse([]string{"render-vertical", "--workdir", "preview", "--subtitle", "preview.srt", "--line-mode", "bilingual-target-bottom", "--preview-width", "540", "--preview-height", "960"})
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Render.LineMode != pipeline.LineModeBilingualTargetBottom || cmd.Render.PreviewWidth != 540 || cmd.Render.PreviewHeight != 960 {
		t.Fatalf("preview parameters lost: %#v", cmd.Render)
	}
	for _, args := range [][]string{{"render-horizontal", "--line-mode", "unknown"}, {"render-horizontal", "--preview-width", "960"}} {
		if _, err := Parse(args); err == nil {
			t.Fatalf("invalid preview accepted: %v", args)
		}
	}
}

func TestParseVoicesCommand(t *testing.T) {
	cmd, err := Parse([]string{
		"voices",
		"--provider", "aliyun",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.Name != "voices" {
		t.Fatalf("Name = %q, want voices", cmd.Name)
	}
	if cmd.Voices.Provider != "aliyun" {
		t.Fatalf("Provider = %q, want aliyun", cmd.Voices.Provider)
	}
}

func TestVoicesHelp(t *testing.T) {
	cmd, err := Parse([]string{"voices", "--help"})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !cmd.Help || cmd.Name != "voices" {
		t.Fatalf("Command = %#v, want voices help", cmd)
	}
	help := Help(cmd)
	if !strings.Contains(help, "krillinai-cli voices") || !strings.Contains(help, "--provider") {
		t.Fatalf("Help() = %q, want voices usage", help)
	}
}

func TestParseRootHelp(t *testing.T) {
	cmd, err := Parse([]string{"--help"})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !cmd.Help || cmd.Name != "" {
		t.Fatalf("Command = %#v, want root help", cmd)
	}
	help := Help(cmd)
	if !strings.Contains(help, "Usage:") || !strings.Contains(help, "subtitle") {
		t.Fatalf("Help() = %q, want root usage with commands", help)
	}
	if !strings.Contains(help, "voices") {
		t.Fatalf("Help() = %q, want voices command", help)
	}
}

func TestParseSubcommandHelp(t *testing.T) {
	cmd, err := Parse([]string{"subtitle", "--help"})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !cmd.Help || cmd.Name != "subtitle" {
		t.Fatalf("Command = %#v, want subtitle help", cmd)
	}
	help := Help(cmd)
	if !strings.Contains(help, "Usage:") || !strings.Contains(help, "--origin-lang") {
		t.Fatalf("Help() = %q, want subtitle usage with flags", help)
	}
}

func TestParseCoverCommand(t *testing.T) {
	cmd, err := Parse([]string{
		"cover",
		"--workdir", "tasks/demo",
		"--task-id", "demo",
		"--prompt", "电影感科技封面，醒目中文标题",
		"--size", "1536x1024",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if cmd.Name != "cover" {
		t.Fatalf("Name = %q, want cover", cmd.Name)
	}
	if cmd.Cover.Workdir != "tasks/demo" {
		t.Fatalf("Workdir = %q", cmd.Cover.Workdir)
	}
	if cmd.Cover.Prompt != "电影感科技封面，醒目中文标题" {
		t.Fatalf("Prompt = %q", cmd.Cover.Prompt)
	}
	if cmd.Cover.Size != "1536x1024" {
		t.Fatalf("Size = %q", cmd.Cover.Size)
	}
}

func TestParseCoverCommandRequiresPrompt(t *testing.T) {
	_, err := Parse([]string{"cover", "--workdir", "tasks/demo"})
	if err == nil {
		t.Fatalf("Parse() error = nil, want error")
	}
}

func TestParseCoverCommandHelp(t *testing.T) {
	cmd, err := Parse([]string{"cover", "--help"})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !cmd.Help || cmd.Name != "cover" {
		t.Fatalf("Command = %#v, want cover help", cmd)
	}
	help := Help(cmd)
	if !strings.Contains(help, "--prompt") {
		t.Fatalf("Help() = %q, want cover flags", help)
	}
}

func TestHelpDryRunTextDoesNotClaimManifestWrites(t *testing.T) {
	commands := []string{"subtitle", "render-horizontal", "render-vertical"}
	for _, name := range commands {
		cmd, err := Parse([]string{name, "--help"})
		if err != nil {
			t.Fatalf("Parse(%s --help) error = %v", name, err)
		}
		help := Help(cmd)
		if strings.Contains(help, "write manifest") {
			t.Fatalf("%s help still claims dry-run writes manifest:\n%s", name, help)
		}
	}
}

func TestExecuteDryRunSubtitleReturnsJSONReadyResponse(t *testing.T) {
	cmd, err := Parse([]string{
		"subtitle",
		"local:demo.mp4",
		"--origin-lang", "en",
		"--target-lang", "zh_cn",
		"--workdir", t.TempDir(),
		"--dry-run",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	resp := Execute(context.Background(), nil, cmd)
	if !resp.OK {
		t.Fatalf("OK = false, error = %#v", resp.Error)
	}
	if resp.Stage != pipeline.StageSubtitle {
		t.Fatalf("Stage = %s", resp.Stage)
	}
}

func TestExecuteDryRunVoicesReturnsAliyunVoiceList(t *testing.T) {
	cmd, err := Parse([]string{"voices", "--provider", "aliyun", "--dry-run"})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	resp := Execute(context.Background(), nil, cmd)
	if !resp.OK {
		t.Fatalf("OK = false, error = %#v", resp.Error)
	}
	if resp.Stage != pipeline.StageVoices {
		t.Fatalf("Stage = %s, want voices", resp.Stage)
	}
	if resp.Inputs["provider"] != "aliyun" {
		t.Fatalf("provider input = %q", resp.Inputs["provider"])
	}
	if len(resp.Voices) == 0 {
		t.Fatal("Voices is empty, want aliyun voice list")
	}
	if !containsVoiceCode(resp.Voices, "Cherry") {
		t.Fatalf("Voices = %#v, want aliyun voice code Cherry", resp.Voices)
	}
}

func TestExecuteVoicesUsesConfiguredProviderWhenProviderMissing(t *testing.T) {
	original := currentTTSProvider
	currentTTSProvider = func() string {
		return "openai"
	}
	t.Cleanup(func() {
		currentTTSProvider = original
	})

	cmd, err := Parse([]string{"voices"})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	resp := Execute(context.Background(), nil, cmd)
	if !resp.OK {
		t.Fatalf("OK = false, error = %#v", resp.Error)
	}
	if resp.Inputs["provider"] != "openai" {
		t.Fatalf("provider input = %q, want openai", resp.Inputs["provider"])
	}
	if !containsVoiceCode(resp.Voices, "alloy") {
		t.Fatalf("Voices = %#v, want openai voice code alloy", resp.Voices)
	}
}

func containsVoiceCode(voices []pipeline.Voice, code string) bool {
	for _, voice := range voices {
		if voice.Code == code {
			return true
		}
	}
	return false
}

func TestExecuteDryRunRenderRejectsInvalidSubtitleStyleFile(t *testing.T) {
	cmd, err := Parse([]string{
		"render-horizontal",
		"--workdir", t.TempDir(),
		"--video", "origin.mp4",
		"--subtitle", "bilingual.srt",
		"--subtitle-style-file", "missing.json",
		"--dry-run",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	resp := Execute(context.Background(), nil, cmd)
	if resp.OK {
		t.Fatalf("OK = true, want false for missing style file")
	}
	if resp.Error == nil || !strings.Contains(resp.Error.Message, "missing.json") {
		t.Fatalf("error = %#v, want missing style file message", resp.Error)
	}
}

func TestExecuteDryRunRenderLoadsSubtitleStyleFile(t *testing.T) {
	dir := t.TempDir()
	stylePath := filepath.Join(dir, "style.json")
	if err := os.WriteFile(stylePath, []byte(`{"horizontal":{"major":{"primary_color":"#FFFFFF"}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	cmd, err := Parse([]string{
		"render-horizontal",
		"--workdir", dir,
		"--video", "origin.mp4",
		"--subtitle", "bilingual.srt",
		"--subtitle-style-file", stylePath,
		"--dry-run",
	})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	resp := Execute(context.Background(), nil, cmd)
	if !resp.OK {
		t.Fatalf("OK = false, error = %#v", resp.Error)
	}
	manifestPath := filepath.Join(dir, "krillinai_manifest.json")
	if _, err := os.Stat(manifestPath); !os.IsNotExist(err) {
		t.Fatalf("manifest exists after dry-run: err = %v", err)
	}
}

func TestLoadSubtitleStyleFindsRepoDefaultFromDifferentWorkingDir(t *testing.T) {
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defaultPath, ok, err := findDefaultSubtitleStylePath()
	if err != nil {
		t.Fatalf("findDefaultSubtitleStylePath() error = %v", err)
	}
	if !ok {
		t.Fatal("default subtitle style path not found")
	}
	defer func() {
		if err := os.Chdir(originalWd); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	}()
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}

	style, err := loadSubtitleStyleForCLI("")
	if err != nil {
		t.Fatalf("loadSubtitleStyleForCLI() error = %v", err)
	}
	defaultFile, err := subtitlestyle.LoadOverrideFile(defaultPath)
	if err != nil {
		t.Fatalf("load default file: %v", err)
	}
	if style.Horizontal.Major.PrimaryColor != defaultFile.Horizontal.Major.PrimaryColor {
		t.Fatalf("primary color = %q, want repo default %q", style.Horizontal.Major.PrimaryColor, defaultFile.Horizontal.Major.PrimaryColor)
	}
	if style.Vertical.Major.MarginV == nil || style.Vertical.Minor.MarginV == nil {
		t.Fatalf("vertical subtitle margins must be defined")
	}
	if *style.Vertical.Major.MarginV <= *style.Vertical.Minor.MarginV {
		t.Fatalf(
			"vertical Major subtitle should render above Minor: major MarginV=%d minor MarginV=%d",
			*style.Vertical.Major.MarginV,
			*style.Vertical.Minor.MarginV,
		)
	}
}

func TestStyleLoadFailureClassifiesDefaultStyleErrorsAsInternal(t *testing.T) {
	err := defaultStyleLoadError(errors.New("broken default style"))
	resp := styleLoadFailure(pipeline.StageRenderHorizontal, "work", "task", err)
	if resp.Error == nil {
		t.Fatal("Error = nil, want style load error")
	}
	if resp.Error.Kind != pipeline.ErrorKindInternal {
		t.Fatalf("Kind = %s, want internal", resp.Error.Kind)
	}
	if resp.Error.Code != "default_subtitle_style_load_failed" {
		t.Fatalf("Code = %q, want default_subtitle_style_load_failed", resp.Error.Code)
	}
}

func TestStyleLoadFailureClassifiesUserStyleErrorsAsUsage(t *testing.T) {
	err := userStyleLoadError(errors.New("missing user style"))
	resp := styleLoadFailure(pipeline.StageRenderHorizontal, "work", "task", err)
	if resp.Error == nil {
		t.Fatal("Error = nil, want style load error")
	}
	if resp.Error.Kind != pipeline.ErrorKindUsage {
		t.Fatalf("Kind = %s, want usage", resp.Error.Kind)
	}
	if resp.Error.Code != "subtitle_style_load_failed" {
		t.Fatalf("Code = %q, want subtitle_style_load_failed", resp.Error.Code)
	}
}
