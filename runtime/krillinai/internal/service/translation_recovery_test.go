package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	openaiapi "github.com/sashabaranov/go-openai"
)

func TestTranslationRepairsTargetCommasWithoutRequest(t *testing.T) {
	source := "Pick one phrase, a question, or a pattern and dig deeper into it."
	target := "选一个短语、问题或模式，深入探究一番。"
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		return `{"sentences":[{"sentence_id":"1","target_text":"选一个短语、问题或模式，深入探究一番。","segments":[{"source":"Pick one phrase, a question,","target":"选一个短语、问题，"},{"source":"or a pattern","target":"或模式"},{"source":"and dig deeper into it.","target":"，深入探究一番。"}]}]}`, nil
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 40, 1, nil)
	if err != nil || calls != 1 || len(result) != 1 || !subtitleSegmentsPreserveText(target, result[0].Target) ||
		fmt.Sprint(result[0].Target) != "[选一个短语、问题 或模式， 深入探究一番。]" {
		t.Fatalf("标点修复增加请求、改写内容或留下句首逗号: calls=%d result=%+v err=%v", calls, result, err)
	}
}

func TestTranslationCommaRepairDoesNotHideContentChanges(t *testing.T) {
	for _, tc := range []struct {
		full  string
		parts []string
	}{
		{"数字是1.5，不是15。", []string{"数字是15，", "不是15。"}},
		{"这是a part，不是apart。", []string{"这是apart，", "不是apart。"}},
		{"这不是建议，而是要求。", []string{"这是建议，", "而是要求。"}},
	} {
		item := pairedTranslationOutputSentence{FullTarget: tc.full}
		for _, part := range tc.parts {
			item.Segments = append(item.Segments, pairedTranslationSegment{Source: "source", Target: part})
		}
		fixed := repairPairedTargetCommas(item, 60)
		for i, part := range tc.parts {
			if fixed.Segments[i].Target != part {
				t.Fatalf("错误内容被标点修复掩盖: full=%q parts=%v fixed=%+v", tc.full, tc.parts, fixed)
			}
		}
	}
}

func TestTranslationPreservesInLimitPairsDespiteSubjectBoundaryAdvice(t *testing.T) {
	source := "This is a long beginning that remains separate. And it is useful."
	// 单独输入完整文本会按句号分成两句；以逗号连接以检验同一句中的局部边界。
	source = strings.Replace(source, "separate.", "separate,", 1)
	target := "这是一段需要单独保留的比较长的介绍内容，另外，它很有用。"
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: target,
			Source: []string{"This is a long beginning that remains separate,", "And it", "is useful."},
			Target: []string{"这是一段需要单独保留的比较长的介绍内容，", "另外，", "它很有用。"}}})
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 50, 1, nil)
	if err != nil || calls != 1 || len(result) != 1 || len(result[0].Source) != 3 || result[0].Source[1] != "And it" || result[0].Source[2] != "is useful." || !subtitleSegmentsPreserveText(target, result[0].Target) {
		t.Fatalf("软边界建议改动了已符合长度的字幕: calls=%d result=%+v err=%v", calls, result, err)
	}
}

func TestTranslationContinuesWhenOnlyLayoutRequestDisconnects(t *testing.T) {
	target := strings.Repeat("有效译文", 15)
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		if calls > 1 {
			return "", errors.New("LLM disconnected")
		}
		data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", Source: []string{"Hello."}, Target: []string{target}}})
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || calls != 2 || len(result) != 1 || result[0].FullTarget != target {
		t.Fatalf("已有完整译文仍因排版连接故障失败: calls=%d result=%+v err=%v", calls, result, err)
	}
}

