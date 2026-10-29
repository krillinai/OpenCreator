package service

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

func TestTranslatorSplitOriginLongSentenceToleratesLLMNoise(t *testing.T) {
	log.InitLogger()
	tests := []struct {
		name     string
		response string
	}{
		{
			name:     "尾随逗号",
			response: "{\n\"short_sentences\":[{\n\"text\": \"And the reason why they chose the owl is because\",\n},\n{\n\"text\": \"the owl is a symbol used in Europe\",\n}] \n}",
		},
		{
			name:     "中文对话式前缀",
			response: "以下是分割后的结果：\n\n\n{\n  \"short_sentences\": [\n    { \"text\": \"And the reason why they chose the owl is because\" },\n    { \"text\": \"the owl is a symbol used in Europe\" }\n  ]\n}\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			completer := &scriptedCompleter{responses: []string{tt.response}}
			translator := &Translator{chatCompleter: completer}

			sentences, err := translator.splitOriginLongSentence("And the reason why they chose the owl is because the owl is a symbol used in Europe")
			if err != nil {
				t.Fatalf("splitOriginLongSentence() error = %v, want nil", err)
			}
			if completer.calls != 1 {
				t.Fatalf("ChatCompletion 调用次数 = %d, want 1（无需重试）", completer.calls)
			}
			want := []string{
				"And the reason why they chose the owl is because",
				"the owl is a symbol used in Europe",
			}
			if fmt.Sprint(sentences) != fmt.Sprint(want) {
				t.Fatalf("sentences = %v, want %v", sentences, want)
			}
		})
	}
}

func TestBatchTranslateTextsToleratesConversationalPrefix(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		"好的，以下是翻译结果：\n\n```json\n{\n  \"translations\": [\n    { \"index\": 1, \"text\": \"第一句\" },\n    { \"index\": 2, \"text\": \"第二句\" },\n  ]\n}\n```",
	}}
	translator := &Translator{chatCompleter: completer}

	translations, err := translator.batchTranslateTexts(
		[]string{"first sentence", "second sentence"},
		types.StandardLanguageCode("en"),
		types.StandardLanguageCode("zh_cn"),
	)
	if err != nil {
		t.Fatalf("batchTranslateTexts() error = %v, want nil", err)
	}
	if completer.calls != 1 {
		t.Fatalf("ChatCompletion 调用次数 = %d, want 1（无需重试）", completer.calls)
	}
	want := []string{"第一句", "第二句"}
	if fmt.Sprint(translations) != fmt.Sprint(want) {
		t.Fatalf("translations = %v, want %v", translations, want)
	}
}

func TestTranslatorSplitOriginLongSentenceRejectsDecoyObject(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		"请按如下格式输出：{}\n{\n  \"short_sentences\": [\n    { \"text\": \"And the reason why they chose the owl is because\" },\n    { \"text\": \"the owl is a symbol used in Europe\" }\n  ]\n}",
	}}
	translator := &Translator{chatCompleter: completer}

	sentences, err := translator.splitOriginLongSentence("And the reason why they chose the owl is because the owl is a symbol used in Europe")
	if err != nil {
		t.Fatalf("splitOriginLongSentence() error = %v, want nil", err)
	}
	if completer.calls != 1 {
		t.Fatalf("ChatCompletion 调用次数 = %d, want 1（无需重试）", completer.calls)
	}
	want := []string{
		"And the reason why they chose the owl is because",
		"the owl is a symbol used in Europe",
	}
	if fmt.Sprint(sentences) != fmt.Sprint(want) {
		t.Fatalf("sentences = %v, want %v", sentences, want)
	}
}

