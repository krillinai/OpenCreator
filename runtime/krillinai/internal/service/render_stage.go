package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"krillin-ai/internal/storage"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
)

type RenderVideoRequest struct {
	Workdir      string
	InputVideo   string
	SubtitleFile string
	OutputFile   string
	Horizontal   bool
	StepParam    *types.SubtitleTaskStepParam
}

type resolutionProbe func(inputVideo string) (int, int, error)

func (s Service) RenderVideo(ctx context.Context, req RenderVideoRequest) (string, error) {
	return renderSubtitleFile(ctx, req)
}

func renderAssPath(req RenderVideoRequest) string {
	outputFile := strings.ReplaceAll(req.OutputFile, "\\", "/")
	base := strings.TrimSuffix(path.Base(outputFile), path.Ext(outputFile))
	if base == "" || base == "." {
		base = "subtitles"
	}
	return filepath.Join(req.Workdir, fmt.Sprintf("formatted_%s.ass", base))
}

func escapeAssFilterPath(path string) string {
	p := strings.ReplaceAll(path, "\\", "/")
	return strings.NewReplacer(
		`\`, `\\`,
		`'`, `\'`,
		`:`, `\:`,
		`,`, `\,`,
		`[`, `\[`,
		`]`, `\]`,
	).Replace(p)
}

func buildEmbedSubtitleArgs(req RenderVideoRequest) ([]string, string) {
	assPath := renderAssPath(req)
	filter := buildAssFilterExpression(assPath, packagedSubtitleFontsDir())
	return []string{
		"-y",
		"-i", req.InputVideo,
		"-vf", filter,
		"-c:v", "libx264",
		"-preset", "fast",
		"-c:a", "aac",
		"-b:a", "192k",
		req.OutputFile,
	}, assPath
}

func buildAssFilterExpression(assPath, fontsDir string) string {
	filter := fmt.Sprintf("ass=filename='%s'", escapeAssFilterPath(assPath))
	if strings.TrimSpace(fontsDir) != "" {
		filter += fmt.Sprintf(":fontsdir='%s'", escapeAssFilterPath(fontsDir))
	}
	return filter
}

func packagedSubtitleFontsDir() string {
	resourceRoot := strings.TrimSpace(os.Getenv("KRILLINAI_RESOURCE_ROOT"))
	if resourceRoot == "" {
		return ""
	}
	fontsDir := filepath.Join(resourceRoot, "fonts")
	info, err := os.Stat(fontsDir)
	if err != nil || !info.IsDir() {
		return ""
	}
	return fontsDir
}

func renderSubtitleFile(ctx context.Context, req RenderVideoRequest) (string, error) {
	if err := os.MkdirAll(filepath.Dir(req.OutputFile), 0755); err != nil {
		return "", fmt.Errorf("renderSubtitleFile mkdir output dir error: %w", err)
	}

	assPath := renderAssPath(req)
	stepParam := req.StepParam
	if stepParam == nil {
		stepParam = &types.SubtitleTaskStepParam{TaskBasePath: req.Workdir}
		req.StepParam = stepParam
	}
	preparedReq, err := prepareSubtitleRenderLayout(req, getResolution, convertToVertical)
	if err != nil {
		return "", fmt.Errorf("renderSubtitleFile prepare subtitle layout error: %w", err)
	}
	req = preparedReq
	if err := validatePackagedSubtitleFonts(req.StepParam.SubtitleStyle); err != nil {
		return "", fmt.Errorf("renderSubtitleFile subtitle fonts error: %w", err)
	}
	if err := srtToAss(req.SubtitleFile, assPath, req.Horizontal, req.StepParam); err != nil {
		return "", fmt.Errorf("renderSubtitleFile srtToAss error: %w", err)
	}
	args, _ := buildEmbedSubtitleArgs(req)
	cmd := exec.CommandContext(ctx, storage.FfmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("renderSubtitleFile ffmpeg error: %w, output: %s", err, string(output))
	}
	return req.OutputFile, nil
}

