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

	"golang.org/x/sync/errgroup"
)

//go:embed translation_semantic_review.txt
var translationSemanticReviewPrompt string

const semanticReviewRequestBytes = 24000

func (t *Translator) requestSemanticReview(ctx context.Context, prompt string) (string, error) {
	if client, ok := t.chatCompleter.(budgetedChatCompleter); ok {
		return client.ChatCompletionContextWithMaxTokens(ctx, prompt, 4096)
	}
	if client, ok := t.chatCompleter.(contextChatCompleter); ok {
		return client.ChatCompletionContext(ctx, prompt)
	}
	return "", fmt.Errorf("语义检查需要支持上下文取消的模型接口")
}

type semanticReviewSource struct {
	ID     string `json:"sentence_id"`
	Source string `json:"source_text"`
	Target string `json:"target_text"`
}

type semanticReviewInput struct {
	SourceLanguage string                 `json:"source_language"`
	TargetLanguage string                 `json:"target_language"`
	Limit          int                    `json:"max_characters"`
	Before         []semanticReviewSource `json:"context_before,omitempty"`
	Sentences      []semanticReviewSource `json:"sentences"`
	After          []semanticReviewSource `json:"context_after,omitempty"`
}

type semanticCorrection struct {
	pairedTranslationOutputSentence
	OriginalTarget string `json:"original_target"`
	Kind           string `json:"kind"`
	SourceQuote    string `json:"source_quote"`
	Reason         string `json:"reason"`
}

// 语义修正后的译文已冻结；复用现有配对 Prompt，仅恢复切分，不重新翻译。
// 最多三次请求，并与本轮审核共用超时预算；失败时由调用方保留原有字幕。
func (t *Translator) segmentSemanticCorrection(ctx context.Context, input pairedTranslationInput, originLang, targetLang types.StandardLanguageCode) (pairedSentence, bool) {
	feedback := ""
	maxTokens := min(8192, max(2048, 1024+pairedTranslationResponseBudget(input.Sentences[0].Text, input.MaxTargetChars)))
	for attempt := 0; attempt < 3 && ctx.Err() == nil; attempt++ {
		prompt := t.pairedPrompt(input) + feedback
		var response string
		var err error
		if client, ok := t.chatCompleter.(budgetedChatCompleter); ok {
			response, err = client.ChatCompletionContextWithMaxTokens(ctx, prompt, maxTokens)
		} else {
			response, err = chatCompletionWithContext(ctx, t.chatCompleter, prompt)
		}
		if err != nil || ctx.Err() != nil {
			return pairedSentence{}, false
		}
		parsed, err := t.parsePairedTranslation(response, input, originLang, targetLang)
		if err == nil {
			return parsed[0], true
		}
		feedback = "\n\n" + strings.NewReplacer(
			"{{ISSUES}}", subtitleTextPreview(err.Error(), 3500),
			"{{PREVIOUS_RESPONSE}}", subtitleTextPreview(response, 1000),
			"{{MAX_TARGET_CHARS}}", fmt.Sprint(input.MaxTargetChars),
		).Replace(pairedTranslationRetry)
	}
	return pairedSentence{}, false
}

func semanticReviewBatches(sentences []pairedSentence, originLang, targetLang types.StandardLanguageCode, limit int) []semanticReviewInput {
	rows := make([]semanticReviewSource, len(sentences))
	for i, sentence := range sentences {
		rows[i] = semanticReviewSource{sentence.ID, sentence.FullSource, sentence.FullTarget}
	}
	var batches []semanticReviewInput
	for start := 0; start < len(rows); {
		input := semanticReviewInput{SourceLanguage: types.GetStandardLanguageName(originLang), TargetLanguage: types.GetStandardLanguageName(targetLang), Limit: limit}
		input.Before = rows[max(0, start-2):start]
		end := start
		for end < len(rows) {
			input.Sentences = append(input.Sentences, rows[end])
			input.After = rows[end+1 : min(len(rows), end+3)]
			payload, _ := json.Marshal(input)
			if len(payload)+len(translationSemanticReviewPrompt) > semanticReviewRequestBytes {
				input.Sentences = input.Sentences[:len(input.Sentences)-1]
				input.After = rows[end:min(len(rows), end+2)]
				break
			}
			end++
		}
		if len(input.Sentences) > 0 {
			batches = append(batches, input)
		}
		// 异常扩写的单句也不能阻止交付或制造超预算审核请求。
		start = max(start+1, end)
	}
	return batches
}

