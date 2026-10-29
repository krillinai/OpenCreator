package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	openaiapi "github.com/sashabaranov/go-openai"
	"golang.org/x/sync/errgroup"
)

func TestPairedTranslationRateLimitsShareSentenceRequestBudget(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.TranslateMaxAttempts = 3
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls <= 2 {
			return "", &openaiapi.APIError{HTTPStatusCode: http.StatusTooManyRequests, Message: "Concurrency limit exceeded"}
		}
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if calls == 3 {
			response, _ := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: strings.Repeat("好", 56), Source: []string{"Hello."}, Target: []string{strings.Repeat("好", 56)}}})
			return string(response), nil
		}
		if !strings.Contains(prompt, "计56字符") || !strings.Contains(prompt, "第2/3次请求") {
			return "", fmt.Errorf("限流消耗了译文纠正机会")
		}
		return echoPairedTestResponse(input)
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", 50, 1, nil)
	if err != nil || calls != 4 || len(result) != 1 {
		t.Fatalf("calls=%d result=%+v error=%v", calls, result, err)
	}
}

func TestPairedTranslationRateLimitBackoffHonorsCancellation(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateMaxAttempts = 3
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		time.AfterFunc(20*time.Millisecond, cancel)
		return "", &openaiapi.APIError{HTTPStatusCode: http.StatusTooManyRequests}
	})}
	started := time.Now()
	_, err := translator.translatePairedSentences(ctx, []string{"Hello."}, "en", "zh_cn", 50, 1, nil)
	if !errors.Is(err, context.Canceled) || calls != 1 || time.Since(started) > 500*time.Millisecond {
		t.Fatalf("取消退避失败: calls=%d elapsed=%s error=%v", calls, time.Since(started), err)
	}
}

func TestPairedTranslationRateLimitWaitsAndHonorsCancellation(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateMaxAttempts = 1
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	translator := &Translator{onRecovery: func(string) { cancel() }, chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		return "", &openaiapi.APIError{HTTPStatusCode: http.StatusTooManyRequests}
	})}
	_, err := translator.translatePairedSentences(ctx, []string{"Hello."}, "en", "zh_cn", 50, 1, nil)
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("限流等待未响应取消: calls=%d error=%v", calls, err)
	}
}

func decodePairedTestInput(prompt string) (pairedTranslationInput, error) {
	var input pairedTranslationInput
	_, payload, found := strings.Cut(prompt, "Input JSON:\n")
	if !found {
		return input, fmt.Errorf("missing paired input")
	}
	err := json.NewDecoder(strings.NewReader(payload)).Decode(&input)
	return input, err
}

func TestPairedTranslationRetryReportsAllBatchIssues(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if calls == 1 {
			response, _ := encodePairedTestResponse([]pairedSentence{
				{ID: "1", FullTarget: "这是我教给客户的一个方法。", Source: []string{"So, let me give you a model, that I teach my movement maker clients."}, Target: []string{"这是我教给客户的一个方法。"}},
				{ID: "2", FullTarget: "他们每个人都可能为你的企业带来六位数或七位数的价值。", Source: []string{input.Sentences[1].Text}, Target: []string{"他们每个人都可能为你的企业带来六位数或七位数的价值。"}},
				{ID: "3", FullTarget: strings.Repeat("好", 56), Source: []string{input.Sentences[2].Text}, Target: []string{strings.Repeat("好", 56)}},
			})
			return string(response), nil
		}
		for _, expected := range []string{"句子1原文覆盖错误", "句子2第1段", "计56字符", "句子3第1段", "该段至少拆成2段"} {
			if !strings.Contains(prompt, expected) {
				return "", fmt.Errorf("重试漏报批次问题: %s", expected)
			}
		}
		return echoPairedTestResponse(input)
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{
		"So, let me give you a model that I teach my movement maker clients.",
		"Make a list of 50 people who could each be worth six or seven figures to your business.",
		"Not customers, connectors.",
	}, "en", "zh_cn", 50, 3, nil)
	if err != nil || calls != 2 || len(result) != 3 {
		t.Fatalf("calls=%d result=%+v error=%v", calls, result, err)
	}
}

func encodePairedTestResponse(sentences []pairedSentence) ([]byte, error) {
	var output pairedTranslationOutput
	for _, sentence := range sentences {
		item := pairedTranslationOutputSentence{ID: sentence.ID, FullTarget: sentence.FullTarget}
		for i := range max(len(sentence.Source), len(sentence.Target)) {
			var segment pairedTranslationSegment
			if i < len(sentence.Source) {
				segment.Source = sentence.Source[i]
			}
			if i < len(sentence.Target) {
				segment.Target = sentence.Target[i]
			}
			item.Segments = append(item.Segments, segment)
		}
		output.Sentences = append(output.Sentences, item)
	}
	return json.Marshal(output)
}

func echoPairedTestResponse(input pairedTranslationInput) (string, error) {
	var sentences []pairedSentence
	for _, item := range input.Sentences {
		parts, err := splitSubtitleText(item.Text, func(s string) bool { return subtitleTargetLength(s) <= input.MaxTargetChars })
		if err != nil {
			return "", err
		}
		target := make([]string, len(parts))
		for i := range target {
			target[i] = "测试"
		}
		if item.TargetText != "" {
			// 排版重试的夹具同样必须保留已冻结译文；不能靠改写触发降级通过。
			target, err = splitSubtitleText(item.TargetText, func(s string) bool { return subtitleTargetLength(s) <= input.MaxTargetChars })
			if err != nil {
				return "", err
			}
			count := max(len(parts), len(target))
			splitFixture := func(text string) []string {
				runes := []rune(text)
				result := make([]string, count)
				for i := range count {
					result[i] = string(runes[i*len(runes)/count : (i+1)*len(runes)/count])
				}
				return result
			}
			if len(parts) < count {
				parts = splitFixture(item.Text)
			}
			if len(target) < count {
				target = splitFixture(item.TargetText)
			}
		}
		sentences = append(sentences, pairedSentence{ID: item.ID, FullTarget: strings.Join(target, ""), Source: parts, Target: target})
	}
	data, err := encodePairedTestResponse(sentences)
	return string(data), err
}

