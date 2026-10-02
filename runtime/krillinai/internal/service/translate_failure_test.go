package service

import (
	"errors"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"strings"
	"testing"
)

type failingTranslationCompleter struct{}

func (failingTranslationCompleter) ChatCompletion(string) (string, error) {
	return "", errors.New("local endpoint unavailable")
}

func TestSplitTextAndTranslateDoesNotReturnSourceAsTranslation(t *testing.T) {
	previous := config.Conf.App.MaxSentenceLength
	config.Conf.App.MaxSentenceLength = 100
	t.Cleanup(func() { config.Conf.App.MaxSentenceLength = previous })
	translator := &Translator{chatCompleter: failingTranslationCompleter{}}
	items, err := translator.SplitTextAndTranslate("今天天气很好。", types.LanguageNameSimplifiedChinese, types.LanguageNameEnglish)
	if err == nil || !strings.Contains(err.Error(), "local endpoint unavailable") || items != nil {
		t.Fatalf("translation = %v, %v; want provider failure", items, err)
	}
}