func TestBatchTranslateTextsRejectsDecoyObject(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		"输出格式示例：{}\n```json\n{\n  \"translations\": [\n    { \"index\": 1, \"text\": \"第一句\" },\n    { \"index\": 2, \"text\": \"第二句\" },\n  ]\n}\n```",
	}}
	translator := &Translator{chatCompleter: completer}

	translations, err := translator.batchTranslateTexts(
		[]string{"first sentence", "second sentence"},
		types.StandardLanguageCode("en"),
		types.StandardLanguageCode("zh_cn"),
	)
	if err != nil {
		t.Fatalf("batchTranslateTexts() error = %v, want nil", err)
	}
	if completer.calls != 1 {
		t.Fatalf("ChatCompletion 调用次数 = %d, want 1（无需重试）", completer.calls)
	}
	want := []string{"第一句", "第二句"}
	if fmt.Sprint(translations) != fmt.Sprint(want) {
		t.Fatalf("translations = %v, want %v", translations, want)
	}
}

func TestTranslatorSplitOriginLongSentenceRetriesEmptyAnswer(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		`{"short_sentences":[]}`,
		`{"short_sentences":[{"text":"hello"}]}`,
	}}
	translator := &Translator{chatCompleter: completer}
	sentences, err := translator.splitOriginLongSentence("hello world")
	if err != nil || len(sentences) != 1 || sentences[0] != "hello" || completer.calls != 2 {
		t.Fatalf("split = %v, calls = %d, error = %v", sentences, completer.calls, err)
	}
}

func TestBatchTranslateTextsRejectsEmptyExampleAndRetriesEmptyText(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		`{"translations":[]} actual: {"translations":[{"index":1,"text":""}]}`,
		`{"translations":[{"index":1,"text":"你好"}]}`,
	}}
	translator := &Translator{chatCompleter: completer}
	translations, err := translator.batchTranslateTexts(
		[]string{"hello"}, types.StandardLanguageCode("en"), types.StandardLanguageCode("zh_cn"),
	)
	if err != nil || len(translations) != 1 || translations[0] != "你好" || completer.calls != 2 {
		t.Fatalf("translations = %v, calls = %d, error = %v", translations, completer.calls, err)
	}
}

func TestBatchTranslateTextsRetriesDuplicateIndex(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		`{"translations":[{"index":1,"text":"一"},{"index":1,"text":"二"}]}`,
		`{"translations":[{"index":1,"text":"一"},{"index":2,"text":"二"}]}`,
	}}
	translator := &Translator{chatCompleter: completer}
	translations, err := translator.batchTranslateTexts(
		[]string{"one", "two"}, types.StandardLanguageCode("en"), types.StandardLanguageCode("zh_cn"),
	)
	if err != nil || len(translations) != 2 || translations[0] != "一" || translations[1] != "二" || completer.calls != 2 {
		t.Fatalf("translations = %v, calls = %d, error = %v", translations, completer.calls, err)
	}
}

func TestBatchTranslateTextsKeepsSubtitleTextInOneBlock(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		`{"translations":[{"index":1,"text":"第一行\n\n第二行"}]}`,
	}}
	translator := &Translator{chatCompleter: completer}
	translations, err := translator.batchTranslateTexts(
		[]string{"first line and second line"}, types.StandardLanguageCode("en"), types.StandardLanguageCode("zh_cn"),
	)
	if err != nil || len(translations) != 1 || translations[0] != "第一行 第二行" {
		t.Fatalf("translations = %v, error = %v", translations, err)
	}
}

func TestTranslateSingleTextRejectsSubtitleMarkupAndUsesStructuredTranslation(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		"1<br>\n[它必须快速、令人满足，]<br>\n[It should be fast, satisfying,]\n\n2<br>\n[而且由您常备的食材制成。]",
		`{"translations":[{"index":1,"text":"它必须快速、令人满足，而且由您常备的食材制成。"}]}`,
	}}
	translator := &Translator{chatCompleter: completer}
	translation, err := translator.translateSingleText(
		"It should be fast, satisfying, and made from ingredients you can keep available.",
		types.StandardLanguageCode("en"), types.StandardLanguageCode("zh_cn"),
	)
	if err != nil || translation != "它必须快速、令人满足，而且由您常备的食材制成。" || completer.calls != 2 {
		t.Fatalf("translation = %q, calls = %d, error = %v", translation, completer.calls, err)
	}
}

type translationCompleterFunc func(string) (string, error)

func (f translationCompleterFunc) ChatCompletion(prompt string) (string, error) {
	return f(prompt)
}