func TestTranslationReducesConcurrencyAfterRateLimit(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 3
	config.Conf.App.TranslateMaxAttempts = 1
	var mu sync.Mutex
	limited, activeLater, peakLater := false, 0, 0
	translator := &Translator{recoveryDelay: time.Millisecond, chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		id := input.Sentences[0].ID
		mu.Lock()
		if id == "1" && !limited {
			limited = true
			mu.Unlock()
			return "", &openaiapi.APIError{HTTPStatusCode: 429}
		}
		if id >= "4" {
			activeLater++
			peakLater = max(peakLater, activeLater)
		}
		mu.Unlock()
		if id >= "4" {
			time.Sleep(time.Millisecond)
			mu.Lock()
			activeLater--
			mu.Unlock()
		}
		return echoPairedTestResponse(input)
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"One.", "Two.", "Three.", "Four.", "Five.", "Six."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || len(result) != 6 || !limited || peakLater != 1 {
		t.Fatalf("限流后未串行恢复: peak=%d result=%+v err=%v", peakLater, result, err)
	}
}

func TestShortSubtitleFallsBackWhenGraphemeOrTimingCannotBeSplit(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	for _, length := range []int{1, 2} {
		config.Conf.App.MaxSentenceLength = length
		text := "你好。"
		blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:00,001", OriginLanguageSentence: text}}
		spans, _, err := subtitleBlockTimingSpans(blocks)
		if err != nil {
			t.Fatal(err)
		}
		short, err := splitShortSubtitleBlocks(blocks, spans, length, 0)
		if err != nil || len(short[1]) != 1 || short[1][0].OriginLanguageSentence != text || short[1][0].Timestamp != blocks[0].Timestamp {
			t.Fatalf("无法拆分时未保留完整字幕: %+v err=%v", short, err)
		}
	}
}

func TestTranslationRejectsSmallOverflowWithBoundedRecovery(t *testing.T) {
	for _, length := range []int{50, 51, 55, 56, 150} {
		t.Run(fmt.Sprint(length), func(t *testing.T) {
			calls := 0
			target := "译" + strings.Repeat("a", length-1)
			translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				if calls > 1 && input.Sentences[0].TargetText != target {
					t.Fatal("修复排版时没有冻结已完成的译文")
				}
				data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: target, Source: []string{"Hello."}, Target: []string{target}}})
				return string(data), err
			})}
			result, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", 50, 1, nil)
			wantCalls := 1
			if length > 50 {
				wantCalls = 3
			}
			if err != nil || calls != wantCalls || len(result) != 1 || result[0].FullTarget != target || result[0].Target[0] != target {
				t.Fatalf("calls=%d result=%+v error=%v", calls, result, err)
			}
		})
	}
}

func TestTranslationRepairsOnlyFailedSentences(t *testing.T) {
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if calls == 2 && (len(input.Sentences) != 1 || input.Sentences[0].ID != "2") {
			t.Fatalf("正确句子被重复提交: %+v", input.Sentences)
		}
		var sentences []pairedSentence
		for _, source := range input.Sentences {
			target := "有效译文" + source.ID
			if calls == 1 && source.ID == "2" {
				target = source.Text // 整句未译，必须修复。
			}
			sentences = append(sentences, pairedSentence{ID: source.ID, FullTarget: target, Source: []string{source.Text}, Target: []string{target}})
		}
		data, err := encodePairedTestResponse(sentences)
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"First.", "Second.", "Third."}, "en", "zh_cn", 50, 3, nil)
	if err != nil || calls != 2 || len(result) != 3 || result[0].FullTarget != "有效译文1" || result[2].FullTarget != "有效译文3" {
		t.Fatalf("calls=%d result=%+v error=%v", calls, result, err)
	}
}

func TestTranslationFallsBackToFullSentenceWithoutDroppingContent(t *testing.T) {
	source := "We work hard, because we care."
	target := "我们努力工作，因为我们在乎。"
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		// 译文完整，但配对同时遗漏了两侧内容；不能接受错误片段。
		data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: target, Source: []string{"We work hard,"}, Target: []string{"我们努力工作，"}}})
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 50, 1, nil)
	if err != nil || calls != 2 || len(result) != 1 || !result[0].LayoutFallback || fmt.Sprint(result[0].Source) != "["+source+"]" || fmt.Sprint(result[0].Target) != "["+target+"]" {
		t.Fatalf("calls=%d result=%+v error=%v", calls, result, err)
	}
}