func TestPairedTranslationParallelBatchesCommitInSourceOrder(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 3
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var mu sync.Mutex
	active, peak, laterFinished := 0, 0, 0
	allStarted, laterDone := make(chan struct{}), make(chan struct{})
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		mu.Lock()
		active++
		peak = max(peak, active)
		if active == 3 && input.Sentences[0].ID <= "3" {
			close(allStarted)
		}
		mu.Unlock()
		defer func() { mu.Lock(); active--; mu.Unlock() }()
		if input.Sentences[0].ID <= "3" {
			select {
			case <-allStarted:
			case <-ctx.Done():
				return "", ctx.Err()
			}
			if input.Sentences[0].ID == "1" {
				select {
				case <-laterDone:
				case <-ctx.Done():
					return "", ctx.Err()
				}
			} else {
				mu.Lock()
				laterFinished++
				if laterFinished == 2 {
					close(laterDone)
				}
				mu.Unlock()
			}
		}
		return echoPairedTestResponse(input)
	})}
	var callbacks []int
	result, err := translator.translatePairedSentences(ctx, []string{"One.", "Two.", "Three.", "Four.", "Five.", "Six.", "Seven."}, "en", "zh_cn", 20, 1, func(batch []pairedSentence, done, total int) error {
		if batch[0].ID != fmt.Sprint(done) || total != 7 {
			return fmt.Errorf("回调顺序错误: %+v, %d/%d", batch, done, total)
		}
		callbacks = append(callbacks, done)
		return nil
	})
	if err != nil || peak != 3 || len(result) != 7 || fmt.Sprint(callbacks) != "[1 2 3 4 5 6 7]" {
		t.Fatalf("peak=%d result=%+v callbacks=%v error=%v", peak, result, callbacks, err)
	}
}

func TestPairedTranslationProgressDoesNotWaitForSlowEarlierBatch(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 3
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	firstReleased := make(chan struct{})
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if input.Sentences[0].ID == "1" {
			select {
			case <-firstReleased:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		return echoPairedTestResponse(input)
	})}
	var progress []int
	result, err := translator.translatePairedSentences(ctx, []string{"One.", "Two.", "Three."}, "en", "zh_cn", 20, 1, nil, func(completed, total int) {
		if total != 3 {
			t.Errorf("total = %d, want 3", total)
		}
		progress = append(progress, completed)
		if completed == 1 {
			close(firstReleased)
		}
	})
	if err != nil || len(result) != 3 || fmt.Sprint(progress) != "[0 1 2 3]" {
		t.Fatalf("progress=%v result=%v error=%v", progress, result, err)
	}
	for i, sentence := range result {
		if sentence.ID != fmt.Sprint(i+1) {
			t.Fatalf("output order changed: %+v", result)
		}
	}
}

func TestPairedTranslationCommitsMarkedSourceAfterFailedWindow(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 2
	var mu sync.Mutex
	calls := make(map[string]int)
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		id := input.Sentences[0].ID
		mu.Lock()
		calls[id]++
		mu.Unlock()
		if id == "2" {
			return "", fmt.Errorf("LLM disconnected")
		}
		return echoPairedTestResponse(input)
	})}
	commits := 0
	result, err := translator.translatePairedSentences(context.Background(), []string{"One.", "Two.", "Three."}, "en", "zh_cn", 20, 1, func([]pairedSentence, int, int) error { commits++; return nil })
	if err != nil || len(result) != 3 || calls["2"] != 1 || calls["3"] != 1 || commits != 3 ||
		!result[1].Untranslated || result[1].FullTarget != "[待翻译] Two." || result[0].Untranslated || result[2].Untranslated {
		t.Fatalf("calls=%v commits=%d error=%v", calls, commits, err)
	}
}

func assertPairedOutput(t *testing.T, source, output []*util.SrtBlock, limit int) {
	t.Helper()
	var before, after strings.Builder
	for _, block := range source {
		before.WriteString(compactSubtitleText(block.OriginLanguageSentence))
	}
	var lastEnd int64 = -1
	for i, block := range output {
		after.WriteString(compactSubtitleText(block.OriginLanguageSentence))
		if block.Index != i+1 || !hasSubtitleContent(block.OriginLanguageSentence) || !hasSubtitleContent(block.TargetLanguageSentence) || subtitleTargetLength(block.TargetLanguageSentence) > limit || subtitleTargetLength(block.OriginLanguageSentence) > limit {
			t.Fatalf("无效配对: %+v", block)
		}
		start, end, err := parseSRTTimeline(block.Timestamp)
		if err != nil || start < lastEnd || end <= start {
			t.Fatalf("无效配对时间: %+v, error=%v", block, err)
		}
		lastEnd = end
	}
	if len(output) == 0 || before.String() != after.String() {
		t.Fatalf("原文覆盖发生变化: %q -> %q", before.String(), after.String())
	}
}

