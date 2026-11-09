package dubbing

import (
	"context"
	"strings"
	"testing"
)

type fakeChat struct {
	response  string
	responses []string
	query     string
	calls     int
	err       error
}

func (f *fakeChat) ChatCompletion(query string) (string, error) {
	f.calls++
	f.query = query
	if len(f.responses) > 0 {
		index := f.calls - 1
		if index >= len(f.responses) {
			index = len(f.responses) - 1
		}
		return f.responses[index], f.err
	}
	return f.response, f.err
}

func TestLLMOptimizerReturnsSingleLineTrimmedText(t *testing.T) {
	chat := &fakeChat{response: "  更自然的说法\n"}
	opt := NewLLMOptimizer(chat, "zh_cn")
	got, err := opt.Optimize(context.Background(), "字幕腔文本", 2.5, "estimated_too_long")
	if err != nil {
		t.Fatalf("Optimize() error = %v", err)
	}
	if got != "更自然的说法" {
		t.Fatalf("Optimize() = %q", got)
	}
	if !strings.Contains(chat.query, "简体中文（zh_cn）") || !strings.Contains(chat.query, "不要翻译成其他语言") {
		t.Fatalf("planning prompt omitted target language: %q", chat.query)
	}
}

func TestLLMOptimizerUsesEnglishTargetLanguage(t *testing.T) {
	chat := &fakeChat{response: "A shorter line."}
	_, err := NewLLMOptimizer(chat, "en").Optimize(context.Background(), "A longer original line.", 1.2, "estimated_too_long")
	if err != nil {
		t.Fatalf("Optimize() error = %v", err)
	}
	if !strings.Contains(chat.query, "English（en）") {
		t.Fatalf("planning prompt omitted English target language: %q", chat.query)
	}
}

func TestLLMOptimizerRejectsChineseToEnglishRewrite(t *testing.T) {
	chat := &fakeChat{response: "You're watching study videos, but not actually studying."}
	_, err := NewLLMOptimizer(chat, "zh_cn").Optimize(context.Background(), "你在看学习视频，却没有真正学习。", 3.83, "estimated_too_long")
	if err == nil || !strings.Contains(err.Error(), "lost Chinese text") {
		t.Fatalf("Optimize() error = %v, want language rejection", err)
	}

	chat.response = `{"target_text":"Study."}`
	_, err = NewLLMOptimizer(chat, "zh_cn").OptimizeWithSourceMeasured(context.Background(), "You're studying.", "你正在学习，但还没有真正开始。", 1, 2, "measured_too_long")
	if err == nil || !strings.Contains(err.Error(), "lost Chinese text") {
		t.Fatalf("OptimizeWithSourceMeasured() error = %v, want language rejection", err)
	}
}

func TestLLMOptimizerAllowsChineseRewriteWithEnglishTerm(t *testing.T) {
	chat := &fakeChat{response: "调用 API。"}
	got, err := NewLLMOptimizer(chat, "zh_cn").Optimize(context.Background(), "打开 API 接口并调用。", 2, "estimated_too_long")
	if err != nil || got != "调用 API。" {
		t.Fatalf("Optimize() = %q, %v, want mixed-language Chinese subtitle", got, err)
	}
}

func TestLLMOptimizerNormalizesJSONFallbackResponse(t *testing.T) {
	chat := &fakeChat{response: `{"target_text":"压缩后的目标"}`}
	got, err := NewLLMOptimizer(chat, "zh_cn").Optimize(context.Background(), "目标原文", 1.2, "estimated_too_long")
	if err != nil {
		t.Fatalf("Optimize() error = %v", err)
	}
	if got != "压缩后的目标" {
		t.Fatalf("Optimize() = %q, want target_text value", got)
	}
}

func TestLLMOptimizerRejectsSubtitleOverConfiguredLength(t *testing.T) {
	chat := &fakeChat{response: strings.Repeat("字", DefaultMaxSubtitleChars+1)}
	_, err := NewLLMOptimizer(chat, "zh_cn").Optimize(context.Background(), "原文", 2, "estimated_too_long")
	if err == nil || !strings.Contains(err.Error(), "exceeds 70 characters") {
		t.Fatalf("Optimize() error = %v, want subtitle length rejection", err)
	}
}

func TestLLMOptimizerHandlesNilChatAndEmptyResponse(t *testing.T) {
	if got, err := NewLLMOptimizer(nil, "zh_cn").Optimize(context.Background(), "原文", 1.2, "test"); err != nil || got != "原文" {
		t.Fatalf("nil chat Optimize() = %q, %v", got, err)
	}
	chat := &fakeChat{response: "   \n"}
	got, err := NewLLMOptimizer(chat, "zh_cn").Optimize(context.Background(), "原文", 1.2, "test")
	if err != nil || got != "原文" {
		t.Fatalf("empty response Optimize() = %q, %v", got, err)
	}
}

