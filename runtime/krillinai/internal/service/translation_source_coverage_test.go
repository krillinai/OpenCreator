package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestTranslationUncoveredSourceDoesNotFreezeDerivedTarget(t *testing.T) {
	const source = "She did not agree and asked for a refund."
	const corrected = "她没有同意，并要求退款。"
	for _, tc := range []struct {
		name     string
		segments []pairedTranslationSegment
	}{
		{"omitted_source", []pairedTranslationSegment{{Source: "She did not agree", Target: "她没有同意。"}}},
		{"duplicated_source", []pairedTranslationSegment{{Source: source, Target: corrected}, {Source: source, Target: corrected}}},
		{"reordered_source", []pairedTranslationSegment{{Source: "and asked for a refund.", Target: "并要求退款，"}, {Source: "She did not agree", Target: "她没有同意。"}}},
		{"rewritten_source", []pairedTranslationSegment{{Source: "She agreed and asked for a refund.", Target: "她同意了，并要求退款。"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls, frozen := 0, false
			translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				segments := tc.segments
				if calls > 1 {
					frozen = frozen || input.Sentences[0].TargetText != ""
					segments = []pairedTranslationSegment{{Source: source, Target: corrected}}
				}
				data, err := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: "1", Segments: segments}}})
				return string(data), err
			})}
			result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 60, 1, nil)
			if err != nil || frozen || calls != 2 || len(result) != 1 || result[0].FullTarget != corrected || result[0].Untranslated {
				t.Fatalf("源覆盖错误使不可信译文被锁定: calls=%d frozen=%t result=%+v err=%v", calls, frozen, result, err)
			}
			checkpoint, err := translator.openTranslationCheckpoint([]string{source}, "en", "zh_cn")
			if err != nil || checkpoint.sentences["1"].FullTarget != corrected {
				t.Fatalf("检查点未保存完整重译: %+v err=%v", checkpoint, err)
			}
		})
	}
}

func TestTranslationUncoveredSourceExhaustionIsMarkedUntranslated(t *testing.T) {
	const source = "She did not agree and asked for a refund."
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		return `{"sentences":[{"sentence_id":"1","segments":[{"source":"She did not agree","target":"她没有同意。"}]}]}`, nil
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 60, 1, nil)
	if err != nil || calls != 4 || len(result) != 1 || !result[0].Untranslated || !strings.Contains(result[0].FullTarget, source) {
		t.Fatalf("不完整译文被冒充完整成功或阻止交付: calls=%d result=%+v err=%v", calls, result, err)
	}
}

func TestTranslationCoveredDerivedTargetStillFreezesForLayout(t *testing.T) {
	const source = "She did not agree and asked for a refund."
	target := "她没有同意，并要求退款。" + strings.Repeat("这是完整的有效译文。", 6)
	calls, frozen := 0, false
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if calls > 1 {
			frozen = input.Sentences[0].TargetText == target
		}
		data, err := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: "1", Segments: []pairedTranslationSegment{{Source: source, Target: target}}}}})
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 60, 1, nil)
	if err != nil || calls != 3 || !frozen || len(result) != 1 || result[0].FullTarget != target || !result[0].LayoutFallback {
		t.Fatalf("有效完整译文因排版失败被重译或丢弃: calls=%d frozen=%t result=%+v err=%v", calls, frozen, result, err)
	}
}