type subtitleFontManifest struct {
	Version int `json:"version"`
	Fonts   []struct {
		Family string `json:"family"`
		File   string `json:"file"`
		SHA256 string `json:"sha256"`
	} `json:"fonts"`
}

func validatePackagedSubtitleFonts(styleSet *subtitlestyle.StyleSet) error {
	resourceRoot := strings.TrimSpace(os.Getenv("KRILLINAI_RESOURCE_ROOT"))
	if resourceRoot == "" || styleSet == nil {
		return nil
	}
	fontsDir := filepath.Join(resourceRoot, "fonts")
	manifestPath := filepath.Join(fontsDir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("creator subtitle font manifest unavailable: %w", err)
	}
	var manifest subtitleFontManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("creator subtitle font manifest invalid: %w", err)
	}
	if manifest.Version != 1 || len(manifest.Fonts) == 0 {
		return fmt.Errorf("creator subtitle font manifest invalid")
	}
	available := make(map[string]bool, len(manifest.Fonts))
	for _, font := range manifest.Fonts {
		if strings.TrimSpace(font.Family) == "" || strings.TrimSpace(font.File) == "" || len(font.SHA256) != 64 {
			return fmt.Errorf("creator subtitle font manifest contains an invalid entry")
		}
		path := filepath.Join(fontsDir, filepath.Base(font.File))
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("creator subtitle font unavailable: %s: %w", font.File, err)
		}
		actual := fmt.Sprintf("%x", sha256.Sum256(content))
		if !strings.EqualFold(actual, font.SHA256) {
			return fmt.Errorf("creator subtitle font hash mismatch: %s", font.File)
		}
		available[font.Family] = true
	}
	for _, fontName := range []string{
		styleSet.Horizontal.Major.FontName,
		styleSet.Horizontal.Minor.FontName,
		styleSet.Vertical.Major.FontName,
		styleSet.Vertical.Minor.FontName,
	} {
		if !available[fontName] {
			return fmt.Errorf("creator subtitle font alias unavailable: %s", fontName)
		}
	}
	return nil
}

type verticalConverter func(inputVideo, outputVideo, majorTitle, minorTitle string) error

func prepareSubtitleRenderLayout(req RenderVideoRequest, probe resolutionProbe, convert verticalConverter) (RenderVideoRequest, error) {
	if req.StepParam == nil {
		req.StepParam = &types.SubtitleTaskStepParam{TaskBasePath: req.Workdir}
	}
	width, height, err := probe(req.InputVideo)
	if err != nil {
		return req, fmt.Errorf("get resolution error: %w", err)
	}
	if !req.Horizontal {
		inputVideo, err := prepareRenderVideoInput(req, width, height, convert)
		if err != nil {
			return req, fmt.Errorf("prepare vertical input error: %w", err)
		}
		req.InputVideo = inputVideo
		if width > height {
			width, height = 720, 1280
		}
	}
	req.StepParam.RenderWidth = width
	req.StepParam.RenderHeight = height
	return req, nil
}

func prepareRenderVideoInput(req RenderVideoRequest, width, height int, convert verticalConverter) (string, error) {
	if req.Horizontal || width <= height {
		return req.InputVideo, nil
	}
	majorTitle, minorTitle := "", ""
	if req.StepParam != nil {
		majorTitle = req.StepParam.VerticalVideoMajorTitle
		minorTitle = req.StepParam.VerticalVideoMinorTitle
	}
	output := filepath.Join(req.Workdir, types.SubtitleTaskTransferredVerticalVideoFileName)
	if err := convert(req.InputVideo, output, majorTitle, minorTitle); err != nil {
		return "", err
	}
	if req.StepParam != nil {
		req.StepParam.InputVideoPath = output
	}
	return output, nil
}