func TestTranslationValidationKeepsOnlyWholeSpecialContent(t *testing.T) {
	translator := &Translator{}
	tests := []struct {
		name, origin, translation string
		want                      bool
	}{
		{"普通整句不能原样返回", "I was 20 years old.", "I was 20 years old.", false},
		{"包含专名也要翻译", "OpenAI had the customers we needed.", "OpenAI had the customers we needed.", false},
		{"空格和大小写不能绕过检查", "Andrew proposed a partnership.", "ANDREW  proposed a partnership.", false},
		{"数字多也不能豁免整句", "I am 20, 21, 22, 23.", "I am 20, 21, 22, 23.", false},
		{"纯数字", "2026", "2026", true},
		{"纯符号", "...", "...", true},
		{"缩写", "NASA", "NASA", true},
		{"品牌专名", "OpenAI", "OpenAI", true},
		{"人名", "Andrew Huberman", "Andrew Huberman", true},
		{"空译文", "hello", " \n ", false},
		{"无目标语言", "hello", "a greeting", false},
		{"短译文不受字节长度限制", "Yes, yes, yes, yes, yes, yes, yes.", "是。", true},
		{"自然译文", "that had the customers we needed", "那些拥有我们所需客户的公司", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := translator.isTranslationValid(tt.origin, tt.translation, "en", "zh_cn"); got != tt.want {
				t.Fatalf("isTranslationValid(%q, %q) = %v, want %v", tt.origin, tt.translation, got, tt.want)
			}
		})
	}
	if !translator.isTranslationValid("hello", "hello", "en", "en") {
		t.Fatal("同语言字幕应允许保持原文")
	}
}

func task792TranslationBlocks() []*util.SrtBlock {
	return []*util.SrtBlock{
		{Index: 4841, Timestamp: "02:48:22,560 --> 02:48:24,960", OriginLanguageSentence: "So, heartpounding, I started reaching out to companies"},
		{Index: 4842, Timestamp: "02:48:24,960 --> 02:48:26,240", OriginLanguageSentence: "that had the customers we needed"},
		{Index: 4843, Timestamp: "02:48:26,240 --> 02:48:28,080", OriginLanguageSentence: "and I proposed a partnership."},
		{Index: 4844, Timestamp: "02:48:28,080 --> 02:48:28,731", OriginLanguageSentence: "I was a nobody."},
		{Index: 4845, Timestamp: "02:48:28,880 --> 02:48:29,920", OriginLanguageSentence: "I was 20 years old."},
	}
}

func TestBatchTranslateSrtBlocksTask792RetriesIncompleteResults(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.VttBatchSize = 10
	config.Conf.App.MaxSentenceLength = 50
	config.Conf.App.ShortSubtitleMaxChars = 20
	complete := task792PairedResponse()
	for _, invalid := range []string{
		`{"sentences":[]}`,
		strings.Replace(complete, `"source":"So, heartpounding,`, `"source":"So,`, 1),
		strings.Replace(complete, `"我提出了合作。"`, `"。"`, 1),
	} {
		completer := &scriptedCompleter{responses: []string{invalid, complete}}
		blocks, err := (&Translator{chatCompleter: completer}).BatchTranslateSrtBlocks(context.Background(), task792TranslationBlocks(), "en", "zh_cn", nil)
		if err != nil || completer.calls != 2 || len(blocks) != 5 {
			t.Fatalf("output=%v calls=%d error=%v", blocks, completer.calls, err)
		}
		if err := (&YouTubeSubtitleService{}).validateYouTubeSubtitleBlocks(blocks, true); err != nil {
			t.Fatal(err)
		}
	}
}

func task792PairedResponse() string {
	return `{"sentences":[
 {"sentence_id":"1","target_text":"于是，我心跳加速地联系了拥有所需客户的公司，我提出了合作。","segments":[{"source":"So, heartpounding, I started reaching out","target":"于是，我心跳加速地"},{"source":"to companies that had the customers we needed","target":"联系了拥有所需客户的公司，"},{"source":"and I proposed a partnership.","target":"我提出了合作。"}]},
 {"sentence_id":"2","target_text":"当时我还是无名小卒。","segments":[{"source":"I was a nobody.","target":"当时我还是无名小卒。"}]},
 {"sentence_id":"3","target_text":"那年我20岁。","segments":[{"source":"I was 20 years old.","target":"那年我20岁。"}]}]}`
}

