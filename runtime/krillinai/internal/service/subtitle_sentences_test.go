package service

import (
	"context"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"reflect"
	"strings"
	"testing"
)

func TestTranslationSentenceBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		want       []string
	}{
		{"西班牙语缩写", "Doug estaba a punto de irse una semana a Washington D. C.", []string{"Doug estaba a punto de irse una semana a Washington D. C."}},
		{"斯洛伐克语缩写", "Doug sa chystal odísť na týždeň do Washingtonu, D. C.", []string{"Doug sa chystal odísť na týždeň do Washingtonu, D. C."}},
		{"缩写内部与真实句末", "He lives in Washington D. C. Next week he leaves.", []string{"He lives in Washington D. C.", "Next week he leaves."}},
		{"无空格缩写", "He lives in Washington D.C. Then he leaves.", []string{"He lives in Washington D.C.", "Then he leaves."}},
		{"其他首字母缩写", "He visited the U. S. Then he left.", []string{"He visited the U. S.", "Then he left."}},
		{"称谓和人名首字母", "Dr. A. Smith met Mr. B. Jones. Then they left.", []string{"Dr. A. Smith met Mr. B. Jones.", "Then they left."}},
		{"句首连续人名首字母", "J. R. R. Tolkien wrote books. They are famous.", []string{"J. R. R. Tolkien wrote books.", "They are famous."}},
		{"缩写不吞并后句", "We bought fruit, etc. Then we left Acme Inc. Next came lunch.", []string{"We bought fruit, etc.", "Then we left Acme Inc.", "Next came lunch."}},
		{"否定词不是编号缩写", "No. YouTube sent a notice. Yes!", []string{"No.", "YouTube sent a notice.", "Yes!"}},
		{"编号与图号", "See Fig. 3 and No. 5. Read both.", []string{"See Fig. 3 and No. 5.", "Read both."}},
		{"小数与版本", "Use version 3.14 at example.com. It costs $2.50.", []string{"Use version 3.14 at example.com.", "It costs $2.50."}},
		{"闭引号", "He said, \"Go to Washington D. C.\" Then he left.", []string{"He said, \"Go to Washington D. C.\"", "Then he left."}},
		{"中文无空格", "第一句。第二句！第三句？", []string{"第一句。", "第二句！", "第三句？"}},
		{"阿拉伯标点", "مرحبا بالعالم؟ نعم! هذا جيد.", []string{"مرحبا بالعالم؟", "نعم!", "هذا جيد."}},
		{"印度文字句号", "पहला वाक्य। दूसरा वाक्य।", []string{"पहला वाक्य।", "दूसरा वाक्य।"}},
		{"空白与组合字符", "  Dr. A. Smith likes cafe\u0301.\nThen he leaves.  ", []string{"Dr. A. Smith likes cafe\u0301.", "Then he leaves."}},
		{"空行", "First.\n\nSecond.\n\nThird.", []string{"First.", "Second.", "Third."}},
		{"空输入", " \n\t ", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := splitTranslationSentences(tc.text)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("分句=%q，期望=%q", got, tc.want)
			}
			if compactSubtitleText(strings.Join(got, "")) != compactSubtitleText(tc.text) {
				t.Fatalf("分句改变了原文: %q", got)
			}
			for _, sentence := range got {
				if repeated := splitTranslationSentences(sentence); len(repeated) != 1 || repeated[0] != sentence {
					t.Fatalf("重复分句改变边界: %q -> %q", sentence, repeated)
				}
			}
		})
	}
}

func TestTranslationSentenceBoundariesAcrossCues(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.MaxSentenceLength = 70
	for _, tc := range []struct {
		name  string
		cues  []string
		texts []string
	}{
		{"西班牙语跨缩写", []string{"Doug va a Washington D.", "C.", "Luego vuelve."}, []string{"Doug va a Washington D. C.", "Luego vuelve."}},
		{"跨称谓", []string{"I met Dr.", "Smith today.", "Then I left."}, []string{"I met Dr. Smith today.", "Then I left."}},
		{"跨人名首字母", []string{"I met A.", "Smith today.", "Then I left."}, []string{"I met A. Smith today.", "Then I left."}},
		{"否定词独立", []string{"No.", "YouTube sent a notice."}, []string{"No.", "YouTube sent a notice."}},
		{"完整缩写句末", []string{"He lives in D. C.", "Next week he leaves."}, []string{"He lives in D. C.", "Next week he leaves."}},
		{"小数与跨字幕续句", []string{"It costs 3.14", "dollars.", "Then we leave."}, []string{"It costs 3.14 dollars.", "Then we leave."}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var source []*util.SrtBlock
			var words []VttWord
			for i, text := range tc.cues {
				source = append(source, &util.SrtBlock{Index: i + 1, Timestamp: formatSRTTimeline(int64(i)*1000, int64(i+1)*1000), OriginLanguageSentence: text})
				words = append(words, VttWord{Text: text, Start: fmt.Sprintf("00:00:%02d.000", i), End: fmt.Sprintf("00:00:%02d.000", i+1)})
			}
			for _, wordTiming := range []bool{false, true} {
				t.Run(fmt.Sprint(wordTiming), func(t *testing.T) {
					calls := 0
					var got []string
					translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
						calls++
						input, err := decodePairedTestInput(prompt)
						if err != nil {
							return "", err
						}
						for _, sentence := range input.Sentences {
							got = append(got, sentence.Text)
						}
						return echoPairedTestResponse(input)
					})}
					var timings [][]VttWord
					if wordTiming {
						timings = append(timings, words)
					}
					output, err := translator.BatchTranslateSrtBlocks(context.Background(), source, "es", "zh_cn", nil, timings...)
					if err != nil || !reflect.DeepEqual(got, tc.texts) || calls != 1 {
						t.Fatalf("请求=%d，分句=%q，期望=%q，错误=%v", calls, got, tc.texts, err)
					}
					assertPairedOutput(t, source, output, 70)
				})
			}
		})
	}
}

func TestTranslationSentenceBudgetKeepsInitialism(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	// 让整句超过当前响应预算，仍须保留末尾完整缩写。
	source := strings.Repeat("word ", 188) + "a D. C."
	var got []string
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		for _, sentence := range input.Sentences {
			got = append(got, sentence.Text)
		}
		return echoPairedTestResponse(input)
	})}
	_, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 50, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) < 2 || !strings.HasSuffix(got[len(got)-1], "D. C.") {
		t.Fatalf("请求预算切开了缩写: %q", got)
	}
	for _, part := range got {
		if len(part) > translationSentenceBytes || pairedTranslationResponseBudget(part, 50) > translationOutputBudget {
			t.Fatalf("片段超过输入预算: %d", len(part))
		}
	}
	if compactSubtitleText(strings.Join(got, "")) != compactSubtitleText(source) {
		t.Fatal("预算切分改变了原文")
	}
}
