package service

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildEmbedSubtitleArgsUsesRequestedSubtitleAndOutput(t *testing.T) {
	req := RenderVideoRequest{
		Workdir:      "tasks/demo",
		InputVideo:   "tasks/demo/origin_video.mp4",
		SubtitleFile: "tasks/demo/target_language_srt.srt",
		OutputFile:   "tasks/demo/output/horizontal_dubbed.mp4",
		Horizontal:   true,
	}
	args, assPath := buildEmbedSubtitleArgs(req)
	joined := strings.Join(args, " ")
	if !strings.Contains(assPath, filepath.Join("tasks", "demo")) {
		t.Fatalf("assPath = %q does not use workdir", assPath)
	}
	if !strings.Contains(joined, "tasks/demo/origin_video.mp4") {
		t.Fatalf("args do not contain input video: %v", args)
	}
	if !strings.Contains(joined, "tasks/demo/output/horizontal_dubbed.mp4") {
		t.Fatalf("args do not contain output file: %v", args)
	}
}

func TestRenderAssPathDerivesFromOutputFile(t *testing.T) {
	req := RenderVideoRequest{
		Workdir:    "tasks/demo",
		OutputFile: "tasks/demo/output/horizontal_dubbed.mp4",
	}

	got := renderAssPath(req)
	want := filepath.Join("tasks", "demo", "formatted_horizontal_dubbed.ass")
	if got != want {
		t.Fatalf("renderAssPath() = %q, want %q", got, want)
	}
	if strings.Contains(got, "formatted_subtitles.ass") {
		t.Fatalf("renderAssPath() still uses fixed subtitle name: %q", got)
	}
}

func TestEscapeAssFilterPathEscapesWindowsDriveAndSeparators(t *testing.T) {
	got := escapeAssFilterPath(`C:\tasks\demo\formatted_horizontal_dubbed.ass`)
	want := `C\:/tasks/demo/formatted_horizontal_dubbed.ass`
	if got != want {
		t.Fatalf("escapeAssFilterPath() = %q, want %q", got, want)
	}
}

func TestBuildEmbedSubtitleArgsQuotesEscapedAssFilename(t *testing.T) {
	req := RenderVideoRequest{
		Workdir:    `C:\tasks\demo`,
		InputVideo: `C:\tasks\demo\origin_video.mp4`,
		OutputFile: `C:\tasks\demo\horizontal.mp4`,
		Horizontal: true,
	}
	args, _ := buildEmbedSubtitleArgs(req)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, `ass=filename='C\:/tasks/demo/formatted_horizontal.ass'`) {
		t.Fatalf("args do not contain a quoted escaped ASS filename: %v", args)
	}
}