func TestBatchTranslateSrtBlocksMarksUntranslatedAfterRecoveryFailure(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.VttBatchSize = 10
	completer := &scriptedCompleter{responses: []string{"not-json", "not-json", "not-json"}}
	translator := &Translator{chatCompleter: completer}
	blocks := task792TranslationBlocks()
	output, err := translator.BatchTranslateSrtBlocks(context.Background(), blocks, "en", "zh_cn", nil)
	if err != nil || len(output) != 3 || completer.calls != 3 {
		t.Fatalf("翻译错误 = %v, 调用次数 = %d, want 3 completed responses", err, completer.calls)
	}
	for _, block := range output {
		if block.TargetLanguageSentence != "[待翻译] "+block.OriginLanguageSentence {
			t.Fatalf("未译内容未明确标记: %+v", block)
		}
	}
	for _, block := range blocks {
		if block.TargetLanguageSentence != "" {
			t.Fatalf("第%d条失败后不应回填译文: %q", block.Index, block.TargetLanguageSentence)
		}
	}
}

func TestBatchTranslateTextsRetriesUntranslatedSentenceWithProperNoun(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{
		`{"translations":[{"index":1,"text":"OpenAI had the customers we needed."}]}`,
		`{"translations":[{"index":1,"text":"OpenAI拥有我们所需的客户。"}]}`,
	}}
	translator := &Translator{chatCompleter: completer}
	translations, err := translator.batchTranslateTexts([]string{"OpenAI had the customers we needed."}, "en", "zh_cn")
	if err != nil || completer.calls != 2 || len(translations) != 1 || translations[0] != "OpenAI拥有我们所需的客户。" {
		t.Fatalf("translations = %v, calls = %d, error = %v", translations, completer.calls, err)
	}
}

func TestSplitTextAndTranslateMarksSourceOnFailure(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 200
	config.Conf.App.TranslateParallelNum = 1
	completer := &scriptedCompleter{responses: []string{"I was a nobody.", "I was a nobody.", "I was a nobody."}}
	translator := &Translator{chatCompleter: completer}
	items, err := translator.SplitTextAndTranslate("I was a nobody.", "en", "zh_cn")
	if err != nil || len(items) != 1 || items[0].OriginText != "I was a nobody." ||
		items[0].TranslatedText != "[待翻译] I was a nobody." || completer.calls != 3 {
		t.Fatalf("items = %v, calls = %d, error = %v", items, completer.calls, err)
	}
}

func TestSubtitleTranslationUsesSurroundingContextWithoutExtraCalls(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.VttBatchSize = 2
	config.Conf.App.TranslateParallelNum = 1
	for _, imported := range []bool{false, true} {
		t.Run(fmt.Sprintf("导入字幕=%v", imported), func(t *testing.T) {
			blocks := make([]*util.SrtBlock, 6)
			for i := range blocks {
				blocks[i] = &util.SrtBlock{Index: i + 1, Timestamp: formatSRTTimeline(int64(i*1000), int64((i+1)*1000)), OriginLanguageSentence: fmt.Sprintf("Source %d.", i+1)}
			}
			var inputs []pairedTranslationInput
			translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				inputs = append(inputs, input)
				return echoPairedTestResponse(input)
			})}
			var err error
			if imported {
				_, err = (Service{YouTubeSubtitleSrv: &YouTubeSubtitleService{translator: translator}}).TranslateSubtitleBlocks(context.Background(), blocks, &types.SubtitleTaskStepParam{OriginLanguage: "en", TargetLanguage: "zh_cn"})
			} else {
				_, err = translator.BatchTranslateSrtBlocks(context.Background(), blocks, "en", "zh_cn", nil)
			}
			if err != nil || len(inputs) != 3 {
				t.Fatalf("calls=%d error=%v", len(inputs), err)
			}
			middle := inputs[1].Sentences[0]
			if fmt.Sprint(middle.Before) != "[Source 1. Source 2.]" || fmt.Sprint(middle.After) != "[Source 4. Source 5.]" {
				t.Fatalf("缺少整句上下文: %+v", middle)
			}
		})
	}
}

