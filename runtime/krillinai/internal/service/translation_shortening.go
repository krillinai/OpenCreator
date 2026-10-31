package service

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"strings"
	"time"
	"unicode"

	"golang.org/x/sync/errgroup"
)

//go:embed translation_shortening.txt
var translationShorteningPrompt string

const shorteningRequestBytes = 16000

type shorteningSource struct {
	ID         string `json:"cue_id"`
	Source     string `json:"source_text"`
	Target     string `json:"current_target_text"`
	DurationMS int64  `json:"duration_ms"`
}

type shorteningInput struct {
	SourceLanguage string             `json:"source_language"`
	TargetLanguage string             `json:"target_language"`
	Sentences      []shorteningSource `json:"cues"`
}

type shorteningOutputItem struct {
	ID     string `json:"cue_id"`
	Target string `json:"target_text"`
}

type shorteningOutput struct {
	Cues []shorteningOutputItem `json:"cues"`
}

func subtitleReadingLimit(durationMS int64) int {
	if durationMS <= 0 {
		return 0
	}
	// A conservative Chinese subtitle budget. The model is called only when
	// the current cue exceeds this reading budget.
	return int(durationMS * 14 / 1000)
}

func subtitleNeedsShortening(text string, durationMS int64) bool {
	limit := subtitleReadingLimit(durationMS)
	return limit > 0 && subtitleTargetLength(text) > limit
}

func subtitleCriticalTokens(text string) []string {
	var tokens []string
	for i := 0; i < len(text); {
		ascii := func(value byte) bool {
			return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z' || value >= '0' && value <= '9'
		}
		if !ascii(text[i]) {
			i++
			continue
		}
		start := i
		for i < len(text) && ascii(text[i]) {
			i++
		}
		token := text[start:i]
		hasDigit := strings.IndexFunc(token, unicode.IsDigit) >= 0
		allUpper := true
		for _, r := range token {
			if r >= 'a' && r <= 'z' {
				allUpper = false
				break
			}
		}
		if hasDigit || allUpper && len(token) >= 2 {
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func shortenedTargetValid(t *Translator, source, current, candidate string, originLang, targetLang types.StandardLanguageCode, durationMS int64) bool {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || hasSubtitleLineBreak(candidate) || !hasSubtitleContent(candidate) ||
		!t.isTranslationValid(source, candidate, originLang, targetLang) ||
		subtitleTargetLength(candidate) >= subtitleTargetLength(current) ||
		!subtitleNeedsShortening(current, durationMS) {
		return false
	}
	for _, token := range subtitleCriticalTokens(current) {
		if !strings.Contains(candidate, token) {
			return false
		}
	}
	return true
}

func shorteningBatches(cues []*util.SrtBlock, originLang, targetLang types.StandardLanguageCode) []shorteningInput {
	var batches []shorteningInput
	input := shorteningInput{SourceLanguage: types.GetStandardLanguageName(originLang), TargetLanguage: types.GetStandardLanguageName(targetLang)}
	for i, cue := range cues {
		start, end, err := parseSRTTimeline(cue.Timestamp)
		if err != nil || end <= start || !subtitleNeedsShortening(cue.TargetLanguageSentence, end-start) {
			continue
		}
		item := shorteningSource{ID: fmt.Sprint(i), Source: cue.OriginLanguageSentence, Target: cue.TargetLanguageSentence, DurationMS: end - start}
		input.Sentences = append(input.Sentences, item)
		payload, _ := json.Marshal(input)
		if len(payload)+len(translationShorteningPrompt) > shorteningRequestBytes && len(input.Sentences) > 1 {
			input.Sentences = input.Sentences[:len(input.Sentences)-1]
			batches = append(batches, input)
			input = shorteningInput{SourceLanguage: types.GetStandardLanguageName(originLang), TargetLanguage: types.GetStandardLanguageName(targetLang), Sentences: []shorteningSource{item}}
		}
	}
	if len(input.Sentences) > 0 {
		batches = append(batches, input)
	}
	return batches
}

func (t *Translator) requestShortening(ctx context.Context, prompt string) (string, error) {
	if client, ok := t.chatCompleter.(budgetedChatCompleter); ok {
		return client.ChatCompletionContextWithMaxTokens(ctx, prompt, 3072)
	}
	if client, ok := t.chatCompleter.(contextChatCompleter); ok {
		return client.ChatCompletionContext(ctx, prompt)
	}
	return "", fmt.Errorf("字幕时长压缩需要支持上下文取消的模型接口")
}

// shortenTimedSubtitleBlocks applies a bounded, content-preserving pass only
// to Chinese cues that cannot be read within their existing time window.
func (t *Translator) shortenTimedSubtitleBlocks(ctx context.Context, blocks []*util.SrtBlock, originLang, targetLang string) ([]*util.SrtBlock, error) {
	if targetLang != string(types.LanguageNameSimplifiedChinese) && targetLang != string(types.LanguageNameTraditionalChinese) {
		return blocks, nil
	}
	_, hasBudget := t.chatCompleter.(budgetedChatCompleter)
	_, hasContext := t.chatCompleter.(contextChatCompleter)
	if !hasBudget && !hasContext {
		return blocks, nil
	}
	batches := shorteningBatches(blocks, types.StandardLanguageCode(originLang), types.StandardLanguageCode(targetLang))
	if len(batches) == 0 {
		return blocks, nil
	}
	shortenCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	responses := make([]string, len(batches))
	errorsByBatch := make([]error, len(batches))
	var group errgroup.Group
	group.SetLimit(translationParallelism())
	for i := range batches {
		i, input := i, batches[i]
		group.Go(func() error {
			payload, _ := json.Marshal(input)
			responses[i], errorsByBatch[i] = t.requestShortening(shortenCtx, translationShorteningPrompt+"\nInput JSON:\n"+string(payload))
			return nil
		})
	}
	_ = group.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	result := append([]*util.SrtBlock(nil), blocks...)
	applied, skipped := 0, 0
	for i, input := range batches {
		if errorsByBatch[i] != nil {
			skipped += len(input.Sentences)
			continue
		}
		var output shorteningOutput
		if err := json.Unmarshal([]byte(util.ExtractJSONObject(responses[i], "cues")), &output); err != nil {
			skipped += len(input.Sentences)
			continue
		}
		items := make(map[string]shorteningOutputItem, len(output.Cues))
		duplicates := make(map[string]bool)
		for _, item := range output.Cues {
			if _, exists := items[item.ID]; exists {
				duplicates[item.ID] = true
			}
			items[item.ID] = item
		}
		for _, cue := range input.Sentences {
			item, exists := items[cue.ID]
			index := 0
			if _, err := fmt.Sscanf(cue.ID, "%d", &index); err != nil {
				skipped++
				continue
			}
			if !exists || duplicates[cue.ID] || index < 0 || index >= len(result) ||
				!shortenedTargetValid(t, cue.Source, cue.Target, item.Target, types.StandardLanguageCode(originLang), types.StandardLanguageCode(targetLang), cue.DurationMS) {
				skipped++
				continue
			}
			copy := *result[index]
			copy.TargetLanguageSentence = strings.TrimSpace(item.Target)
			result[index] = &copy
			applied++
		}
	}
	t.translationNotice(fmt.Sprintf("字幕时长压缩结束，已应用%d条，%d条保留原译文", applied, skipped))
	return result, nil
}