func TestPairedTranslationRetriesOnlyInvalidBatchWithSpecificFeedback(t *testing.T) {
	text := "We used Drake's Tootsie Slide without permission."
	valid := pairedSentence{ID: "1", FullTarget: "我们使用了Drake的Tootsie Slide，未经许可。", Source: []string{"We used Drake's", "Tootsie Slide", "without permission."}, Target: []string{"我们使用了Drake的", "Tootsie Slide，", "未经许可。"}}
	tests := []struct {
		name   string
		mutate func(*pairedSentence)
	}{
		{"超长英文专名", func(s *pairedSentence) { s.Target[1] = "《Drake's Tootsie Slide official》" }},
		{"超长汉字", func(s *pairedSentence) { s.Target[1] = strings.Repeat("好", 25) }},
		{"配对缺译文", func(s *pairedSentence) { s.Target = s.Target[:1] }},
		{"原文改写", func(s *pairedSentence) { s.Source[0] = "We use Drake's Tootsie" }},
		{"空译文", func(s *pairedSentence) { s.Target[1] = "" }},
		{"纯标点", func(s *pairedSentence) { s.Target[1] = "》。" }},
		{"换行", func(s *pairedSentence) { s.Target[1] = "Tootsie\nSlide" }},
		{"错误ID", func(s *pairedSentence) { s.ID = "2" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// 每次从 JSON 复制，避免切片共享影响其他样例。
			data, _ := json.Marshal(valid)
			var invalid pairedSentence
			_ = json.Unmarshal(data, &invalid)
			tc.mutate(&invalid)
			var prompts []string
			translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				prompts = append(prompts, prompt)
				sentence := invalid
				if len(prompts) > 1 {
					sentence = valid
				}
				data, err := encodePairedTestResponse([]pairedSentence{sentence})
				return string(data), err
			})}
			_, err := translator.translatePairedSentences(context.Background(), []string{text}, "en", "zh_cn", 24, 3, nil)
			if err != nil || len(prompts) != 2 {
				t.Fatalf("calls=%d error=%v", len(prompts), err)
			}
			if strings.Contains(prompts[0], "Validation issues:") || !strings.Contains(prompts[1], "Validation issues:") || !strings.Contains(prompts[1], text) {
				t.Fatal("失败反馈必须保留原始输入和具体错误")
			}
			if tc.name == "配对缺译文" && (!strings.Contains(prompts[1], `source="Tootsie Slide" target=""`) || !strings.Contains(prompts[1], "重新划分该句的全部segments")) {
				t.Fatal("配对缺失反馈必须包含具体片段和修正要求")
			}
		})
	}
}

func TestPairedTranslationRequiresFullTargetCoverage(t *testing.T) {
	input := pairedTranslationInput{MaxTargetChars: 24, Sentences: []pairedTranslationSource{{ID: "1", Text: "Take any skill and teach it to a class."}}}
	for _, tc := range []struct {
		name   string
		full   string
		target []string
		issue  string
	}{
		{"重复", "选一项技能，给全班讲解。", []string{"选一项技能，", "选一项技能，给全班讲解。"}, "译文分段覆盖错误"},
		{"遗漏", "选一项技能，给全班讲解。", []string{"选一项技能，", "讲解。"}, "译文分段覆盖错误"},
		{"乱序", "选一项技能，给全班讲解。", []string{"给全班讲解。", "选一项技能，"}, "译文分段覆盖错误"},
		{"完整译文换行", "选一项技能，\n给全班讲解。", []string{"选一项技能，", "给全班讲解。"}, "缺少有效的完整译文"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: tc.full, Source: []string{"Take any skill and", "teach it to a class."}, Target: tc.target}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = (&Translator{}).parsePairedTranslation(string(response), input, "en", "zh_cn")
			if err == nil || !strings.Contains(err.Error(), tc.issue) {
				t.Fatalf("未拒绝无效译文覆盖: %v", err)
			}
			if tc.issue == "译文分段覆盖错误" && (!strings.Contains(err.Error(), tc.full) || !strings.Contains(err.Error(), strings.Join(tc.target, ""))) {
				t.Fatalf("译文覆盖反馈必须包含完整译文和实际拼接: %v", err)
			}
		})
	}
}

