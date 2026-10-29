package service

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestSemanticCorrectionLayoutRetriesWithoutChangingFrozenTranslation(t *testing.T) {
	tc := semanticReviewDeliveryCases()[0]
	for _, mode := range []string{"retry_success", "bad_json", "overlong", "rewritten_target", "line_break", "network_error"} {
		t.Run(mode, func(t *testing.T) {
			original := pairedSentence{ID: "1", FullSource: tc.source, FullTarget: tc.previous}
			for _, part := range tc.segments {
				original.Source = append(original.Source, part.Source)
				original.Target = append(original.Target, part.Target)
			}
			reviewCalls, layoutCalls, saves := 0, 0, 0
			translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(ctx context.Context, prompt string) (string, error) {
				if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
					reviewCalls++
					return semanticReviewTestResponse(semanticCorrection{
						pairedTranslationOutputSentence: pairedTranslationOutputSentence{ID: "1", FullTarget: tc.corrected},
						OriginalTarget:                  tc.previous, Kind: "meaning", SourceQuote: tc.quote, Reason: "The negation is missing.",
					}), nil
				}
				layoutCalls++
				input, err := decodePairedTestInput(prompt)
				if err != nil || len(input.Sentences) != 1 || input.Sentences[0].Text != tc.source || input.Sentences[0].TargetText != tc.corrected {
					t.Fatalf("layout retry changed the source or frozen target: %+v err=%v", input, err)
				}
				if layoutCalls > 1 && !strings.Contains(prompt, "The previous response failed local validation") {
					t.Fatal("layout retry did not include validation feedback")
				}
				parts := append([]pairedTranslationSegment(nil), tc.correctedSegments...)
				switch mode {
				case "retry_success":
					if layoutCalls < 3 {
						return "not-json", nil
					}
				case "bad_json":
					return "not-json", nil
				case "overlong":
					parts = []pairedTranslationSegment{{Source: tc.source, Target: tc.corrected}}
				case "rewritten_target":
					parts[0].Target = "这些变化会在今天发生，"
				case "line_break":
					parts[0].Target = "这些变化不会\n在今天发生，"
				case "network_error":
					return "", errors.New("connection failure")
				}
				data, err := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: "1", Segments: parts}}})
				return string(data), err
			})}
			result, err := translator.reviewPairedSemanticErrors(context.Background(), []pairedSentence{original}, tc.originLang, tc.targetLang, 60, func(pairedSentence) error { saves++; return nil })
			wantCalls := 3
			if mode == "network_error" {
				wantCalls = 1
			}
			if err != nil || reviewCalls != 1 || layoutCalls != wantCalls || len(result) != 1 {
				t.Fatalf("unbounded layout recovery or failed delivery: reviews=%d layouts=%d result=%+v err=%v", reviewCalls, layoutCalls, result, err)
			}
			if mode == "retry_success" {
				if saves != 1 || result[0].FullTarget != tc.corrected || result[0].LayoutFallback || len(result[0].Source) != 2 {
					t.Fatalf("valid final repair was not accepted: %+v saves=%d", result, saves)
				}
			} else if saves != 0 || !reflect.DeepEqual(result[0], original) {
				t.Fatalf("failed layout replaced the existing paired subtitles: %+v saves=%d", result, saves)
			}
		})
	}
}

func TestSemanticCorrectionLayoutHonorsUserCancellation(t *testing.T) {
	tc := semanticReviewDeliveryCases()[0]
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(_ context.Context, prompt string) (string, error) {
		if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
			return semanticReviewTestResponse(semanticCorrection{
				pairedTranslationOutputSentence: pairedTranslationOutputSentence{ID: "1", FullTarget: tc.corrected},
				OriginalTarget:                  tc.previous, Kind: "meaning", SourceQuote: tc.quote, Reason: "The negation is missing.",
			}), nil
		}
		cancel()
		return "", ctx.Err()
	})}
	_, err := translator.reviewPairedSemanticErrors(ctx, []pairedSentence{{ID: "1", FullSource: tc.source, FullTarget: tc.previous}}, tc.originLang, tc.targetLang, 60, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("layout recovery ignored user cancellation: %v", err)
	}
}
