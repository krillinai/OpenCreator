package service

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"krillin-ai/pkg/util"
	"strconv"
	"strings"

	"github.com/clipperhouse/uax29/v2/graphemes"
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

// mechanicallySplitPairedText is the last layout fallback after the complete
// translation has been frozen. It keeps both authoritative strings intact and
// cuts only at grapheme boundaries; natural phrase boundaries are deliberately
// not part of this fallback's contract.
func mechanicallySplitPairedText(source, target string, limit int) ([]pairedTranslationSegment, bool) {
	if limit < 1 || !hasSubtitleContent(source) || !hasSubtitleContent(target) {
		return nil, false
	}
	parts := max(2, max((subtitleTargetLength(source)+limit-1)/limit, (subtitleTargetLength(target)+limit-1)/limit))
	sources, ok := mechanicallySplitText(source, parts, limit)
	if !ok {
		return nil, false
	}
	targets, ok := mechanicallySplitText(target, parts, limit)
	if !ok {
		return nil, false
	}
	result := make([]pairedTranslationSegment, parts)
	for i := range result {
		result[i] = pairedTranslationSegment{Source: sources[i], Target: targets[i]}
	}
	return result, true
}

func mechanicallySplitText(text string, parts, limit int) ([]string, bool) {
	if parts < 2 {
		return nil, false
	}
	boundaries := []int{0}
	iter := graphemes.FromString(text)
	for iter.Next() {
		boundaries = append(boundaries, iter.End())
	}
	total := len(boundaries) - 1
	if total < parts || total > parts*limit {
		return nil, false
	}
	cuts := make([]int, parts+1)
	cuts[0], cuts[parts] = 0, total
	previous := 0
	for part := 1; part < parts; part++ {
		minimum := previous + 1
		maximum := total - (parts - part)
		desired := total * part / parts
		best := -1
		bestDistance := total + 1
		for candidate := minimum; candidate <= maximum; candidate++ {
			if candidate-previous > limit || !hasSubtitleContent(text[boundaries[previous]:boundaries[candidate]]) {
				continue
			}
			distance := candidate - desired
			if distance < 0 {
				distance = -distance
			}
			if distance < bestDistance {
				best, bestDistance = candidate, distance
			}
		}
		if best < 0 {
			return nil, false
		}
		cuts[part], previous = best, best
	}
	result := make([]string, parts)
	for i := range result {
		result[i] = text[boundaries[cuts[i]]:boundaries[cuts[i+1]]]
		if !hasSubtitleContent(result[i]) || subtitleTargetLength(result[i]) > limit {
			return nil, false
		}
	}
	return result, true
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
			t.translationNotice(fmt.Sprintf("第%s句局部拆分校验失败：%s", source.ID, subtitleTextPreview(strings.Join(issues, "\n"), 1500)))
			feedback = "\nPrevious local validation issues:\n" + subtitleTextPreview(strings.Join(issues, "\n"), 1500)
		}
	}
	if !pairedSentenceWithinLimit(sentence, input.MaxTargetChars) {
		mechanical := sentence
		mechanical.Source, mechanical.Target = nil, nil
		mechanicalApplied := false
		for i := range sentence.Source {
			if max(subtitleTargetLength(sentence.Source[i]), subtitleTargetLength(sentence.Target[i])) <= acceptedLimit {
				mechanical.Source = append(mechanical.Source, sentence.Source[i])
				mechanical.Target = append(mechanical.Target, sentence.Target[i])
				continue
			}
			parts, ok := mechanicallySplitPairedText(sentence.Source[i], sentence.Target[i], acceptedLimit)
			if !ok {
				mechanical.Source = append(mechanical.Source, sentence.Source[i])
				mechanical.Target = append(mechanical.Target, sentence.Target[i])
				continue
			}
			mechanicalApplied = true
			for _, part := range parts {
				mechanical.Source = append(mechanical.Source, part.Source)
				mechanical.Target = append(mechanical.Target, part.Target)
			}
		}
		if mechanicalApplied {
			mechanical.LayoutFallback = true
			if err := save(mechanical, false); err != nil {
				return sentence, err
			}
			sentence = mechanical
			t.translationNotice(fmt.Sprintf("第%s句模型拆分未通过硬校验，已按字素边界机械拆分；完整译文保留，语义质量降级", source.ID))
		}
	}
	if !pairedSentenceWithinLimit(sentence, input.MaxTargetChars) {
		t.translationNotice(fmt.Sprintf("第%s句局部拆分仍无法全部满足长度上限；已保留完整译文并按单行交付", source.ID))
	}
	return sentence, nil
}