func TestPairedTranslationDerivesFullTargetAndSegmentsInOneCall(t *testing.T) {
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(string) (string, error) {
		calls++
		return `{"sentences":[{"sentence_id":"1","segments":[{"source":"Take any skill and","target":"选一项技能，"},{"source":"teach it to a class.","target":"给全班讲解。"}]}]}`, nil
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Take any skill and teach it to a class."}, "en", "zh_cn", 24, 1, nil)
	if err != nil || calls != 1 || len(result) != 1 || len(result[0].Target) != 2 || result[0].FullTarget != "选一项技能，给全班讲解。" {
		t.Fatalf("完整翻译和分段应由一次调用完成: calls=%d result=%+v error=%v", calls, result, err)
	}
}

func TestPairedTranslationDerivedTargetPreservesTextAndFrozenTranslation(t *testing.T) {
	for _, tc := range []struct {
		name, language string
		target         []string
	}{
		{"英文词间空格", "en", []string{"Use AI ", "tools."}},
		{"英文词内边界", "en", []string{"cafe", "teria."}},
		{"中文混合拉丁词", "zh_cn", []string{"使用Open", "AI工具。"}},
		{"小数和否定", "zh_cn", []string{"数字是1.5，", "不是15。"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			originLang, targetLang := types.LanguageNameSimplifiedChinese, types.StandardLanguageCode(tc.language)
			input := pairedTranslationInput{MaxSourceChars: 60, MaxTargetChars: 60, Sentences: []pairedTranslationSource{{ID: "1", Text: "阅读内容。"}}}
			data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", Source: []string{"阅读", "内容。"}, Target: tc.target}})
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := (&Translator{}).parsePairedTranslation(string(data), input, originLang, targetLang)
			if err != nil || len(parsed) != 1 || parsed[0].FullTarget != strings.Join(tc.target, "") {
				t.Fatalf("派生译文改动了字符或空格: parsed=%+v err=%v", parsed, err)
			}
		})
	}
	input := pairedTranslationInput{MaxSourceChars: 60, MaxTargetChars: 60, Sentences: []pairedTranslationSource{{ID: "1", Text: "She did not agree.", TargetText: "她没有同意。"}}}
	response := `{"sentences":[{"sentence_id":"1","segments":[{"source":"She did not agree.","target":"她同意了。"}]}]}`
	if _, err := (&Translator{}).parsePairedTranslation(response, input, "en", "zh_cn"); err == nil {
		t.Fatal("取消输出target_text不应允许改写输入中已冻结的译文")
	}
}

func TestPairedTranslationRejectsIncompletePairs(t *testing.T) {
	input := pairedTranslationInput{MaxTargetChars: 50, Sentences: []pairedTranslationSource{{ID: "1", Text: "Hello."}}}
	for _, segments := range []string{
		`[]`,
		`[{"source":"Hello."}]`,
		`[{"target":"你好。"}]`,
		`[{"source":"Hello.","target":"你好。"},{"source":"","target":""}]`,
	} {
		response := `{"sentences":[{"sentence_id":"1","target_text":"你好。","segments":` + segments + `}]}`
		_, err := (&Translator{}).parsePairedTranslation(response, input, "en", "zh_cn")
		if err == nil || !strings.Contains(err.Error(), "缺少") {
			t.Fatalf("未拒绝缺失或空白配对: segments=%s error=%v", segments, err)
		}
	}
}

func TestPairedTranslationKeepsSubjectsWithPredicates(t *testing.T) {
	text := "And the interesting part is that it isn't just a giant database of titles."
	parts := []string{"And the interesting part is", "that it isn't just a giant database of titles."}
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		source, target := []string{"And the interesting part is that it", "isn't just a giant database of titles."}, []string{"而有意思的是，它", "不只是一个庞大的书名数据库。"}
		if calls > 1 {
			if !strings.Contains(prompt, "拆开了主语和谓语") {
				t.Error("纠错请求必须说明语义边界问题")
			}
			source, target = parts, []string{"而有意思的是，", "它不只是一个庞大的书名数据库。"}
		}
		response, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: "而有意思的是，它不只是一个庞大的书名数据库。", Source: source, Target: target}})
		return string(response), err
	})}
	result, err := translator.translatePairedSentences(context.Background(), []string{text}, "en", "zh_cn", 70, 1, nil)
	if err != nil || calls != 2 || len(result) != 1 || len(result[0].Target) != 2 || strings.Join(result[0].Target, "") != "而有意思的是，它不只是一个庞大的书名数据库。" || strings.Join(result[0].Source, "\n") != strings.Join(parts, "\n") {
		t.Fatalf("不自然的分段应被纠正: calls=%d result=%+v err=%v", calls, result, err)
	}
}

func TestSubtitleSubjectBoundaryGuardIsConservative(t *testing.T) {
	for _, tc := range []struct {
		left, right string
		limit       int
		want        bool
	}{
		{"And that it", "isn't just a database.", 70, true},
		{"而有意思的是，它", "不只是一个数据库。", 70, true},
		{"但接下来，我们", "会继续探索。", 70, true},
		{"it", "is", 2, false},
		{"I", "can do it.", 70, false},
		{"We discussed it.", "Isn't it great?", 70, false},
		{"I spoke to him", "yesterday.", 70, false},
		{"这是它", "的名字。", 70, false},
		{"他说：他", "不是那个已经离开的人。", 10, false},
	} {
		if got := subtitleBoundarySplitsSubject(tc.left, tc.right, tc.limit); got != tc.want {
			t.Errorf("%q / %q: got %v want %v", tc.left, tc.right, got, tc.want)
		}
	}
}

func TestPairedTranslationMergesShortSentenceBeforeCheckingSubjectBoundary(t *testing.T) {
	input := pairedTranslationInput{MaxTargetChars: 70, Sentences: []pairedTranslationSource{{ID: "1", Text: "We know that it isn't a database."}}}
	response, _ := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: "我们知道，它不是数据库。", Source: []string{"We know that it", "isn't a database."}, Target: []string{"我们知道，它", "不是数据库。"}}})
	result, err := (&Translator{}).parsePairedTranslation(string(response), input, "en", "zh_cn")
	if err != nil || len(result) != 1 || len(result[0].Source) != 1 || result[0].Target[0] != "我们知道，它不是数据库。" {
		t.Fatalf("可直接合并的短句不应触发额外模型请求: %+v %v", result, err)
	}
}

type budgetedTranslationTestCompleter struct {
	translationCompleterFunc
	complete func(context.Context, string, int) (string, error)
}

func (c budgetedTranslationTestCompleter) ChatCompletionContextWithMaxTokens(ctx context.Context, prompt string, limit int) (string, error) {
	return c.complete(ctx, prompt, limit)
}

func TestPairedTranslationOutputBudgetGrowsOnlyAfterTruncation(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	for _, truncate := range []bool{false, true} {
		var budgets []int
		translator := &Translator{chatCompleter: budgetedTranslationTestCompleter{complete: func(ctx context.Context, prompt string, limit int) (string, error) {
			if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
				return `{"corrections":[]}`, nil
			}
			budgets = append(budgets, limit)
			if truncate && len(budgets) < 3 {
				return "", fmt.Errorf("llm_translation_truncated: output budget exhausted")
			}
			input, err := decodePairedTestInput(prompt)
			if err != nil {
				return "", err
			}
			return echoPairedTestResponse(input)
		}}}
		_, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", 70, 1, nil)
		if err != nil || len(budgets) == 0 || budgets[0] != 2048 {
			t.Fatalf("小批次应使用较小的输出预算: budgets=%v err=%v", budgets, err)
		}
		if truncate && (len(budgets) != 3 || budgets[1] != 4096 || budgets[2] != 8192) || !truncate && len(budgets) != 1 {
			t.Fatalf("截断后应在原重试次数内逐步增加预算: %v", budgets)
		}
	}
}

