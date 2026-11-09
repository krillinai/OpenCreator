package util

import (
	"fmt"
	"testing"
)

func TestSplitTextSentences(t *testing.T) {
	origin_sentence := "Now, I'm Ryan D'Aris, founder and CEO of flowstate.com"
	sentences := SplitTextSentences(origin_sentence, 55)
	fmt.Println("origin sentence:", origin_sentence)
	for i, sentence := range sentences {
		fmt.Printf("sentence %d, got '%s'\n", i, sentence)
	}

	// 期望的结果：应该保持为一个完整句子，因为有效字符数小于70
	if len(sentences) != 1 {
		t.Errorf("Expected 1 sentence, got %d sentences", len(sentences))
	}
}

func TestSpeechDurationFromBoundarySilence(t *testing.T) {
	got := speechDurationFromSilence(1.27, 0.05825, 1.04467)
	if got < 0.9863 || got > 0.9865 {
		t.Fatalf("effective speech duration = %.4f, want about 0.9864", got)
	}
}

func TestSpeechDurationFromSilenceKeepsAllSilencePlaceholder(t *testing.T) {
	if got := speechDurationFromSilence(0.1, 0.1, 0); got != 0.1 {
		t.Fatalf("all-silence duration = %.3f, want 0.100", got)
	}
}