func TestTranslationTask792Live(t *testing.T) {
	configPath := os.Getenv("KRILLINAI_TRANSLATION_CONFIG")
	if configPath == "" {
		t.Skip("未指定真实接口配置")
	}
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	log.InitLogger()
	if _, err := toml.DecodeFile(configPath, &config.Conf); err != nil {
		t.Fatal(err)
	}
	translator := NewTranslator()
	completer := translator.chatCompleter
	calls := 0
	translator.chatCompleter = translationCompleterFunc(func(prompt string) (string, error) { calls++; return completer.ChatCompletion(prompt) })
	cases := []struct {
		name   string
		blocks []*util.SrtBlock
	}{
		{"partnership", task792TranslationBlocks()},
		{"time", []*util.SrtBlock{
			{Index: 1273, Timestamp: "00:00:00,000 --> 00:00:03,000", OriginLanguageSentence: "We might have AI that is smarter than any human"},
			{Index: 1274, Timestamp: "00:00:03,000 --> 00:00:05,000", OriginLanguageSentence: "by the end of this year."},
		}},
		{"song", []*util.SrtBlock{
			{Index: 2518, Timestamp: "00:00:00,000 --> 00:00:03,000", OriginLanguageSentence: "No. YouTube just threw you a copyright notice"},
			{Index: 2519, Timestamp: "00:00:03,000 --> 00:00:05,000", OriginLanguageSentence: "for using Drake's Tootsie"},
			{Index: 2520, Timestamp: "00:00:05,000 --> 00:00:07,000", OriginLanguageSentence: "Slide without permission."},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			blocks, err := translator.BatchTranslateSrtBlocks(context.Background(), tc.blocks, "en", "zh_cn", nil)
			if err != nil {
				t.Fatal(err)
			}
			assertPairedOutput(t, tc.blocks, blocks, subtitleTargetLimit())
			if output := os.Getenv("KRILLINAI_TRANSLATION_OUTPUT"); output != "" {
				if err := os.MkdirAll(output, 0755); err != nil {
					t.Fatal(err)
				}
				data, _ := json.MarshalIndent(blocks, "", "  ")
				if err := os.WriteFile(filepath.Join(output, tc.name+".json"), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			for _, block := range blocks {
				t.Logf("%s | %s | %s", block.Timestamp, block.OriginLanguageSentence, block.TargetLanguageSentence)
			}
		})
	}
	t.Logf("三组问题句共调用%d次", calls)
}

func TestPairedTranslationAllowsReorderedTimePhrase(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 40
	config.Conf.App.ShortSubtitleMaxChars = 20
	completer := &scriptedCompleter{responses: []string{`{"sentences":[{"sentence_id":"1","target_text":"到今年年底，我们可能会拥有比任何人类都更聪明的AI。","segments":[{"source":"We might have AI that is smarter","target":"到今年年底，我们可能会拥有"},{"source":"than any human by the end of this year.","target":"比任何人类都更聪明的AI。"}]}]}`}}
	source := []*util.SrtBlock{
		{Index: 1273, Timestamp: "00:00:00,000 --> 00:00:03,000", OriginLanguageSentence: "We might have AI that is smarter than any human"},
		{Index: 1274, Timestamp: "00:00:03,000 --> 00:00:05,000", OriginLanguageSentence: "by the end of this year."},
	}
	blocks, err := (&Translator{chatCompleter: completer}).BatchTranslateSrtBlocks(context.Background(), source, "en", "zh_cn", nil)
	if err != nil || completer.calls != 1 {
		t.Fatalf("calls=%d error=%v", completer.calls, err)
	}
	assertPairedOutput(t, source, blocks, 40)
}
