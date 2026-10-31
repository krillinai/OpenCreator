package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
)

type naturalizeTestCompleter struct {
	naturalize func() string
	shorten    func() string
}

func (c naturalizeTestCompleter) ChatCompletion(prompt string) (string, error) {
	return c.complete(context.Background(), prompt)
}

func (c naturalizeTestCompleter) ChatCompletionContext(ctx context.Context, prompt string) (string, error) {
	return c.complete(ctx, prompt)
}

func (c naturalizeTestCompleter) ChatCompletionContextWithMaxTokens(ctx context.Context, prompt string, _ int) (string, error) {
	return c.complete(ctx, prompt)
}

func (c naturalizeTestCompleter) complete(_ context.Context, prompt string) (string, error) {
	if strings.HasPrefix(prompt, translationNaturalizePrompt) {
		return c.naturalize(), nil
	}
	if strings.HasPrefix(prompt, translationShorteningPrompt) {
		return c.shorten(), nil
	}
	if strings.HasPrefix(prompt, "Create short, aligned bilingual") {
		var input pairedTranslationInput
		_, payload, _ := strings.Cut(prompt, "Input JSON:\n")
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			return "", err
		}
		row := input.Sentences[0]
		return `{"sentences":[{"sentence_id":"` + row.ID + `","target_text":"` + row.TargetText + `","segments":[{"source":"` + row.Text + `","target":"` + row.TargetText + `"}]}]}`, nil
	}
	return `{"sentences":[]}`, nil
}

func TestNaturalizePairedSentencesReusesPairedLayoutAndPersists(t *testing.T) {
	completer := naturalizeTestCompleter{naturalize: func() string {
		return `{"sentences":[{"sentence_id":"1","target_text":"我们看看这个。"}]}`
	}}
	translator := &Translator{chatCompleter: completer, naturalizeEnabled: true}
	original := pairedSentence{ID: "1", FullSource: "We need to look at this.", FullTarget: "我们需要去看一下这个。", Source: []string{"We need to look at this."}, Target: []string{"我们需要去看一下这个。"}}
	var saved pairedSentence
	result, err := translator.naturalizePairedSentences(context.Background(), []pairedSentence{original}, "en", types.LanguageNameSimplifiedChinese, 60, func(sentence pairedSentence) error {
		saved = sentence
		return nil
	})
	if err != nil || len(result) != 1 || result[0].FullTarget != "我们看看这个。" || len(result[0].Target) != 1 || !result[0].Naturalized {
		t.Fatalf("自然化或重新分段失败: %+v error=%v", result, err)
	}
	if saved.FullTarget != result[0].FullTarget || !saved.Naturalized {
		t.Fatalf("自然化结果没有保存: %+v", saved)
	}
}

func TestNaturalizedTargetRejectsGlossaryLoss(t *testing.T) {
	translator := &Translator{}
	terms := []translationTerm{{Source: "machine learning", Target: "机器学习", Note: "技术"}}
	if naturalizedTargetValid(translator, "machine learning matters", "机器学习很重要。", "这个很重要。", "en", "zh_cn", terms) {
		t.Fatal("自然化不应删除忠实译文中的术语")
	}
}

func TestShortenTimedSubtitleBlocksPreservesCriticalTokens(t *testing.T) {
	completer := naturalizeTestCompleter{shorten: func() string {
		return `{"cues":[{"cue_id":"0","target_text":"今天分析这个问题。"}]}`
	}}
	translator := &Translator{chatCompleter: completer}
	blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:01,000", OriginLanguageSentence: "We need to carefully analyze this complex problem today.", TargetLanguageSentence: "我们今天需要仔细地分析这个复杂的问题。"}}
	result, err := translator.shortenTimedSubtitleBlocks(context.Background(), blocks, "en", "zh_cn")
	if err != nil || result[0].TargetLanguageSentence != "今天分析这个问题。" {
		t.Fatalf("时长压缩未应用: %+v error=%v", result, err)
	}

	completer.shorten = func() string {
		return `{"cues":[{"cue_id":"0","target_text":"这项测试需要三公里。"}]}`
	}
	protected := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:01,000", OriginLanguageSentence: "This test needs 3K.", TargetLanguageSentence: "这项测试需要3K。"}}
	result, err = translator.shortenTimedSubtitleBlocks(context.Background(), protected, "en", "zh_cn")
	if err != nil || result[0].TargetLanguageSentence != protected[0].TargetLanguageSentence {
		t.Fatalf("时长压缩不应删除数字术语: %+v error=%v", result, err)
	}
}
