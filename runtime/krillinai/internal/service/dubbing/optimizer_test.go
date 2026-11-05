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
	opt := NewLLMOptimizer(chat)
	got, err := opt.Optimize(context.Background(), "字幕腔文本", 2.5, "estimated_too_long")
	if err != nil {
		t.Fatalf("Optimize() error = %v", err)
	}
	if got != "更自然的说法" {
		t.Fatalf("Optimize() = %q", got)
	}
	if chat.query == "" {
		t.Fatalf("expected optimizer to call chat")
	}
}

func TestLLMOptimizerNormalizesJSONFallbackResponse(t *testing.T) {
	chat := &fakeChat{response: `{"target_text":"压缩后的目标"}`}
	got, err := NewLLMOptimizer(chat).Optimize(context.Background(), "目标原文", 1.2, "estimated_too_long")
	if err != nil {
		t.Fatalf("Optimize() error = %v", err)
	}
	if got != "压缩后的目标" {
		t.Fatalf("Optimize() = %q, want target_text value", got)
	}
}

func TestLLMOptimizerHandlesNilChatAndEmptyResponse(t *testing.T) {
	if got, err := NewLLMOptimizer(nil).Optimize(context.Background(), "原文", 1.2, "test"); err != nil || got != "原文" {
		t.Fatalf("nil chat Optimize() = %q, %v", got, err)
	}
	chat := &fakeChat{response: "   \n"}
	got, err := NewLLMOptimizer(chat).Optimize(context.Background(), "原文", 1.2, "test")
	if err != nil || got != "原文" {
		t.Fatalf("empty response Optimize() = %q, %v", got, err)
	}
}

func TestLLMOptimizerHandlesNilAndCancelledContext(t *testing.T) {
	chat := &fakeChat{response: "改写"}
	got, err := NewLLMOptimizer(chat).Optimize(nil, "原文", 1.2, "test")
	if err != nil || got != "改写" {
		t.Fatalf("nil context Optimize() = %q, %v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewLLMOptimizer(chat).Optimize(ctx, "原文", 1.2, "test"); err == nil {
		t.Fatalf("cancelled context should return error")
	}
}

func TestLLMOptimizerCancelledContextWinsBeforeNilChat(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := NewLLMOptimizer(nil).Optimize(ctx, "原文", 1.2, "test"); err == nil {
		t.Fatalf("cancelled context with nil chat should return error")
	}
}

func TestLLMOptimizerOptimizeWithSourceParsesOnlyTargetText(t *testing.T) {
	chat := &fakeChat{response: `{"source_text":"模型不应改写的源文","target_text":"目标口播\n"}`}
	opt := NewLLMOptimizer(chat)
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
	if !strings.Contains(chat.query, "3.600") || !strings.Contains(chat.query, "1.5x") || !strings.Contains(chat.query, "明显更短") {
		t.Fatalf("measured timing budget was not explicit in prompt: %q", chat.query)
	}
}

func TestLLMOptimizerOptimizeWithSourceRejectsNonShorterReply(t *testing.T) {
	chat := &fakeChat{response: `{"target_text":"原始目标文"}`}
	_, err := NewLLMOptimizer(chat).OptimizeWithSourceMeasured(context.Background(), "源文", "原始目标文", 2, 3, "measured_too_long")
	if err == nil || !strings.Contains(err.Error(), "did not shorten") {
		t.Fatalf("OptimizeWithSource() error = %v, want non-shorter rejection", err)
	}
}