func TestLLMOptimizerHandlesNilAndCancelledContext(t *testing.T) {
	chat := &fakeChat{response: "改写"}
	got, err := NewLLMOptimizer(chat, "zh_cn").Optimize(nil, "原文", 1.2, "test")
	if err != nil || got != "改写" {
		t.Fatalf("nil context Optimize() = %q, %v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewLLMOptimizer(chat, "zh_cn").Optimize(ctx, "原文", 1.2, "test"); err == nil {
		t.Fatalf("cancelled context should return error")
	}
}

func TestLLMOptimizerCancelledContextWinsBeforeNilChat(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewLLMOptimizer(nil, "zh_cn").Optimize(ctx, "原文", 1.2, "test"); err == nil {
		t.Fatalf("cancelled context with nil chat should return error")
	}
}

func TestLLMOptimizerOptimizeWithSourceParsesOnlyTargetText(t *testing.T) {
	chat := &fakeChat{response: `{"source_text":"模型不应改写的源文","target_text":"目标口播\n"}`}
	opt := NewLLMOptimizer(chat, "zh_cn")
	target, err := opt.OptimizeWithSourceMeasured(context.Background(), "原始源文", "原始目标文", 2.4, 3.6, "measured_too_long")
	if err != nil {
		t.Fatalf("OptimizeWithSource() error = %v", err)
	}
	if target != "目标口播" {
		t.Fatalf("OptimizeWithSource() = %q", target)
	}
	if !strings.Contains(chat.query, "原始源文") || !strings.Contains(chat.query, "原始目标文") {
		t.Fatalf("source-aware prompt did not include both subtitles: %q", chat.query)
	}
	if !strings.Contains(chat.query, "禁止改写") || !strings.Contains(chat.query, `{"target_text":"..."}`) {
		t.Fatalf("source protection was not explicit in prompt: %q", chat.query)
	}
	if !strings.Contains(chat.query, "3.600") || !strings.Contains(chat.query, "1.5x") || !strings.Contains(chat.query, "原样返回") || !strings.Contains(chat.query, "不能把“重复。”改成“再”") {
		t.Fatalf("measured timing budget was not explicit in prompt: %q", chat.query)
	}
	if !strings.Contains(chat.query, "简体中文（zh_cn）") || !strings.Contains(chat.query, "不要翻译成其他语言") {
		t.Fatalf("measured rewrite prompt omitted target language: %q", chat.query)
	}
}

func TestLLMOptimizerAllowsUnchangedMeaningWhenShorteningIsImpossible(t *testing.T) {
	chat := &fakeChat{response: `{"target_text":"重复。"}`}
	_, err := NewLLMOptimizer(chat, "zh_cn").OptimizeWithSourceMeasured(context.Background(), "Repeat.", "重复。", 0.527, 0.739, "measured_too_long")
	if err == nil || !strings.Contains(err.Error(), "did not shorten") {
		t.Fatalf("OptimizeWithSourceMeasured() error = %v, want runner to keep original for timing fallback", err)
	}
	if !strings.Contains(chat.query, "原样返回当前目标文本") || !strings.Contains(chat.query, "先保证意思准确和表达完整") {
		t.Fatalf("prompt must permit semantic-preserving fallback: %q", chat.query)
	}
}

func TestLLMOptimizerOptimizeWithSourceRejectsNonShorterReply(t *testing.T) {
	chat := &fakeChat{response: `{"target_text":"原始目标文"}`}
	_, err := NewLLMOptimizer(chat, "zh_cn").OptimizeWithSourceMeasured(context.Background(), "源文", "原始目标文", 2, 3, "measured_too_long")
	if err == nil || !strings.Contains(err.Error(), "did not shorten") {
		t.Fatalf("OptimizeWithSource() error = %v, want non-shorter rejection", err)
	}
}

func TestLLMOptimizerUsesOriginalTranslationAndAdjacentContext(t *testing.T) {
	chat := &fakeChat{response: `{"target_text":"巩固记忆。"}`}
	surrounding := RewriteContext{
		OriginalTarget: "然后让它牢牢记住。",
		PreviousSource: "Students who just reread it, 40%.",
		PreviousTarget: "只重读的学生记住四成。",
		NextSource:     "Test yourself again tomorrow.",
		NextTarget:     "明天再测一次。",
	}
	got, err := NewLLMOptimizer(chat, "zh_cn").OptimizeWithSourceMeasuredContext(
		context.Background(), "Then make it stick.", "然后把它粘牢。", 1.2, 1.8, "measured_too_long", surrounding,
	)
	if err != nil || got != "巩固记忆。" {
		t.Fatalf("contextual rewrite = %q, %v", got, err)
	}
	for _, text := range []string{
		"Then make it stick.", "然后让它牢牢记住。", "然后把它粘牢。",
		"Students who just reread it, 40%.", "Test yourself again tomorrow.",
		"惯用语按上下文含义表达", "动作及其次数和顺序", "不能只写“再自测一次”", "本段不能改成“教过”", "不要强行把它改成独立句", "不能缩成缺宾语的“然后巩固”",
	} {
		if !strings.Contains(chat.query, text) {
			t.Fatalf("contextual prompt missing %q: %s", text, chat.query)
		}
	}
}