func TestSubtitleTargetLengthUsesUnicodeCharacters(t *testing.T) {
	for _, tc := range []struct {
		text string
		want int
	}{
		{"", 0},
		{"中文", 2},
		{"𠮷", 1},
		{"，。！？《》", 6},
		{"ＡＢ１２", 4},
		{"Hello, AI 2024!", 15},
		{"Tootsie Slide", 13},
		{"《Tootsie Slide》", 15},
		{"中文 AI 2024。", 11},
		{"café", 4},
	} {
		if got := subtitleTargetLength(tc.text); got != tc.want {
			t.Errorf("%q计数=%d，要求%d", tc.text, got, tc.want)
		}
	}
}

func TestPairedTranslationUnicodeCountIncludesSpacesAndPunctuation(t *testing.T) {
	for _, text := range []string{"测试译文：a b", "测试译文：𠮷"} {
		translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
			input, _ := decodePairedTestInput(prompt)
			data, _ := encodePairedTestResponse([]pairedSentence{{ID: input.Sentences[0].ID, FullTarget: text, Source: []string{"Hello."}, Target: []string{text}}})
			return string(data), nil
		})}
		_, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", subtitleTargetLength(text), 3, nil)
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestPairedTranslationSourceOrderFeedbackShowsExactOriginal(t *testing.T) {
	text := "Your distribution and your product end up getting built at the very same time by the same one person for free."
	wrong := "Your distribution and your product end up getting built by the same one person at the very same time for free."
	translator := &Translator{}
	input := pairedTranslationInput{MaxTargetChars: 50, Sentences: []pairedTranslationSource{{ID: "588", Text: text}}}
	response, _ := encodePairedTestResponse([]pairedSentence{{ID: "588", FullTarget: "渠道和产品由同一个人免费同时打造。", Source: []string{wrong}, Target: []string{"渠道和产品由同一个人免费同时打造。"}}})
	_, err := translator.parsePairedTranslation(string(response), input, "en", "zh_cn")
	if err == nil || !strings.Contains(err.Error(), text) || !strings.Contains(err.Error(), wrong) || !strings.Contains(err.Error(), "重新切成1段") {
		t.Fatalf("未提供可执行的原文修正信息: %v", err)
	}
}

func TestPairedTranslationMergesUnnecessarySegmentsLocally(t *testing.T) {
	for _, tc := range []struct {
		name       string
		targetLang types.StandardLanguageCode
		target     []string
		limit      int
		want       string
	}{
		{"中文整句正好50", "zh_cn", []string{strings.Repeat("好", 24), strings.Repeat("好", 26)}, 50, strings.Repeat("好", 50)},
		{"中文超长保留切分", "zh_cn", []string{strings.Repeat("好", 26), strings.Repeat("好", 26)}, 50, ""},
		{"英文单词保留空格", "en", []string{"Use AI ", "tools today."}, 50, "Use AI tools today."},
		{"中文中的英文词边界", "zh_cn", []string{"使用AI ", "tools提高效率。"}, 50, "使用AI tools提高效率。"},
		{"无法确认词边界保留切分", "en", []string{"cafe", "teria today."}, 50, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			text := "Use AI tools today."
			originLang := types.LanguageNameEnglish
			if tc.targetLang == types.LanguageNameEnglish {
				text = "今天使用AI工具。"
				originLang = types.LanguageNameSimplifiedChinese
			}
			translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				source := []string{text[:3], text[3:]}
				if originLang == types.LanguageNameSimplifiedChinese {
					source = []string{"今天", "使用AI工具。"}
				}
				data, err := encodePairedTestResponse([]pairedSentence{{ID: input.Sentences[0].ID, FullTarget: strings.Join(tc.target, ""), Source: source, Target: tc.target}})
				return string(data), err
			})}
			result, err := translator.translatePairedSentences(context.Background(), []string{text}, originLang, tc.targetLang, tc.limit, 1, nil)
			if err != nil || calls != 1 || len(result) != 1 {
				t.Fatalf("calls=%d result=%+v error=%v", calls, result, err)
			}
			if tc.want == "" {
				if len(result[0].Source) != 2 || len(result[0].Target) != 2 {
					t.Fatalf("超长字幕被合并: %+v", result[0])
				}
			} else if len(result[0].Source) != 1 || result[0].Source[0] != text || len(result[0].Target) != 1 || result[0].Target[0] != tc.want {
				t.Fatalf("合并结果错误: %+v", result[0])
			}
		})
	}
}

func TestPairedTranslationUsesWordTimingAndVariableCueCount(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 16
	config.Conf.App.ShortSubtitleMaxChars = 20
	words := []VttWord{
		{Text: "We", Start: "00:00:00.000", End: "00:00:00.200"},
		{Text: "can", Start: "00:00:00.200", End: "00:00:00.500"},
		{Text: "launch", Start: "00:00:00.600", End: "00:00:01.000"},
		{Text: "after", Start: "00:00:01.500", End: "00:00:01.800"},
		{Text: "review.", Start: "00:00:01.800", End: "00:00:02.500"},
	}
	source := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:02,500", OriginLanguageSentence: "We can launch after review."}}
	completer := &scriptedCompleter{responses: []string{`{"sentences":[{"sentence_id":"1","target_text":"审核后，我们就能发布。","segments":[{"source":"We can launch","target":"审核后，"},{"source":"after review.","target":"我们就能发布。"}]}]}`}}
	blocks, err := (&Translator{chatCompleter: completer}).BatchTranslateSrtBlocks(context.Background(), source, "en", "zh_cn", nil, words)
	if err != nil {
		t.Fatal(err)
	}
	assertPairedOutput(t, source, blocks, 16)
	if len(blocks) != 2 || blocks[0].Timestamp != "00:00:00,000 --> 00:00:01,000" || blocks[1].Timestamp != "00:00:01,500 --> 00:00:02,500" {
		t.Fatalf("未使用词时间: %+v", blocks)
	}
	svc := &YouTubeSubtitleService{}
	dir := t.TempDir()
	if err := svc.writeBilingualSrtFile(blocks, filepath.Join(dir, "bilingual.srt"), true); err != nil {
		t.Fatal(err)
	}
	if err := svc.writeShortSubtitleFile(blocks, []Sentence{{Words: words}}, filepath.Join(dir, "short.srt"), true); err != nil {
		t.Fatal(err)
	}
	short, err := util.ParseSrtFile(filepath.Join(dir, "short.srt"))
	if err != nil || len(short) != 4 {
		t.Fatalf("短字幕应保留译文并独立导出原文: %+v, %v", short, err)
	}
	for i, block := range blocks {
		if short[i*2].OriginLanguageSentence != block.TargetLanguageSentence || short[i*2].Timestamp != block.Timestamp || short[i*2+1].OriginLanguageSentence != block.OriginLanguageSentence {
			t.Fatalf("短字幕缺失整条译文或原文: %+v", short)
		}
	}
}

