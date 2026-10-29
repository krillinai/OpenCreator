package service

import (
	"strings"
	"testing"
)

func TestTranslationInputUsesAvailableResponseBudget(t *testing.T) {
	// A complete unpunctuated utterance that fits must not acquire an artificial seam at 800 bytes.
	text := strings.Repeat("we checked the address and requested a refund ", 21)
	if len(text) <= 800 || pairedTranslationResponseBudget(text, 60) > translationOutputBudget {
		t.Fatal("fixture must fit the response budget and exceed the former input cut")
	}
	parts, err := splitTranslationSentenceForBudget(text, translationSentenceBytes, 60)
	if err != nil || len(parts) != 1 || strings.TrimSpace(text) != parts[0] {
		t.Fatalf("unnecessary budget seam: %q err=%v", parts, err)
	}
}

func TestTranslationInputCutsStillRespectAllBudgets(t *testing.T) {
	for _, text := range []string{
		strings.Repeat("Please check No. 35 before sending it to J. R. Smith. ", 90),
		strings.Repeat("请先核对地址，不要改变退款金额。", 160),
		strings.Repeat("कृपया भेजने से पहले पता जाँचें। ", 100),
	} {
		for _, limit := range []int{20, 40, 50, 60, 100} {
			parts, err := splitTranslationSentenceForBudget(text, translationSentenceBytes, limit)
			if err != nil || len(parts) < 2 || !subtitleSegmentsPreserveText(text, parts) || !subtitleSegmentsHaveSafeBoundariesInText(text, parts) {
				t.Fatalf("unsafe budget split: limit=%d err=%v", limit, err)
			}
			for _, part := range parts {
				if len(part) > translationSentenceBytes || pairedTranslationResponseBudget(part, limit) > translationOutputBudget {
					t.Fatalf("input/response budget exceeded: limit=%d bytes=%d", limit, len(part))
				}
			}
			if _, err := buildPairedTranslationBatches(parts, "en", "zh_cn", limit, 3); err != nil {
				t.Fatalf("split text cannot be submitted: %v", err)
			}
		}
	}
}
