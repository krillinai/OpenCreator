package service

import (
	"context"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"strings"
	"testing"
)

func TestPairedTranslationRejectsInternalSpaceChanges(t *testing.T) {
	for _, tc := range []struct {
		language, original, changed string
	}{
		{"en", "Keep these words apart.", "Keep thesewords apart."},
		{"de", "Das ist nicht so.", "Das ist nichtso."},
		{"nn", "Dette er ikkje sant.", "Dette er ikkjesant."},
		{"ar", "هذا نص عربي.", "هذا نصعربي."},
		{"ta", "வணக்கம் உலகம்.", "வணக்கம்உலகம்."},
		{"th", "ภาษาไทย ทดสอบ", "ภาษาไทยทดสอบ"},
		{"en", "They live apart.", "They live a part."},
	} {
		t.Run(tc.language+"/"+tc.original, func(t *testing.T) {
			input := pairedTranslationInput{MaxTargetChars: 100, Sentences: []pairedTranslationSource{{ID: "1", Text: tc.original}}}
			translator := &Translator{}
			for _, source := range []string{tc.changed, tc.original} {
				response, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: "这是测试译文。", Source: []string{source}, Target: []string{"这是测试译文。"}}})
				if err != nil {
					t.Fatal(err)
				}
				_, err = translator.parsePairedTranslation(string(response), input, types.StandardLanguageCode(tc.language), "zh_cn")
				if source == tc.changed && err == nil {
					t.Fatalf("accepted source with altered word spaces: %q -> %q", tc.original, source)
				}
				if source == tc.original && err != nil {
					t.Fatalf("rejected preserved source: %v", err)
				}
			}
		})
	}
}

func TestPairedTranslationRejectsInternalTargetSpaceChanges(t *testing.T) {
	input := pairedTranslationInput{MaxTargetChars: 100, Sentences: []pairedTranslationSource{{ID: "1", Text: "保留词语间隔。"}}}
	response, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: "Keep these words apart.", Source: []string{"保留词语间隔。"}, Target: []string{"Keep thesewords apart."}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (&Translator{}).parsePairedTranslation(string(response), input, "zh_cn", "en"); err == nil {
		t.Fatal("accepted target segments that alter word spacing in the complete translation")
	}
}

func TestPairedTranslationRetriesAlteredSourceSpaces(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 2 && !strings.Contains(prompt, "原文覆盖错误") {
			t.Error("retry did not explain the source preservation error")
		}
		source := "Das ist nicht so."
		if calls == 1 {
			source = "Das ist nichtso."
		}
		data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: "事实并非如此。", Source: []string{source}, Target: []string{"事实并非如此。"}}})
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Das ist nicht so."}, "de", "zh_cn", 50, 1, nil)
	if err != nil || calls != 2 || len(result) != 1 || result[0].Source[0] != "Das ist nicht so." {
		t.Fatalf("source was not corrected: calls=%d result=%+v error=%v", calls, result, err)
	}
}
