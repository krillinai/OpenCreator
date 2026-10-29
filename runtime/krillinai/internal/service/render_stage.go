package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"os"
	"path"
	"path/filepath"
	"strings"
)

type RenderVideoRequest struct {
	Workdir       string
	InputVideo    string
	AudioFile     string
	SubtitleFile  string
	OutputFile    string
	Horizontal    bool
	StepParam     *types.SubtitleTaskStepParam
	PreviewWidth  int
	PreviewHeight int
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
	if req.PreviewWidth > 0 && req.PreviewHeight > 0 {
		// Recover straight alpha from opaque renders: libass alpha=1 differs at blended edges.
		previewFilter := fmt.Sprintf("[0:v]split[black][white];[black]%s[b];[white]lutrgb=r=255:g=255:b=255,%s[w];[b][w]vstack", filter, filter)
		return []string{
			"-y", "-f", "lavfi", "-i",
			fmt.Sprintf("color=c=black:s=%dx%d:d=1,format=rgb24", req.PreviewWidth, req.PreviewHeight),
			"-filter_complex", previewFilter, "-frames:v", "1", "-update", "1", req.OutputFile,
		}, assPath
	}
	args := []string{
		"-y",
		"-i", req.InputVideo,
	}
	if req.AudioFile != "" {
		args = append(args, "-i", req.AudioFile, "-map", "0:v:0", "-map", "1:a:0", "-shortest")
	}
	return append(args,
		"-vf", filter,
		"-c:v", "libx264",
		"-preset", "fast",
		"-c:a", "aac",
		"-b:a", "192k",
		req.OutputFile,
	), assPath
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
	if req.PreviewWidth > 0 && req.PreviewHeight > 0 {
		req.StepParam.RenderWidth = req.PreviewWidth
		req.StepParam.RenderHeight = req.PreviewHeight
	} else {
		preparedReq, err := prepareSubtitleRenderLayout(req, getResolution, func(input, output, major, minor string) error {
			return convertToVerticalProgress(ctx, input, output, major, minor, stepParam.TaskPtr)
		})
		if err != nil {
			return "", fmt.Errorf("renderSubtitleFile prepare subtitle layout error: %w", err)
		}
		req = preparedReq
	}
	stepParam.TaskPtr.ReportProgress(types.TaskProgress{Phase: "preparing_render", Percent: 30, Message: "正在准备字幕样式和视频编码"})
	if err := validatePackagedSubtitleFonts(req.StepParam.SubtitleStyle); err != nil {
		return "", fmt.Errorf("renderSubtitleFile subtitle fonts error: %w", err)
	}
	if err := srtToAss(req.SubtitleFile, assPath, req.Horizontal, req.StepParam); err != nil {
		return "", fmt.Errorf("renderSubtitleFile srtToAss error: %w", err)
	}
	args, _ := buildEmbedSubtitleArgs(req)
	output, err := runFFmpegProgress(ctx, args, req.InputVideo, "rendering_video", "正在编码并合成字幕视频", stepParam.TaskPtr, 35, 98)
	if err != nil {
		return "", fmt.Errorf("renderSubtitleFile ffmpeg error: %w, output: %s", err, string(output))
	}
	if req.PreviewWidth > 0 && req.PreviewHeight > 0 {
		if err := transparentSubtitlePreview(req.OutputFile, req.PreviewWidth, req.PreviewHeight); err != nil {
			return "", fmt.Errorf("renderSubtitleFile preview alpha error: %w", err)
		}
	}
	stepParam.TaskPtr.ReportProgress(types.TaskProgress{Phase: "collecting_outputs", Percent: 99, Message: "视频编码完成，正在整理输出文件"})
	return req.OutputFile, nil
}

func transparentSubtitlePreview(filename string, width, height int) error {
	f, err := os.Open(filename)
	if err != nil {
		return err
	}
	stacked, err := png.Decode(f)
	f.Close()
	if err != nil {
		return err
	}
	if stacked.Bounds().Dx() != width || stacked.Bounds().Dy() != height*2 {
		return fmt.Errorf("unexpected preview dimensions: %v", stacked.Bounds())
	}
	preview := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			black := color.NRGBAModel.Convert(stacked.At(x, y)).(color.NRGBA)
			white := color.NRGBAModel.Convert(stacked.At(x, y+height)).(color.NRGBA)
			alpha := 255 - (int(white.R)-int(black.R)+int(white.G)-int(black.G)+int(white.B)-int(black.B)+1)/3
			if alpha <= 0 {
				continue
			}
			if alpha > 255 {
				alpha = 255
			}
			straight := func(value uint8) uint8 {
				v := (int(value)*255 + alpha/2) / alpha
				if v > 255 {
					v = 255
				}
				return uint8(v)
			}
			preview.SetNRGBA(x, y, color.NRGBA{R: straight(black.R), G: straight(black.G), B: straight(black.B), A: uint8(alpha)})
		}
	}
	f, err = os.Create(filename)
	if err != nil {
		return err
	}
	err = png.Encode(f, preview)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

type subtitleFontEntry struct {
	Family  string   `json:"family"`
	File    string   `json:"file"`
	SHA256  string   `json:"sha256"`
	Scripts []string `json:"scripts"`
}

type subtitleFontManifest struct {
	Version       int                 `json:"version"`
	Fonts         []subtitleFontEntry `json:"fonts"`
	FallbackFonts []subtitleFontEntry `json:"fallbackFonts"`
}

func validatePackagedSubtitleFonts(styleSet *subtitlestyle.StyleSet) error {
	resourceRoot := strings.TrimSpace(os.Getenv("KRILLINAI_RESOURCE_ROOT"))
	if resourceRoot == "" {
		return nil
	}
	if styleSet == nil {
		styleSet = subtitlestyle.DefaultStyleSet()
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
	if (manifest.Version != 1 && manifest.Version != 2) || len(manifest.Fonts) == 0 || (manifest.Version == 2 && len(manifest.FallbackFonts) == 0) {
		return fmt.Errorf("creator subtitle font manifest invalid")
	}
	available := make(map[string]bool, len(manifest.Fonts))
	for _, font := range append(manifest.Fonts, manifest.FallbackFonts...) {
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
		if available[font.Family] {
			return fmt.Errorf("creator subtitle font alias duplicated: %s", font.Family)
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
