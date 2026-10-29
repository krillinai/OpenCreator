package pipeline

import (
	"context"
	"fmt"
	"krillin-ai/internal/service"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"os"
	"strings"
	"unicode/utf8"
)

func importSubtitleFile(ctx context.Context, svc StageService, req SubtitleRequest, step *types.SubtitleTaskStepParam, manifest *Manifest) error {
	data, err := os.ReadFile(req.InputSRT)
	if err != nil {
		return err
	}
	if !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		return fmt.Errorf("invalid_srt: UTF-8 required")
	}
	if err := validateSRTTimelineFile(req.InputSRT, false); err != nil {
		return err
	}
	parsed, err := readSRTBlocks(req.InputSRT)
	if err != nil {
		return err
	}
	blocks := make([]*util.SrtBlock, len(parsed))
	for index, block := range parsed {
		blocks[index] = &util.SrtBlock{Index: index + 1, Timestamp: strings.ReplaceAll(block.Timestamp, ".", ","), OriginLanguageSentence: strings.Join(block.Lines, "\n")}
		if req.SRTTranslated {
			blocks[index].TargetLanguageSentence = blocks[index].OriginLanguageSentence
		}
	}
	if !req.SRTTranslated {
		startPercent := 5
		if req.PrepareVideo {
			startPercent = 30
		}
		// Import translation has no download/ASR work. Its progress must not use
		// the video preparation reporter or the legacy 40–90 translation range.
		step.TaskPtr.SetProgressReporter(nil)
		step.TaskPtr.SetTranslationProgressReporter(func(completed, total int) {
			percent := startPercent + completed*(95-startPercent)/total
			reportSubtitleProgress(req, "translating_subtitles", percent, "正在翻译导入的原文字幕", ProgressCounts{Completed: completed, Total: total})
		})
		reportSubtitleProgress(req, "translating_subtitles", startPercent, "正在准备字幕翻译")
		blocks, err = svc.TranslateSubtitleBlocks(ctx, blocks, step)
		if err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	reportSubtitleProgress(req, "collecting_subtitles", 96, "正在生成字幕文件")
	var source, target, bilingual strings.Builder
	for _, block := range blocks {
		if strings.TrimSpace(block.TargetLanguageSentence) == "" {
			return fmt.Errorf("translation missing for cue %d", block.Index)
		}
		fmt.Fprintf(&source, "%d\n%s\n%s\n\n", block.Index, block.Timestamp, block.OriginLanguageSentence)
		fmt.Fprintf(&target, "%d\n%s\n%s\n\n", block.Index, block.Timestamp, block.TargetLanguageSentence)
		first, second := block.TargetLanguageSentence, block.OriginLanguageSentence
		if !req.BilingualTop {
			first, second = second, first
		}
		fmt.Fprintf(&bilingual, "%d\n%s\n%s\n%s\n\n", block.Index, block.Timestamp, first, second)
	}
	outputs := map[string]string{manifest.Outputs.TargetSRT: target.String(), manifest.Outputs.ShortOriginMixedSRT: target.String()}
	if !req.SRTTranslated {
		outputs[manifest.Outputs.OriginSRT] = source.String()
		outputs[manifest.Outputs.BilingualSRT] = bilingual.String()
		outputs[manifest.Outputs.ShortOriginMixedSRT] = bilingual.String()
	}
	for path, content := range outputs {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			return err
		}
		if err := service.ReportSubtitleLengthFallbacks(path); err != nil {
			return err
		}
	}
	return nil
}