func TestNormalSubtitleLimitIsIndependentOfShortSubtitles(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 50
	source := "The stress primarily comes from not taking action over something that you can have some control over."
	target := "压力主要源于没有采取行动，针对自己能够掌控的事情。"
	for _, shortLimit := range []int{8, 20, 60} {
		config.Conf.App.ShortSubtitleMaxChars = shortLimit
		calls := 0
		translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
			calls++
			input, err := decodePairedTestInput(prompt)
			if err != nil || input.MaxTargetChars != 50 || input.MaxSourceChars != 50 || input.MaxFullwidthChars != 50 || !strings.Contains(prompt, "两侧整句都在上限内时保持一对") || !strings.Contains(prompt, "中英文、空格和标点各计1") || strings.Contains(prompt, "SAFE_TARGET_CHARS") {
				t.Fatalf("普通字幕未使用独立50字符约束: %+v, %v", input, err)
			}
			data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: "压力主要源于没有采取行动，针对自己能够掌控的事情。", Source: []string{"The stress primarily comes from", "not taking action over something", "that you can have some control over."}, Target: []string{"压力主要源于", "没有采取行动，", "针对自己能够掌控的事情。"}}})
			return string(data), err
		})}
		blocks, err := translator.BatchTranslateSrtBlocks(context.Background(), []*util.SrtBlock{{Index: 1, Timestamp: "00:00:07,359 --> 00:00:15,430", OriginLanguageSentence: source}}, "en", "zh_cn", nil)
		if err != nil || len(blocks) != 3 || calls != 1 || strings.Join([]string{blocks[0].TargetLanguageSentence, blocks[1].TargetLanguageSentence, blocks[2].TargetLanguageSentence}, "") != target {
			t.Fatalf("短字幕参数%d影响普通字幕: %+v calls=%d error=%v", shortLimit, blocks, calls, err)
		}
	}
}

func TestNormalSubtitleFiftyCharacterBoundary(t *testing.T) {
	translator := &Translator{}
	input := pairedTranslationInput{MaxTargetChars: 50, Sentences: []pairedTranslationSource{{ID: "1", Text: "Hello."}}}
	for _, tc := range []struct {
		name, text string
		invalid    bool
	}{
		{"50个汉字", strings.Repeat("好", 50), false},
		{"51个汉字", strings.Repeat("好", 51), true},
		{"49个汉字加全角标点", strings.Repeat("好", 49) + "。", false},
		{"50个汉字加全角标点", strings.Repeat("好", 50) + "。", true},
		{"中英混排50", strings.Repeat("好", 48) + "ab", false},
		{"中英混排51", strings.Repeat("好", 48) + "abc", true},
		{"半角空格计入50", strings.Repeat("好", 48) + " a", false},
		{"半角空格计入51", strings.Repeat("好", 48) + " ab", true},
		{"不再容忍55", strings.Repeat("好", 55), true},
	} {
		data, _ := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: tc.text, Source: []string{"Hello."}, Target: []string{tc.text}}})
		_, err := translator.parsePairedTranslation(string(data), input, "en", "zh_cn")
		if (err != nil) != tc.invalid {
			t.Errorf("%s边界检查错误: %v", tc.name, err)
		}
	}
}

func TestYouTubeSubtitleValidationPreservesOverlengthContent(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 50
	svc := &YouTubeSubtitleService{}
	for _, size := range []int{25, 26, 28, 100} {
		blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:00:00,000 --> 00:00:02,000", OriginLanguageSentence: "Hello.", TargetLanguageSentence: strings.Repeat("好", size)}}
		if err := svc.validateYouTubeSubtitleBlocks(blocks, true); err != nil {
			t.Errorf("最终字幕校验与翻译计数不一致，汉字数%d: %v", size, err)
		}
	}
}