func TestTranslationRetainsValidTargetWhenLayoutRepairRewritesIt(t *testing.T) {
	target := strings.Repeat("完整", 30)
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		text := target
		if calls > 1 {
			text = "删减后的译文。"
		}
		data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: text, Source: []string{"Original."}, Target: []string{text}}})
		return string(data), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Original."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || calls != 3 || result[0].FullTarget != target {
		t.Fatalf("排版纠错改写了译文: %+v calls=%d err=%v", result, calls, err)
	}
}

func TestTranslationUsesPlainSentenceAfterStructuredAttempts(t *testing.T) {
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls <= 3 {
			return "not-json", nil
		}
		if !strings.HasPrefix(prompt, plainTranslationPrompt) {
			t.Fatal("三次结构失败后没有切换请求策略")
		}
		return `{"sentence_id":"1","target_text":"这是完整的译文。"}`, nil
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"This is a complete translation."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || calls != 4 || len(result) != 1 || result[0].Target[0] != "这是完整的译文。" {
		t.Fatalf("calls=%d result=%+v err=%v", calls, result, err)
	}
}

func TestTranslationBadSentenceStopsAfterRecoveryBudget(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	notified := false
	calls := make(map[string]int)
	translator := &Translator{recoveryDelay: time.Millisecond, onRecovery: func(message string) {
		if strings.Contains(message, "未获得有效译文") {
			notified = true
			if calls["2"] != 1 {
				t.Error("失败句阻止了后面的字幕翻译")
			}
		}
	}, chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		id := input.Sentences[0].ID
		calls[id]++
		if id == "1" {
			return "not-json", nil
		}
		return echoPairedTestResponse(input)
	})}
	result, err := translator.translatePairedSentences(ctx, []string{"First.", "Second."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || !notified || calls["1"] != 4 || calls["2"] != 1 || len(result) != 2 ||
		!result[0].Untranslated || result[0].FullTarget != "[待翻译] First." || result[1].Untranslated {
		t.Fatalf("calls=%v result=%+v notified=%v err=%v", calls, result, notified, err)
	}
}

func TestTranslationInvalidContentFallbackHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	translator := &Translator{onRecovery: func(string) { cancel() }, chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		return `{"sentence_id":"1","target_text":"Original."}`, nil
	})}
	result, err := translator.translatePairedSentences(ctx, []string{"Original."}, "en", "zh_cn", 50, 1, nil)
	if !errors.Is(err, context.Canceled) || result != nil || calls != 4 {
		t.Fatalf("无效译文被当成成功或等待不可取消: calls=%d result=%v err=%v", calls, result, err)
	}
}

func TestTranslationCheckpointSurvivesDisconnectDuringLayoutRepair(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	target := strings.Repeat("完整译文", 15)
	calls := 0
	translator := &Translator{checkpointDir: dir, chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		if calls > 1 {
			cancel()
			return "", errors.New("LLM disconnected")
		}
		data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: target, Source: []string{"Hello."}, Target: []string{target}}})
		return string(data), err
	})}
	if _, err := translator.translatePairedSentences(ctx, []string{"Hello."}, "en", "zh_cn", 50, 1, nil); err == nil {
		t.Fatal("没有报告真实连接故障")
	}
	repairCalls := 0
	translator.chatCompleter = translationCompleterFunc(func(prompt string) (string, error) {
		repairCalls++
		input, err := decodePairedTestInput(prompt)
		if err != nil || len(input.Sentences) != 1 || input.Sentences[0].ID != "1.1" || input.Sentences[0].TargetText != target {
			t.Fatalf("恢复时未冻结已有译文做局部拆分: %+v err=%v", input, err)
		}
		return "", errors.New("LLM disconnected")
	})
	result, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", 20, 3, nil)
	if err != nil || len(result) != 1 || result[0].FullTarget != target || calls != 2 || repairCalls != 1 {
		t.Fatalf("result=%+v calls=%d repairCalls=%d err=%v", result, calls, repairCalls, err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, "translation-checkpoints", "*", "*.json"))
	if len(files) != 1 {
		t.Fatalf("检查点未按句保存: %v", files)
	}
}

