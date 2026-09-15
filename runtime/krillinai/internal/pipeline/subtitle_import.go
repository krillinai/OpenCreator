package pipeline

import (
	"context"
	"fmt"
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
		reportSubtitleProgress(req, "translating_subtitles", 40, "正在翻译导入的原文字幕")
		if err := svc.TranslateSubtitleBlocks(ctx, blocks, step); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
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
	}
	return nil
}