func TestAudioShortSubtitlesPreserveTranslationAndSplitSourceByWords(t *testing.T) {
	texts := strings.Fields("The stress primarily comes from not taking action over something that you can have some control over.")
	var words []types.Word
	for i, text := range texts {
		words = append(words, types.Word{Num: i, Text: text, Start: float64(i), End: float64(i + 1)})
	}
	dir := t.TempDir()
	target := "压力主要源于没有对自己能够掌控的事情采取行动。"
	blocks := []*util.SrtBlock{{Index: 1, OriginLanguageSentence: strings.Join(texts, " "), TargetLanguageSentence: target}}
	param := &types.SubtitleTaskStepParam{TaskBasePath: dir, OriginLanguage: "en", MaxWordOneLine: 5, SubtitleResultType: types.SubtitleResultTypeBilingualTranslationOnTop}
	if err := generateSrtWithTimestamps(blocks, 0, words, 0, param); err != nil {
		t.Fatal(err)
	}
	normal, err := util.ParseSrtFile(filepath.Join(dir, fmt.Sprintf(types.SubtitleTaskSplitBilingualSrtFileNamePattern, 0)))
	if err != nil || len(normal) != 1 {
		t.Fatalf("普通字幕被短字幕参数影响: %+v, %v", normal, err)
	}
	short, err := util.ParseSrtFile(filepath.Join(dir, fmt.Sprintf(types.SubtitleTaskSplitShortOriginSrtFileNamePattern, 0)))
	if err != nil || len(short) < 2 {
		t.Fatalf("短原文没有独立拆分: %+v, %v", short, err)
	}
	var fragments []string
	for _, block := range short {
		if len(strings.Fields(block.OriginLanguageSentence)) > 5 {
			t.Fatalf("短原文超过指定词数: %+v", block)
		}
		fragments = append(fragments, block.OriginLanguageSentence)
	}
	if strings.Join(fragments, " ") != strings.Join(texts, " ") {
		t.Fatalf("短字幕丢失原文: fragments=%q want=%q", fragments, strings.Join(texts, " "))
	}
	mixed, err := util.ParseSrtFile(filepath.Join(dir, fmt.Sprintf(types.SubtitleTaskSplitShortOriginMixedSrtFileNamePattern, 0)))
	if err != nil || len(mixed) != len(short)+1 || mixed[0].OriginLanguageSentence != target || mixed[0].Timestamp != normal[0].Timestamp {
		t.Fatalf("混合短字幕未保留完整译文: %+v, %v", mixed, err)
	}
}

func TestShortSubtitleSplitsOnlySourceAtConfiguredLength(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	source := "The stress primarily comes from not taking action over something that you can have some control over."
	target := "压力主要源于没有对自己能够掌控的事情采取行动。"
	block := &util.SrtBlock{Index: 1, Timestamp: "00:00:00,000 --> 00:00:17,000", OriginLanguageSentence: source, TargetLanguageSentence: target}
	var words []VttWord
	for i, text := range strings.Fields(source) {
		words = append(words, VttWord{Text: text, Start: fmt.Sprintf("00:00:%02d.000", i), End: fmt.Sprintf("00:00:%02d.000", i+1)})
	}
	svc := &YouTubeSubtitleService{}
	counts := map[int]int{}
	for _, limit := range []int{20, 40} {
		config.Conf.App.ShortSubtitleMaxChars = limit
		path := filepath.Join(t.TempDir(), "short.srt")
		if err := svc.writeShortSubtitleFile([]*util.SrtBlock{block}, []Sentence{{Words: words}}, path, true); err != nil {
			t.Fatal(err)
		}
		parsed, err := util.ParseSrtFile(path)
		if err != nil || len(parsed) < 3 || parsed[0].OriginLanguageSentence != target || parsed[0].Timestamp != block.Timestamp {
			t.Fatalf("整条译文丢失或时间变化: %+v, %v", parsed, err)
		}
		var fragments []string
		for _, cue := range parsed[1:] {
			fragments = append(fragments, cue.OriginLanguageSentence)
		}
		if strings.Join(fragments, " ") != source {
			t.Fatalf("短字幕原文不完整: %v", fragments)
		}
		counts[limit] = len(parsed)
	}
	if counts[20] <= counts[40] {
		t.Fatalf("短字幕未按独立参数拆分: %v", counts)
	}
}

func TestPairedTranslationKeepsSourceLengthLimitAfterJoiningCues(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 16
	config.Conf.App.ShortSubtitleMaxChars = 20
	source := []*util.SrtBlock{
		{Index: 1, Timestamp: "00:00:00,000 --> 00:00:01,000", OriginLanguageSentence: "I started reaching out"},
		{Index: 2, Timestamp: "00:00:01,000 --> 00:00:02,000", OriginLanguageSentence: "to companies."},
	}
	completer := &scriptedCompleter{responses: []string{`{"sentences":[{"sentence_id":"1","target_text":"我开始联系公司。","segments":[{"source":"I started","target":"我开始"},{"source":"reaching out","target":"联系"},{"source":"to companies.","target":"公司。"}]}]}`}}
	blocks, err := (&Translator{chatCompleter: completer}).BatchTranslateSrtBlocks(context.Background(), source, "en", "zh_cn", nil)
	if err != nil || len(blocks) != 3 || completer.calls != 1 {
		t.Fatalf("output=%+v calls=%d error=%v", blocks, completer.calls, err)
	}
	assertPairedOutput(t, source, blocks, 16)
}

func TestSubtitleWordTimingPreservesZeroDurationWords(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		words      []VttWord
		want       []subtitleTimingSpan
	}{
		{"金额符号", "$ 20", []VttWord{{Text: "$", Start: "00:00:01.000", End: "00:00:01.000"}, {Text: "20", Start: "00:00:01.000", End: "00:00:01.300"}}, []subtitleTimingSpan{{0, 3, 1000, 1300}}},
		{"有含义的词", "was in", []VttWord{{Text: "was", Start: "00:00:01.000", End: "00:00:01.000"}, {Text: "in", Start: "00:00:01.000", End: "00:00:01.300"}}, []subtitleTimingSpan{{0, 5, 1000, 1300}}},
		{"轻微倒退", "a hundred", []VttWord{{Text: "a", Start: "00:00:01.000", End: "00:00:00.990"}, {Text: "hundred", Start: "00:00:01.000", End: "00:00:01.300"}}, []subtitleTimingSpan{{0, 8, 1000, 1300}}},
		{"连续零时长", "at the end", []VttWord{{Text: "at", Start: "00:00:01.000", End: "00:00:01.000"}, {Text: "the", Start: "00:00:01.000", End: "00:00:01.000"}, {Text: "end", Start: "00:00:01.000", End: "00:00:01.300"}}, []subtitleTimingSpan{{0, 8, 1000, 1300}}},
		{"末尾零时长", "the end", []VttWord{{Text: "the", Start: "00:00:01.000", End: "00:00:01.300"}, {Text: "end", Start: "00:00:01.300", End: "00:00:01.300"}}, []subtitleTimingSpan{{0, 6, 1000, 1300}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spans, err := subtitleWordTimingSpans(tc.words, tc.text)
			if err != nil || fmt.Sprint(spans) != fmt.Sprint(tc.want) {
				t.Fatalf("spans=%+v want=%+v error=%v", spans, tc.want, err)
			}
		})
	}
}