// 审核是一次有上限的改进；不复用翻译重试链，所有失败均保留已经完成的字幕。
func (t *Translator) reviewPairedSemanticErrors(ctx context.Context, sentences []pairedSentence, originLang, targetLang types.StandardLanguageCode, limit int, persist func(pairedSentence) error) ([]pairedSentence, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// 没有上下文接口的第三方实现无法保证超时，跳过可选审核。
	_, hasBudget := t.chatCompleter.(budgetedChatCompleter)
	_, hasContext := t.chatCompleter.(contextChatCompleter)
	if !hasBudget && !hasContext || len(sentences) == 0 || originLang == targetLang {
		return sentences, nil
	}
	var eligible []pairedSentence
	for _, sentence := range sentences {
		if !sentence.Untranslated {
			eligible = append(eligible, sentence)
		}
	}
	batches := semanticReviewBatches(eligible, originLang, targetLang, limit)
	if len(batches) == 0 {
		return sentences, nil
	}
	t.translationNotice("译文已生成，正在限时检查必要的语义错误")
	reviewCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	responses := make([]string, len(batches))
	requestErrors := make([]error, len(batches))
	var group errgroup.Group
	group.SetLimit(translationParallelism())
	for i, input := range batches {
		group.Go(func() error {
			if err := reviewCtx.Err(); err != nil {
				requestErrors[i] = err
				return nil
			}
			payload, _ := json.Marshal(input)
			prompt := translationSemanticReviewPrompt + "\nInput JSON:\n" + string(payload)
			responses[i], requestErrors[i] = t.requestSemanticReview(reviewCtx, prompt)
			return nil
		})
	}
	_ = group.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result := append([]pairedSentence(nil), sentences...)
	indices := make(map[string]int, len(result))
	for i, sentence := range result {
		indices[sentence.ID] = i
	}
	applied, skipped := 0, 0
	type pendingCorrection struct {
		index      int
		correction semanticCorrection
		input      pairedTranslationInput
		result     pairedSentence
		accepted   bool
	}
	var pending []pendingCorrection
	for i, input := range batches {
		var output struct {
			Corrections *[]semanticCorrection `json:"corrections"`
		}
		if requestErrors[i] != nil || json.Unmarshal([]byte(util.ExtractJSONObject(responses[i], "corrections")), &output) != nil || output.Corrections == nil {
			skipped++
			continue
		}
		allowed := make(map[string]bool, len(input.Sentences))
		for _, row := range input.Sentences {
			allowed[row.ID] = true
		}
		counts := make(map[string]int)
		for _, correction := range *output.Corrections {
			counts[correction.ID]++
		}
		for _, correction := range *output.Corrections {
			index, exists := indices[correction.ID]
			if !exists || !allowed[correction.ID] || counts[correction.ID] != 1 {
				continue
			}
			original := result[index]
			if original.Untranslated || correction.OriginalTarget != original.FullTarget ||
				strings.TrimSpace(correction.Reason) == "" || strings.TrimSpace(correction.SourceQuote) == "" || !strings.Contains(original.FullSource, correction.SourceQuote) ||
				(correction.Kind != "meaning" && correction.Kind != "omission" && correction.Kind != "addition") ||
				subtitleSegmentsPreserveText(original.FullTarget, []string{correction.FullTarget}) {
				continue
			}
			if !hasSubtitleContent(correction.FullTarget) || hasSubtitleLineBreak(correction.FullTarget) ||
				!t.isTranslationValid(original.FullSource, correction.FullTarget, originLang, targetLang) {
				continue
			}
			correction.Segments = []pairedTranslationSegment{{Source: original.FullSource, Target: correction.FullTarget}}
			validation := pairedTranslationInput{SourceLanguage: types.GetStandardLanguageName(originLang), TargetLanguage: types.GetStandardLanguageName(targetLang), MaxSourceChars: limit, MaxTargetChars: limit, MaxFullwidthChars: limit / 2, Sentences: []pairedTranslationSource{{ID: original.ID, Text: original.FullSource, TargetText: correction.FullTarget}}}
			pending = append(pending, pendingCorrection{index: index, correction: correction, input: validation})
		}
	}
	var layoutGroup errgroup.Group
	layoutGroup.SetLimit(translationParallelism())
	for i := range pending {
		layoutGroup.Go(func() error {
			item := &pending[i]
			if subtitleTargetLength(item.input.Sentences[0].Text) > limit || subtitleTargetLength(item.correction.FullTarget) > limit {
				item.result, item.accepted = t.segmentSemanticCorrection(reviewCtx, item.input, originLang, targetLang)
			} else {
				data, _ := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{item.correction.pairedTranslationOutputSentence}})
				parsed, err := t.parsePairedTranslation(string(data), item.input, originLang, targetLang)
				if err == nil {
					item.result, item.accepted = parsed[0], true
				}
			}
			return nil
		})
	}
	_ = layoutGroup.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, item := range pending {
		if !item.accepted {
			t.translationNotice(fmt.Sprintf("第%s句语义修正后的分段未通过，已保留此前完整字幕；不使用换行兜底", item.correction.ID))
			continue
		}
		if persist != nil {
			if err := persist(item.result); err != nil {
				t.translationNotice("语义修正未能保存，已保留此前完整译文")
				continue
			}
		}
		result[item.index] = item.result
		applied++
		t.translationNotice(fmt.Sprintf("第%s句已修正语义错误：%s", item.correction.ID, subtitleTextPreview(item.correction.Reason, 200)))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	t.translationNotice(fmt.Sprintf("必要语义检查结束，已修正%d句，%d个窗口未取得有效审核结果；其余译文保留", applied, skipped))
	return result, nil
}
