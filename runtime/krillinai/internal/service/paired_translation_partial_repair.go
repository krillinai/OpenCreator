package service

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"strconv"
	"strings"
)

type missingPairedTargetRegion struct {
	start int
	end   int
}

func pairedSegmentsEqual(left, right []pairedTranslationSegment) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func firstMissingPairedTargetRegion(segments []pairedTranslationSegment) (missingPairedTargetRegion, bool) {
	for i, segment := range segments {
		if !hasSubtitleContent(segment.Target) {
			region := missingPairedTargetRegion{start: i, end: i + 1}
			for region.end < len(segments) && !hasSubtitleContent(segments[region.end].Target) {
				region.end++
			}
			return region, true
		}
	}
	return missingPairedTargetRegion{}, false
}

func pairedSegmentsText(segments []pairedTranslationSegment) string {
	var text strings.Builder
	for _, segment := range segments {
		text.WriteString(segment.Source)
	}
	return text.String()
}

func pairedTargetsText(segments []pairedTranslationSegment) string {
	var text strings.Builder
	for _, segment := range segments {
		text.WriteString(segment.Target)
	}
	return text.String()
}

// requestMissingPairedRegion first preserves any target text already present
// in the neighboring pairs. If that target window is empty, it translates only
// the missing source window instead of redoing the complete sentence.
func (t *Translator) requestMissingPairedRegion(ctx context.Context, input pairedTranslationInput, source pairedTranslationSource, item pairedTranslationOutputSentence, region missingPairedTargetRegion, requests map[string]int, originLang, targetLang types.StandardLanguageCode) ([]pairedTranslationSegment, error) {
	windowStart := max(0, region.start-1)
	windowEnd := min(len(item.Segments), region.end+1)
	window := item.Segments[windowStart:windowEnd]
	windowSource := pairedSegmentsText(window)
	windowTarget := pairedTargetsText(window)
	id := source.ID + ".missing." + strconv.Itoa(windowStart+1)

	local := input
	local.Sentences = []pairedTranslationSource{{ID: id, Text: windowSource}}
	if windowTarget != "" {
		local.Sentences[0].TargetText = windowTarget
	}
	if windowStart > 0 {
		local.Sentences[0].Before = []string{item.Segments[windowStart-1].Source}
	} else {
		local.Sentences[0].Before = source.Before
	}
	if windowEnd < len(item.Segments) {
		local.Sentences[0].After = []string{item.Segments[windowEnd].Source}
	} else {
		local.Sentences[0].After = source.After
	}

	maxTokens := max(2048, 1024+pairedTranslationResponseBudget(windowSource, local.MaxTargetChars))
	response, err := t.requestTranslation(ctx, t.pairedPrompt(local), min(8192, maxTokens), []pairedTranslationSource{source}, requests)
	if err != nil {
		return nil, err
	}
	var output pairedTranslationOutput
	if err := json.Unmarshal([]byte(util.ExtractJSONObject(response, "sentences")), &output); err != nil {
		return nil, fmt.Errorf("%s: invalid local target repair JSON: %w", source.ID, err)
	}
	if len(output.Sentences) != 1 || output.Sentences[0].ID != id {
		return nil, fmt.Errorf("%s: local target repair returned an unexpected sentence_id", source.ID)
	}
	data, _ := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{output.Sentences[0]}})
	parsed, err := t.parsePairedTranslation(string(data), local, originLang, targetLang)
	if err != nil || len(parsed) != 1 {
		if err == nil {
			err = fmt.Errorf("local target repair returned no sentence")
		}
		return nil, err
	}
	result := make([]pairedTranslationSegment, len(parsed[0].Source))
	for i := range result {
		result[i] = pairedTranslationSegment{Source: parsed[0].Source[i], Target: parsed[0].Target[i]}
	}
	return result, nil
}

// repairMissingPairedTargets repairs only a missing target region. Existing
// neighboring targets are treated as authoritative for the local window so a
// model that shifted meaning across a boundary cannot cause duplicate text.
func (t *Translator) repairMissingPairedTargets(ctx context.Context, input pairedTranslationInput, source pairedTranslationSource, item pairedTranslationOutputSentence, requests map[string]int, originLang, targetLang types.StandardLanguageCode) (pairedTranslationOutputSentence, error) {
	if len(item.Segments) == 0 {
		return item, fmt.Errorf("%s: missing-target repair requires segments", source.ID)
	}
	var sourceParts []string
	for i, segment := range item.Segments {
		if segment.Source == "" || hasSubtitleLineBreak(segment.Source) {
			return item, fmt.Errorf("%s: invalid source segment at %d", source.ID, i+1)
		}
		sourceParts = append(sourceParts, segment.Source)
	}
	if !subtitleSegmentsPreserveText(source.Text, sourceParts) || !subtitleSegmentsHaveSafeBoundariesInText(source.Text, sourceParts) {
		return item, fmt.Errorf("%s: source coverage is not safe for local target repair", source.ID)
	}

	for {
		region, exists := firstMissingPairedTargetRegion(item.Segments)
		if !exists {
			item.FullTarget = ""
			return completePairedTranslationTarget(item), nil
		}
		repaired, err := t.requestMissingPairedRegion(ctx, input, source, item, region, requests, originLang, targetLang)
		if err != nil {
			return item, err
		}
		windowStart := max(0, region.start-1)
		windowEnd := min(len(item.Segments), region.end+1)
		merged := make([]pairedTranslationSegment, 0, len(item.Segments)-windowEnd+windowStart+len(repaired))
		merged = append(merged, item.Segments[:windowStart]...)
		merged = append(merged, repaired...)
		merged = append(merged, item.Segments[windowEnd:]...)
		if pairedSegmentsEqual(item.Segments, merged) {
			return item, fmt.Errorf("%s: local target repair made no progress", source.ID)
		}
		item.Segments = merged
		item.FullTarget = ""
	}
}
