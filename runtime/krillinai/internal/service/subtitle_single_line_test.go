package service

import (
	"context"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"path/filepath"
	"strings"
	"testing"
)

func TestSubtitleUnicodeBoundariesAndCharacterCount(t *testing.T) {
	for _, text := range []string{"中文。日本語。한국어.", "ภาษาไทยไม่มีช่องว่าง", "العَرَبِيَّة فارسی\u200cمتن", "हिन्दी क्षि नमस्ते", "cafe\u0301 déjà vu", "👩🏽‍💻👨‍👩‍👧‍👦🇨🇳 test", "English 中文 العربية हिन्दी"} {
		t.Run(text, func(t *testing.T) {
			parts, err := splitSubtitleText(text, func(s string) bool { return subtitleTargetLength(s) <= 8 })
			if err != nil {
				t.Fatal(err)
			}
			if compactSubtitleText(strings.Join(parts, "")) != compactSubtitleText(text) || !subtitleSegmentsHaveSafeBoundaries(parts) {
				t.Fatalf("字素或内容被破坏: %q", parts)
			}
			for _, part := range parts {
				if subtitleTargetLength(part) > 8 || hasSubtitleLineBreak(part) {
					t.Fatalf("片段超限: %q", part)
				}
			}
		})
	}
	for _, text := range []string{"e\u0301", "क्षि", "👩🏽‍💻", "👨‍👩‍👧‍👦"} {
		if subtitleTargetLength(text) > 2 {
			t.Errorf("组合序列重复计宽: %q", text)
		}
		if _, err := splitSubtitleText(text, func(s string) bool { return len(s) < len(text) }); err == nil {
			t.Errorf("不应拆开单个字素簇: %q", text)
		}
	}
}

func TestPairedTranslationProtectsUnpunctuatedInputAndBatchBudget(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	original := strings.Repeat("hello ", 20000)
	calls, doneCount := 0, 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if len(prompt) > translationRequestBytes || input.MaxSourceChars != 50 {
			t.Fatalf("请求超限: %d", len(prompt))
		}
		for _, sentence := range input.Sentences {
			if len(sentence.Text) > translationSentenceBytes {
				t.Fatalf("输入未保护: %d", len(sentence.Text))
			}
		}
		if strings.Contains(prompt, "source_segments_hint") {
			t.Fatal("首译不应附带已停用的本地分段建议")
		}
		return echoPairedTestResponse(input)
	})}
	paired, err := translator.translatePairedSentences(context.Background(), []string{original}, "en", "zh_cn", 50, 12, func(_ []pairedSentence, done, total int) error {
		if done <= doneCount || done > total {
			t.Fatalf("进度异常: %d/%d", done, total)
		}
		doneCount = done
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var restored strings.Builder
	for _, sentence := range paired {
		for _, part := range sentence.Source {
			if subtitleTargetLength(part) > 50 {
				t.Fatal("原文超限")
			}
			restored.WriteString(part)
		}
	}
	if calls < 2 || doneCount != len(paired) || compactSubtitleText(restored.String()) != compactSubtitleText(original) {
		t.Fatalf("输入遗漏或进度错误: calls=%d done=%d count=%d", calls, doneCount, len(paired))
	}
}

func TestShortSubtitleKeepsTrailingPunctuationWithText(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 50
	text := "And you can do this with almost anything."
	blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:04,000", OriginLanguageSentence: text}}
	spans, _, err := subtitleBlockTimingSpans(blocks)
	if err != nil {
		t.Fatal(err)
	}
	short, err := splitShortSubtitleBlocks(blocks, spans, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	var parts []string
	for _, block := range short[1] {
		if !hasSubtitleContent(block.OriginLanguageSentence) || subtitleTargetLength(block.OriginLanguageSentence) > 50 {
			t.Fatalf("短字幕不能独立显示标点或超限: %+v", block)
		}
		parts = append(parts, block.OriginLanguageSentence)
	}
	if compactSubtitleText(strings.Join(parts, "")) != compactSubtitleText(text) {
		t.Fatalf("短字幕内容丢失: %q", parts)
	}
}

func TestShortSubtitleMergesTailWithinSingleLineLimits(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	for _, tc := range []struct {
		name, text                      string
		groupLimit, lineLimit, maxWords int
		want                            []string
	}{
		{"英文短尾回并", "And you can do this with almost anything.", 20, 50, 0, []string{"And you can do this", "with almost anything."}},
		{"回并不得突破单行上限", "And you can do this with almost anything.", 20, 20, 0, []string{"And you can do this", "with almost", "anything."}},
		{"词数限制仍生效", "one two three four five", 50, 50, 2, []string{"one two", "three four", "five"}},
		{"无空格原文不插入空格", "甲乙丙丁戊己庚辛壬癸。", 8, 50, 0, []string{"甲乙丙丁戊己庚辛壬癸。"}},
		{"长词内部回并不插入空格", strings.Repeat("a", 26) + ".", 20, 50, 0, []string{strings.Repeat("a", 26) + "."}},
		{"短字幕配置不得放宽单行上限", "alpha beta gamma delta", 80, 16, 0, []string{"alpha beta gamma", "delta"}},
		{"组合字符保持完整", "cafe\u0301cafe\u0301.", 6, 50, 0, []string{"cafe\u0301cafe\u0301."}},
		{"Emoji连接序列保持完整", "👩🏽‍💻👨‍👩‍👧‍👦👩🏽‍💻", 4, 50, 0, []string{"👩🏽‍💻👨‍👩‍👧‍👦👩🏽‍💻"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config.Conf.App.MaxSentenceLength = tc.lineLimit
			blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:04,000", OriginLanguageSentence: tc.text}}
			spans, _, err := subtitleBlockTimingSpans(blocks)
			if err != nil {
				t.Fatal(err)
			}
			short, err := splitShortSubtitleBlocks(blocks, spans, tc.groupLimit, tc.maxWords)
			if err != nil {
				t.Fatal(err)
			}
			var parts []string
			var previousEnd int64
			for _, block := range short[1] {
				part := block.OriginLanguageSentence
				if subtitleTargetLength(part) > tc.lineLimit || tc.maxWords > 0 && len(strings.Fields(part)) > tc.maxWords {
					t.Fatalf("合并后超过单行或词数限制: %q", part)
				}
				start, end, err := parseSRTTimeline(block.Timestamp)
				if err != nil || start != previousEnd || end <= start {
					t.Fatalf("短字幕时间不连续: %+v, %v", block, err)
				}
				previousEnd = end
				parts = append(parts, part)
			}
			if strings.Join(parts, "\n") != strings.Join(tc.want, "\n") {
				t.Fatalf("分组错误: got=%q want=%q", parts, tc.want)
			}
			if previousEnd != 4000 || compactSubtitleText(strings.Join(parts, "")) != compactSubtitleText(tc.text) || !subtitleSegmentsHaveSafeBoundaries(parts) {
				t.Fatalf("合并破坏原文、字素或时间范围: %q", parts)
			}
		})
	}
}

func TestPairedTranslationRejectsSourceOverflowAndUnsafeBreaks(t *testing.T) {
	translator := &Translator{}
	for _, tc := range []struct {
		source        string
		parts, target []string
	}{
		{"This original is longer than twenty.", []string{"This original is longer than twenty."}, []string{"译文短。"}},
		{"cafe\u0301", []string{"cafe", "\u0301"}, []string{"测试", "文字"}},
		{"Hello.", []string{"Hello."}, []string{`测试\N换行`}},
		{"Hello.", []string{"Hello."}, []string{"测试\u0085换行"}},
	} {
		input := pairedTranslationInput{MaxTargetChars: 20, Sentences: []pairedTranslationSource{{ID: "1", Text: tc.source}}}
		data, _ := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: strings.Join(tc.target, ""), Source: tc.parts, Target: tc.target}})
		if _, err := translator.parsePairedTranslation(string(data), input, "en", "zh_cn"); err == nil {
			t.Fatalf("未拒绝无效输出: %s", data)
		}
	}
	if got := splitTranslationSentences("第一句。第二句！第三句？"); len(got) != 3 {
		t.Fatalf("无空格语句未拆分: %q", got)
	}
	if got := splitTranslationSentences("Dr. Smith met Mr. Jones. Then they left."); len(got) != 2 {
		t.Fatalf("缩写被错误拆句: %q", got)
	}
}