func TestSubtitleWordTimingRejectsUnrecoverableInput(t *testing.T) {
	for _, words := range [][]VttWord{
		{{Text: "lost", Start: "bad", End: "00:00:01.000"}},
		{{Text: "lost", Start: "00:00:02.000", End: "00:00:01.000"}},
		{{Text: "lost", Start: "00:00:01.000", End: "00:00:01.000"}},
		{{Text: "lost", Start: "00:00:01.000", End: "00:00:01.000"}, {Text: "next", Start: "00:00:04.000", End: "00:00:05.000"}},
	} {
		var text []string
		for _, word := range words {
			text = append(text, word.Text)
		}
		if _, err := subtitleWordTimingSpans(words, strings.Join(text, " ")); err == nil {
			t.Fatalf("未拒绝无法恢复的时间: %+v", words)
		}
	}
}

func TestAudioTranslationWorkerExportsMarkedSourceOnUpstreamFailure(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateMaxAttempts = 9
	for _, failure := range []bool{false, true} {
		t.Run(fmt.Sprint(failure), func(t *testing.T) {
			calls := 0
			svc := Service{ChatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				if failure {
					return "", fmt.Errorf("LLM disconnected")
				}
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				return echoPairedTestResponse(input)
			})}
			group, ctx := errgroup.WithContext(context.Background())
			pending := make(chan DataWithId[string], 1)
			pending <- DataWithId[string]{Data: strings.Repeat("a long original phrase ", 20) + "ends.", Id: 0}
			close(pending)
			progress := make(chan DataWithId[TranslationProgress], 10)
			output := make(chan DataWithId[[]*TranslatedItem], 1)
			svc.startTranslateWorker(ctx, group, &types.SubtitleTaskStepParam{TaskBasePath: t.TempDir(), OriginLanguage: "en", TargetLanguage: "zh_cn"}, pending, progress, output)
			err := group.Wait()
			if calls != 1 || err != nil {
				t.Fatalf("calls=%d error=%v", calls, err)
			}
			select {
			case got := <-output:
				if len(got.Data) == 0 || strings.HasPrefix(got.Data[0].TranslatedText, "[待翻译] ") != failure {
					t.Fatalf("失败状态未明确标记: output=%+v", got)
				}
			default:
				t.Fatal("没有导出翻译结果")
			}
		})
	}
}

func TestWordLevelSubtitleRouteExportsPairedNormalAndIndependentShortSubtitles(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 16
	config.Conf.App.ShortSubtitleMaxChars = 8
	fixture := "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nWe<00:00:00.200> can<00:00:00.500> launch<00:00:01.000> after<00:00:01.500> review.\n"
	req := subtitleRoutingTestRequest(t, fixture)
	completer := &scriptedCompleter{responses: []string{`{"sentences":[{"sentence_id":"1","target_text":"审核后，我们就能发布。","segments":[{"source":"We can launch","target":"审核后，"},{"source":"after review.","target":"我们就能发布。"}]}]}`}}
	svc := &YouTubeSubtitleService{translator: &Translator{chatCompleter: completer}}
	if _, err := svc.processYouTubeSubtitle(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if completer.calls != 1 {
		t.Fatalf("翻译和分段只应调用一次模型，实际%d", completer.calls)
	}
	var timestamps []string
	for _, name := range []string{types.SubtitleTaskOriginLanguageSrtFileName, types.SubtitleTaskTargetLanguageSrtFileName, types.SubtitleTaskBilingualSrtFileName} {
		blocks, err := util.ParseSrtFile(filepath.Join(req.TaskBasePath, name))
		if err != nil || len(blocks) != 2 {
			t.Fatalf("字幕产物%s: %v, %+v", name, err, blocks)
		}
		if timestamps == nil {
			for _, block := range blocks {
				timestamps = append(timestamps, block.Timestamp)
			}
		}
		for i, block := range blocks {
			if block.Timestamp != timestamps[i] {
				t.Fatalf("字幕产物时间轴不一致: %s", name)
			}
		}
	}
	short, err := util.ParseSrtFile(filepath.Join(req.TaskBasePath, types.SubtitleTaskShortOriginMixedSrtFileName))
	if err != nil || len(short) <= 2 || short[0].OriginLanguageSentence != "审核后，" {
		t.Fatalf("短字幕未独立导出: %+v, %v", short, err)
	}
}

func TestAudioModalFilterPreservesPairedSource(t *testing.T) {
	calls := 0
	svc := Service{ChatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if !strings.Contains(prompt, "启用语气词过滤") || !strings.Contains(prompt, "原文仍须原样完整保留") {
			t.Fatal("语气词过滤只能作用于译文")
		}
		return `{"sentences":[{"sentence_id":"1","target_text":"不，我可能会来。","segments":[{"source":"Um, no, I might come.","target":"不，我可能会来。"}]}]}`, nil
	})}
	items, err := svc.splitTextAndTranslateV2(context.Background(), "", "Um, no, I might come.", "en", "zh_cn", true, 0, nil)
	if err != nil || calls != 1 || len(items) != 1 || items[0].OriginText != "Um, no, I might come." {
		t.Fatalf("items=%+v calls=%d error=%v", items, calls, err)
	}
}