func TestBuildEmbedSubtitleArgsEscapesAndPassesPackagedFontsDir(t *testing.T) {
	resourceRoot := t.TempDir()
	fontsDir := filepath.Join(resourceRoot, "fonts")
	if err := os.MkdirAll(fontsDir, 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KRILLINAI_RESOURCE_ROOT", resourceRoot)
	req := RenderVideoRequest{
		Workdir:    filepath.Join(t.TempDir(), "task,one"),
		InputVideo: "origin.mp4",
		OutputFile: "output.mp4",
		Horizontal: true,
	}

	args, _ := buildEmbedSubtitleArgs(req)
	filter := args[4]
	if !strings.Contains(filter, ":fontsdir='") {
		t.Fatalf("filter does not contain fontsdir: %q", filter)
	}
	if !strings.Contains(filter, escapeAssFilterPath(fontsDir)) {
		t.Fatalf("filter does not contain escaped fontsdir: %q", filter)
	}
}

func TestBuildAssFilterExpressionEscapesWindowsFilenameAndFontsDir(t *testing.T) {
	got := buildAssFilterExpression(
		`C:\tasks\demo\formatted.ass`,
		`C:\Program Files\OpenCreator\fonts`,
	)
	want := `ass=filename='C\:/tasks/demo/formatted.ass':fontsdir='C\:/Program Files/OpenCreator/fonts'`
	if got != want {
		t.Fatalf("buildAssFilterExpression() = %q, want %q", got, want)
	}
}

func TestValidatePackagedSubtitleFontsRejectsMissingSelectedFont(t *testing.T) {
	resourceRoot := t.TempDir()
	fontsDir := filepath.Join(resourceRoot, "fonts")
	if err := os.MkdirAll(fontsDir, 0755); err != nil {
		t.Fatal(err)
	}
	content := []byte("font")
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	manifest := map[string]any{
		"version": 1,
		"fonts": []map[string]any{{
			"family": "OpenCreator Sans Regular",
			"file":   "fonts/OpenCreatorSans-Regular.ttf",
			"sha256": hash,
		}},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fontsDir, "manifest.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fontsDir, "OpenCreatorSans-Regular.ttf"), content, 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KRILLINAI_RESOURCE_ROOT", resourceRoot)
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontName = "OpenCreator Serif Bold"

	err = validatePackagedSubtitleFonts(style)
	if err == nil || !strings.Contains(err.Error(), "alias unavailable") {
		t.Fatalf("validatePackagedSubtitleFonts() error = %v, want missing alias error", err)
	}
}

func TestValidatePackagedSubtitleFontsRejectsHashMismatch(t *testing.T) {
	resourceRoot := t.TempDir()
	fontsDir := filepath.Join(resourceRoot, "fonts")
	if err := os.MkdirAll(fontsDir, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := map[string]any{
		"version": 1,
		"fonts": []map[string]any{{
			"family": "OpenCreator Sans Regular",
			"file":   "fonts/OpenCreatorSans-Regular.ttf",
			"sha256": strings.Repeat("0", 64),
		}},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fontsDir, "manifest.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fontsDir, "OpenCreatorSans-Regular.ttf"), []byte("tampered"), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KRILLINAI_RESOURCE_ROOT", resourceRoot)
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontName = "OpenCreator Sans Regular"

	err = validatePackagedSubtitleFonts(style)
	if err == nil || !strings.Contains(err.Error(), "hash mismatch") {
		t.Fatalf("validatePackagedSubtitleFonts() error = %v, want hash mismatch", err)
	}
}

func TestPrepareRenderVideoInputConvertsHorizontalVerticalRequest(t *testing.T) {
	workdir := filepath.Join("tasks", "demo")
	req := RenderVideoRequest{
		Workdir:    workdir,
		InputVideo: filepath.Join(workdir, "origin_video.mp4"),
		Horizontal: false,
		StepParam: &types.SubtitleTaskStepParam{
			TaskBasePath: workdir,
		},
	}

	got, err := prepareRenderVideoInput(req, 1280, 720, func(input, output, majorTitle, minorTitle string) error {
		if input != req.InputVideo {
			t.Fatalf("convert input = %q, want %q", input, req.InputVideo)
		}
		wantOutput := filepath.Join(workdir, types.SubtitleTaskTransferredVerticalVideoFileName)
		if output != wantOutput {
			t.Fatalf("convert output = %q, want %q", output, wantOutput)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("prepareRenderVideoInput() error = %v", err)
	}
	want := filepath.Join(workdir, types.SubtitleTaskTransferredVerticalVideoFileName)
	if got != want {
		t.Fatalf("prepareRenderVideoInput() = %q, want %q", got, want)
	}
	if req.StepParam.InputVideoPath != want {
		t.Fatalf("StepParam.InputVideoPath = %q, want %q", req.StepParam.InputVideoPath, want)
	}
}

func TestPrepareSubtitleRenderLayoutSetsHorizontalDimensions(t *testing.T) {
	req := RenderVideoRequest{
		InputVideo: "tasks/demo/origin_video.mp4",
		Horizontal: true,
		StepParam:  &types.SubtitleTaskStepParam{},
	}

	got, err := prepareSubtitleRenderLayout(req, func(input string) (int, int, error) {
		if input != req.InputVideo {
			t.Fatalf("probe input = %q, want %q", input, req.InputVideo)
		}
		return 1920, 1080, nil
	}, func(input, output, majorTitle, minorTitle string) error {
		t.Fatal("horizontal render should not convert video")
		return nil
	})
	if err != nil {
		t.Fatalf("prepareSubtitleRenderLayout() error = %v", err)
	}
	if got.StepParam.RenderWidth != 1920 || got.StepParam.RenderHeight != 1080 {
		t.Fatalf("Render dimensions = %dx%d, want 1920x1080", got.StepParam.RenderWidth, got.StepParam.RenderHeight)
	}
	if got.InputVideo != req.InputVideo {
		t.Fatalf("InputVideo = %q, want %q", got.InputVideo, req.InputVideo)
	}
}

func TestPrepareSubtitleRenderLayoutSetsConvertedVerticalDimensions(t *testing.T) {
	workdir := filepath.Join("tasks", "demo")
	req := RenderVideoRequest{
		Workdir:    workdir,
		InputVideo: filepath.Join(workdir, "origin_video.mp4"),
		Horizontal: false,
		StepParam:  &types.SubtitleTaskStepParam{TaskBasePath: workdir},
	}

	got, err := prepareSubtitleRenderLayout(req, func(input string) (int, int, error) {
		return 1280, 720, nil
	}, func(input, output, majorTitle, minorTitle string) error {
		return nil
	})
	if err != nil {
		t.Fatalf("prepareSubtitleRenderLayout() error = %v", err)
	}
	wantInput := filepath.Join(workdir, types.SubtitleTaskTransferredVerticalVideoFileName)
	if got.InputVideo != wantInput {
		t.Fatalf("InputVideo = %q, want converted vertical path %q", got.InputVideo, wantInput)
	}
	if got.StepParam.RenderWidth != 720 || got.StepParam.RenderHeight != 1280 {
		t.Fatalf("Render dimensions = %dx%d, want 720x1280", got.StepParam.RenderWidth, got.StepParam.RenderHeight)
	}
}

func TestGetFontPathsUsesChineseCapableFontsOnDarwin(t *testing.T) {
	bold, regular, err := fontPathsForOS("darwin", func(path string) bool {
		return strings.Contains(path, "Hiragino Sans GB")
	})
	if err != nil {
		t.Fatalf("fontPathsForOS() error = %v", err)
	}
	if !strings.Contains(bold, "Arial Unicode") && !strings.Contains(bold, "Hiragino") && !strings.Contains(bold, "Heiti") {
		t.Fatalf("bold font %q does not look Chinese-capable", bold)
	}
	if !strings.Contains(regular, "Arial Unicode") && !strings.Contains(regular, "Hiragino") && !strings.Contains(regular, "Heiti") {
		t.Fatalf("regular font %q does not look Chinese-capable", regular)
	}
}

func TestGetFontPathsUsesChineseCapableFontsOnWindows(t *testing.T) {
	bold, regular, err := fontPathsForOS("windows", func(path string) bool {
		return strings.Contains(path, "msyh")
	})
	if err != nil {
		t.Fatalf("fontPathsForOS() error = %v", err)
	}
	if !strings.Contains(bold, "msyh") || !strings.Contains(regular, "msyh") {
		t.Fatalf("windows fonts = %q, %q; want Microsoft YaHei candidates", bold, regular)
	}
}

func TestBuildVerticalFilterEscapesTitleTextAndUsesCompactHeader(t *testing.T) {
	filter := buildVerticalFilter("CLI 集成测试: A's", "副标题", "/fonts/chinese.ttf", "/fonts/chinese.ttf")
	if !strings.Contains(filter, "drawbox=y=0:h=250") {
		t.Fatalf("filter should use compact 250px title header: %s", filter)
	}
	if !strings.Contains(filter, "fontsize=44") {
		t.Fatalf("filter should use smaller title font size: %s", filter)
	}
	if !strings.Contains(filter, `CLI 集成测试\: A\\'s`) {
		t.Fatalf("filter did not escape title text safely: %s", filter)
	}
}

func TestBuildVerticalFilterEscapesWindowsFontPathOnce(t *testing.T) {
	filter := buildVerticalFilter("", "", `C:\Windows\Fonts\msyhbd.ttc`, `C\:/Windows/Fonts/msyh.ttc`)
	if !strings.Contains(filter, `fontfile='C\:/Windows/Fonts/msyhbd.ttc'`) {
		t.Fatalf("filter did not normalize native Windows font path: %s", filter)
	}
	if !strings.Contains(filter, `fontfile='C\:/Windows/Fonts/msyh.ttc'`) {
		t.Fatalf("filter did not preserve an already escaped Windows font path: %s", filter)
	}
	if strings.Contains(filter, `C\\:/Windows/Fonts`) {
		t.Fatalf("filter escaped the Windows drive separator twice: %s", filter)
	}
}