func TestShortSubtitleSharesWordInteriorTiming(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.ShortSubtitleMaxChars = 8
	words := []VttWord{{Text: "We", Start: "00:00:00.000", End: "00:00:00.200"}, {Text: "can", Start: "00:00:00.200", End: "00:00:00.400"}, {Text: "launch", Start: "00:00:00.400", End: "00:00:01.000"}, {Text: "after", Start: "00:00:01.000", End: "00:00:01.500"}, {Text: "review.", Start: "00:00:01.500", End: "00:00:02.000"}}
	blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:00,700", OriginLanguageSentence: "We can lau", TargetLanguageSentence: "审核后，"}, {Index: 2, Timestamp: "00:00:00,700 --> 00:00:02,000", OriginLanguageSentence: "nch after review.", TargetLanguageSentence: "我们能发布。"}}
	dir := t.TempDir()
	file := filepath.Join(dir, "short.srt")
	if err := (&YouTubeSubtitleService{}).writeShortSubtitleFile(blocks, []Sentence{{Words: words}}, file, true); err != nil {
		t.Fatal(err)
	}
	parsed, err := util.ParseSrtFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var source []string
	for _, block := range parsed {
		if block.OriginLanguageSentence != "审核后，" && block.OriginLanguageSentence != "我们能发布。" {
			source = append(source, block.OriginLanguageSentence)
		}
	}
	if compactSubtitleText(strings.Join(source, "")) != "Wecanlaunchafterreview." {
		t.Fatalf("词内原文丢失: %q", source)
	}
	var audioWords []types.Word
	for _, word := range words {
		start, end, _ := parseSRTTimeline(strings.ReplaceAll(word.Start+" --> "+word.End, ".", ","))
		audioWords = append(audioWords, types.Word{Text: word.Text, Start: float64(start) / 1000, End: float64(end) / 1000})
	}
	audio, _, err := pairedAudioTiming(blocks, audioWords, "en", 0)
	if err != nil || audio[0].Timestamp != blocks[0].Timestamp || audio[1].Timestamp != blocks[1].Timestamp {
		t.Fatalf("音频和词字幕映射不一致: %+v %v", audio, err)
	}
}
