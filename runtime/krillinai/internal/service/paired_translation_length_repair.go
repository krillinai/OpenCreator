package service

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"krillin-ai/pkg/util"
	"strconv"
	"strings"
)

//go:embed paired_translation_length_repair.txt
var pairedTranslationLengthRepairPrompt string

func longestPairedSegment(sentence pairedSentence) int {
	longest := 0
	for _, side := range [][]string{sentence.Source, sentence.Target} {
		for _, text := range side {
			longest = max(longest, subtitleTargetLength(text))
		}
	}
	return longest
}

// 修复只插入切口；不审核或重新生成已冻结的译文。
func validatePairedLengthRepair(item pairedTranslationOutputSentence, source pairedTranslationSource) (pairedSentence, error) {
	result := pairedSentence{ID: item.ID, FullSource: source.Text, FullTarget: source.TargetText}
	for _, segment := range item.Segments {
		result.Source = append(result.Source, segment.Source)
		result.Target = append(result.Target, segment.Target)
	}
	if item.ID != source.ID || len(item.Segments) < 2 {
		return result, fmt.Errorf("%s: return at least two segments under the supplied sentence_id", source.ID)
	}
	if item.FullTarget != "" && sourceTranslationChanged(source, item.FullTarget) || !pairedSentenceSegmentsValid(result, source.Text) {
		return result, fmt.Errorf("%s: preserve BOTH text and target_text completely, in order, with meaningful nonempty single-line pairs and intact graphemes", source.ID)
	}
	if longestPairedSegment(result) >= max(subtitleTargetLength(source.Text), subtitleTargetLength(source.TargetText)) {
		return result, fmt.Errorf("%s: split into shorter pairs; do not return the original overlong segment", source.ID)
	}
	return result, nil
}

// 每次只提交仍超长的配对。成功片段立即保留，失败片段不覆盖上一版，
// 同一原句仍共用原有请求预算和内容尝试次数。
func (t *Translator) repairPairedLengths(ctx context.Context, input pairedTranslationInput, source pairedTranslationSource, sentence pairedSentence, requests map[string]int, attempts int, save func(pairedSentence, bool) error) (pairedSentence, error) {
	acceptedLimit := subtitleAcceptedLimit(input.MaxTargetChars)
	feedback := ""
	outputFloor := 2048
	for attempt := 0; attempt < attempts && !pairedSentenceWithinLimit(sentence, input.MaxTargetChars); attempt++ {
		local := input
		local.Sentences = nil
		positions := make(map[string]int)
		maxTokens := 1024
		for i, text := range sentence.Source {
			if max(subtitleTargetLength(text), subtitleTargetLength(sentence.Target[i])) <= acceptedLimit {
				continue
			}
			pair := pairedTranslationSource{ID: source.ID + "." + strconv.Itoa(i+1), Text: text, TargetText: sentence.Target[i]}
			if i > 0 {
				pair.Before = []string{sentence.Source[i-1]}
			} else {
				pair.Before = source.Before
			}
			if i+1 < len(sentence.Source) {
				pair.After = []string{sentence.Source[i+1]}
			} else {
				pair.After = source.After
			}
			local.Sentences = append(local.Sentences, pair)
			estimate := pairedTranslationResponseBudget(text, input.MaxTargetChars) + len(pair.TargetText)
			payload, _ := json.Marshal(local)
			if len(payload)+len(pairedTranslationLengthRepairPrompt)+2000 > translationRequestBytes || maxTokens+estimate > 8192 {
				local.Sentences = local.Sentences[:len(local.Sentences)-1]
				break
			}
			positions[pair.ID] = i
			maxTokens += estimate
		}
		if len(local.Sentences) == 0 {
			break
		}
		payload, _ := json.Marshal(local)
		prompt := strings.NewReplacer("{{TARGET_CHARS}}", strconv.Itoa(input.MaxTargetChars), "{{ACCEPTED_CHARS}}", strconv.Itoa(acceptedLimit)).Replace(pairedTranslationLengthRepairPrompt)
		prompt += "\nInput JSON:\n" + string(payload) + feedback
		response, err := t.requestTranslation(ctx, prompt, max(outputFloor, maxTokens), []pairedTranslationSource{source}, requests)
		if err != nil {
			if ctx.Err() != nil {
				return sentence, ctx.Err()
			}
			if translationOutputError(err) {
				outputFloor = min(8192, max(outputFloor, maxTokens)*2)
				feedback = "\nPrevious response was truncated or empty. Return only the complete requested JSON."
				continue
			}
			break
		}
		var output pairedTranslationOutput
		if err := json.Unmarshal([]byte(util.ExtractJSONObject(response, "sentences")), &output); err != nil {
			feedback = "\nPrevious response was invalid JSON. Return the complete requested JSON."
			continue
		}
		items := make(map[string]pairedTranslationOutputSentence)
		duplicates := make(map[string]bool)
		for _, item := range output.Sentences {
			if _, exists := items[item.ID]; exists {
				duplicates[item.ID] = true
			}
			items[item.ID] = item
		}
		replacements := make(map[int]pairedSentence)
		var issues []string
		for _, pair := range local.Sentences {
			item, exists := items[pair.ID]
			if !exists || duplicates[pair.ID] {
				issues = append(issues, pair.ID+": missing or duplicate sentence_id")
				continue
			}
			repaired, err := validatePairedLengthRepair(item, pair)
			if err != nil {
				issues = append(issues, err.Error())
				continue
			}
			replacements[positions[pair.ID]] = repaired
		}
		if len(replacements) > 0 {
			next := sentence
			next.Source, next.Target = nil, nil
			for i := range sentence.Source {
				if repaired, ok := replacements[i]; ok {
					next.Source = append(next.Source, repaired.Source...)
					next.Target = append(next.Target, repaired.Target...)
				} else {
					next.Source = append(next.Source, sentence.Source[i])
					next.Target = append(next.Target, sentence.Target[i])
				}
			}
			next.LayoutFallback = !pairedSentenceWithinLimit(next, input.MaxTargetChars)
			if err := save(next, false); err != nil {
				return sentence, err
			}
			sentence = next
		}
		feedback = ""
		if len(issues) > 0 {
			feedback = "\nPrevious local validation issues:\n" + subtitleTextPreview(strings.Join(issues, "\n"), 1500)
		}
	}
	if !pairedSentenceWithinLimit(sentence, input.MaxTargetChars) {
		t.translationNotice(fmt.Sprintf("第%s句局部拆分未全部完成；已保留合格字幕和完整原译文，仅剩余超长对按单行交付", source.ID))
	}
	return sentence, nil
}