func TestTranslationCheckpointSavesOtherConcurrentSuccesses(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 2
	dir := t.TempDir()
	saved := make(chan struct{})
	var once sync.Once
	translator := &Translator{checkpointDir: dir, chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if input.Sentences[0].ID == "1" {
			<-saved
			return "", errors.New("LLM disconnected")
		}
		return echoPairedTestResponse(input)
	})}
	first, err := translator.translatePairedSentences(context.Background(), []string{"First.", "Second."}, "en", "zh_cn", 50, 1, nil, func(completed, total int) {
		if completed == 1 {
			once.Do(func() { close(saved) })
		}
	})
	if err != nil || len(first) != 2 || !first[0].Untranslated || first[1].Untranslated {
		t.Fatalf("未保留并发成功句或未标记失败句: result=%+v err=%v", first, err)
	}
	var requested []string
	translator.chatCompleter = translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		requested = append(requested, input.Sentences[0].ID)
		return echoPairedTestResponse(input)
	})
	result, err := translator.translatePairedSentences(context.Background(), []string{"First.", "Second."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || len(result) != 2 || fmt.Sprint(requested) != "[1]" {
		t.Fatalf("恢复重译了成功句: requested=%v result=%+v err=%v", requested, result, err)
	}
}

func TestTranslationCheckpointDoesNotReuseDifferentContentOrLanguage(t *testing.T) {
	calls := 0
	translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		return echoPairedTestResponse(input)
	})}
	for _, source := range []string{"First.", "Changed."} {
		for _, language := range []types.StandardLanguageCode{"zh_cn", "zh_tw"} {
			if _, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", language, 50, 1, nil); err != nil {
				t.Fatal(err)
			}
		}
	}
	if calls != 4 {
		t.Fatalf("错误复用了其他内容或语言的检查点: %d", calls)
	}
}

func TestTranslationCheckpointIgnoresCorruptSentenceOnly(t *testing.T) {
	translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		return echoPairedTestResponse(input)
	})}
	texts := []string{"First.", "Second."}
	if _, err := translator.translatePairedSentences(context.Background(), texts, "en", "zh_cn", 50, 2, nil); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(translator.checkpointDir, "translation-checkpoints", "*", "1.json"))
	if len(files) != 1 {
		t.Fatal(files)
	}
	if err := os.WriteFile(files[0], []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	translator.chatCompleter = translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if len(input.Sentences) != 1 || input.Sentences[0].ID != "1" {
			t.Fatal("损坏单句影响了其他已保存句子")
		}
		return echoPairedTestResponse(input)
	})
	if _, err := translator.translatePairedSentences(context.Background(), texts, "en", "zh_cn", 50, 2, nil); err != nil {
		t.Fatal(err)
	}
}

func TestTranslationFallsBackToCueTimingWithoutRetranslation(t *testing.T) {
	completer := &scriptedCompleter{responses: []string{`{"sentences":[{"sentence_id":"1","target_text":"你好。","segments":[{"source":"Hello.","target":"你好。"}]}]}`}}
	translator := &Translator{chatCompleter: completer}
	blocks, err := translator.BatchTranslateSrtBlocks(context.Background(), []*util.SrtBlock{{Index: 1, Timestamp: "00:00:01,000 --> 00:00:03,000", OriginLanguageSentence: "Hello."}}, "en", "zh_cn", nil, []VttWord{{Text: "Mismatch", Start: "invalid", End: "invalid"}})
	if err != nil || completer.calls != 1 || len(blocks) != 1 || blocks[0].Timestamp != "00:00:01,000 --> 00:00:03,000" {
		t.Fatalf("blocks=%+v err=%v calls=%d", blocks, err, completer.calls)
	}
}

func TestTranslationCheckpointRejectsInvalidCachedTarget(t *testing.T) {
	translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		return echoPairedTestResponse(input)
	})}
	checkpoint, err := translator.openTranslationCheckpoint([]string{"Original."}, "en", "zh_cn")
	if err != nil {
		t.Fatal(err)
	}
	if err := checkpoint.save(pairedSentence{ID: "1", FullTarget: "Original.", Source: []string{"Original."}, Target: []string{"Original."}}); err != nil {
		t.Fatal(err)
	}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Original."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || len(result) != 1 || result[0].FullTarget == "Original." {
		data, _ := json.Marshal(result)
		t.Fatalf("无效检查点被当作成功: %s err=%v", data, err)
	}
}
