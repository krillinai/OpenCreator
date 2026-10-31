package service

import (
	"context"
	"encoding/json"
	"errors"
	"krillin-ai/config"
	"strings"
	"testing"
)

func TestTranslationTerminologyCarriesAcrossDistantBatches(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	texts := []string{
		"3K means three kilometers in this race.",
		"Take a short break.",
		"We will run another 3K tomorrow.",
	}
	targets := map[string]string{
		texts[0]: "这场比赛中的3K指三公里。",
		texts[1]: "稍作休息。",
		texts[2]: "明天我们还要再跑一个三公里。",
	}
	extractions, translations, reviews := 0, 0, 0
	translator := &Translator{terminologyEnabled: true, checkpointDir: t.TempDir(), chatCompleter: budgetedTranslationTestCompleter{
		complete: func(_ context.Context, prompt string, _ int) (string, error) {
			if strings.HasPrefix(prompt, translationTerminologyPrompt) {
				extractions++
				return `{"terms":[{"src":"3K","tgt":"三公里","note":"running distance, not steps"}]}`, nil
			}
			if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
				reviews++
				var input semanticReviewInput
				_, payload, _ := strings.Cut(prompt, "Input JSON:\n")
				if err := json.Unmarshal([]byte(payload), &input); err != nil || len(input.Terminology) != 1 || input.Terminology[0].Target != "三公里" {
					t.Errorf("semantic review lost the glossary: %+v, %v", input, err)
				}
				return `{"corrections":[]}`, nil
			}
			input, err := decodePairedTestInput(prompt)
			if err != nil {
				return "", err
			}
			translations++
			for _, sentence := range input.Sentences {
				wantTerm := strings.Contains(sentence.Text, "3K")
				if gotTerm := len(input.Terminology) == 1 && input.Terminology[0].Target == "三公里"; gotTerm != wantTerm {
					t.Errorf("wrong terms for %q: %+v", sentence.Text, input.Terminology)
				}
			}
			var output pairedTranslationOutput
			for _, sentence := range input.Sentences {
				output.Sentences = append(output.Sentences, pairedTranslationOutputSentence{
					ID: sentence.ID, Segments: []pairedTranslationSegment{{Source: sentence.Text, Target: targets[sentence.Text]}},
				})
			}
			data, err := json.Marshal(output)
			return string(data), err
		},
	}}
	for run := 0; run < 2; run++ {
		result, err := translator.translatePairedSentences(context.Background(), texts, "en", "zh_cn", 80, 1, nil)
		if err != nil || len(result) != 3 || result[0].FullTarget != targets[texts[0]] || result[2].FullTarget != targets[texts[2]] {
			t.Fatalf("run %d: glossary translation failed: %+v, %v", run, result, err)
		}
	}
	// The second run restores the completed sentences and the risk-only
	// reviewer skips the same already-valid cues instead of paying for another
	// full-document review.
	if extractions != 1 || translations != 3 || reviews != 1 {
		t.Fatalf("resume changed the glossary or repeated translation: extractions=%d translations=%d reviews=%d", extractions, translations, reviews)
	}
}

func TestTranslationTerminologyRejectsConflictsAndUnknownTerms(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	texts := make([]string, 18)
	for i := range texts {
		texts[i] = strings.Repeat("training ", 100) + "3K means distance."
	}
	if len(terminologyChunks(texts)) < 2 {
		t.Fatal("fixture must cover multiple extraction chunks")
	}
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		if calls == 1 {
			return `{"terms":[{"src":"3K","tgt":"三公里","note":"running distance"},{"src":"missing","tgt":"虚构","note":"not in source"}]}`, nil
		}
		return `{"terms":[{"src":"3K","tgt":"三千步","note":"step count"}]}`, nil
	})}
	terms, err := translator.extractTranslationTerminology(context.Background(), texts, "en", "zh_cn")
	if err != nil || len(terms) != 0 {
		t.Fatalf("conflicting or absent terms survived: %+v, %v", terms, err)
	}
	if !translationTermOccurs("another 3k tomorrow", "3K") || translationTermOccurs("13K and 3KB", "3K") {
		t.Fatal("term matching lost case folding or token boundaries")
	}
}

func TestTranslationTerminologyFailureIsFrozenForRecovery(t *testing.T) {
	dir := t.TempDir()
	texts := []string{"The 3K race starts now."}
	requests := 0
	translator := &Translator{terminologyEnabled: true, checkpointDir: dir, chatCompleter: budgetedTranslationTestCompleter{
		complete: func(context.Context, string, int) (string, error) {
			requests++
			return "", errors.New("model unavailable")
		},
	}}
	terms, err := translator.translationTerminology(context.Background(), texts, "en", "zh_cn")
	if err != nil || len(terms) != 0 || requests != 1 {
		t.Fatalf("extraction failure blocked translation: terms=%+v calls=%d err=%v", terms, requests, err)
	}
	translator.chatCompleter = budgetedTranslationTestCompleter{
		complete: func(context.Context, string, int) (string, error) {
			requests++
			return `{"terms":[{"src":"3K","tgt":"三公里","note":"distance"}]}`, nil
		},
	}
	terms, err = translator.translationTerminology(context.Background(), texts, "en", "zh_cn")
	if err != nil || len(terms) != 0 || requests != 1 {
		t.Fatalf("resume unexpectedly regenerated terms: terms=%+v calls=%d err=%v", terms, requests, err)
	}
	first, err := translator.openTranslationCheckpoint(texts, "en", "zh_cn", translationTerm{"3K", "三公里", "distance"})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.save(pairedSentence{ID: "1", FullSource: texts[0], FullTarget: "三公里比赛开始了。", Source: texts, Target: []string{"三公里比赛开始了。"}}); err != nil {
		t.Fatal(err)
	}
	changed, err := translator.openTranslationCheckpoint(texts, "en", "zh_cn", translationTerm{"3K", "三千步", "steps"})
	if err != nil || len(changed.sentences) != 0 {
		t.Fatalf("changed glossary reused old translation: %+v, %v", changed.sentences, err)
	}
}
