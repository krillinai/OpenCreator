package dubbing

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLateMergeNeverCrossesCompleteSentence(t *testing.T) {
	chat := &fakeChat{response: `{"merge":true}`}
	plan := []PlanItem{
		{Index: 1, CueIndexes: []int{1}, OriginalStart: 0, OriginalEnd: 1, SpokenText: "这叫帕金森定律。", SourceText: "This is Parkinson's Law.", ActualDuration: 1.5},
		{Index: 2, CueIndexes: []int{2}, OriginalStart: 1, OriginalEnd: 2, SpokenText: "工作会填满时间。", SourceText: "Work fills time.", ActualDuration: 0.5},
	}
	runner := NewRunner(Dependencies{Config: DefaultConfig()})
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), t.TempDir())
	if err != nil || len(got) != 2 || chat.calls != 0 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want complete sentence boundary", got, chat.calls, err)
	}
}

func TestLateMergeAllowsVeryShortDependentCommandAfterCompleteSentence(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rawDir, "67.wav"), []byte("original segment"), 0644); err != nil {
		t.Fatal(err)
	}
	chat := &fakeChat{response: `{"merge":true}`}
	runner := NewRunner(Dependencies{
		TTS: &fakeTTS{writeOnReturn: true}, Config: DefaultConfig(), Duration: func(string) (float64, error) { return 2, nil },
	})
	plan := []PlanItem{
		{Index: 67, CueIndexes: []int{67}, OriginalStart: 152.568, OriginalEnd: 154.296, SpokenText: "然后休息5分钟。", SourceText: "then take a 5-minute break.", ActualDuration: 1.258},
		{Index: 68, CueIndexes: []int{68}, OriginalStart: 154.296, OriginalEnd: 154.823, SpokenText: "重复。", SourceText: "Repeat.", ActualDuration: 0.716},
	}
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), dir)
	if err != nil || len(got) != 1 || len(got[0].CueIndexes) != 2 || chat.calls != 1 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want measured semantic continuation", got, chat.calls, err)
	}
	if !strings.Contains(chat.query, "极短的动作延续") || !strings.Contains(chat.query, "语法通顺、意思完整") || !strings.Contains(chat.query, "重复同一意思") || got[0].SpokenText != "然后休息5分钟。 重复。" {
		t.Fatalf("merge prompt = %q, result = %+v; want preserved commands", chat.query, got[0])
	}
}

func TestLateMergeEnforcesTargetSubtitleLength(t *testing.T) {
	chat := &fakeChat{response: `{"merge":true}`}
	plan := []PlanItem{
		{Index: 1, CueIndexes: []int{1}, OriginalStart: 0, OriginalEnd: 1, SpokenText: strings.Repeat("字", 40), ActualDuration: 1.5},
		{Index: 2, CueIndexes: []int{2}, OriginalStart: 1, OriginalEnd: 2, SpokenText: strings.Repeat("字", 40), ActualDuration: 0.5},
	}
	runner := NewRunner(Dependencies{Config: DefaultConfig()})
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), t.TempDir())
	if err != nil || len(got) != 2 || chat.calls != 0 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want 70-character limit", got, chat.calls, err)
	}
}

func TestLateMergeRequiresSemanticApproval(t *testing.T) {
	chat := &fakeChat{response: `{"merge":false}`}
	plan := []PlanItem{
		{Index: 1, CueIndexes: []int{1}, OriginalStart: 0, OriginalEnd: 1, SpokenText: "第一条字幕", ActualDuration: 1.5},
		{Index: 2, CueIndexes: []int{2}, OriginalStart: 1, OriginalEnd: 2, SpokenText: "第二条字幕。", ActualDuration: 0.5},
	}
	runner := NewRunner(Dependencies{Config: DefaultConfig()})
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), t.TempDir())
	if err != nil || len(got) != 2 || chat.calls != 1 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want semantic veto", got, chat.calls, err)
	}
}

func TestLateMergeRejectsMeasuredCandidateThatStillNeedsExcessiveSpeed(t *testing.T) {
	dir := t.TempDir()
	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		t.Fatal(err)
	}
	firstPath := filepath.Join(rawDir, "1.wav")
	if err := os.WriteFile(firstPath, []byte("original segment"), 0644); err != nil {
		t.Fatal(err)
	}
	chat := &fakeChat{response: `{"merge":true}`}
	runner := NewRunner(Dependencies{
		TTS: &fakeTTS{writeOnReturn: true}, Config: DefaultConfig(), Duration: func(string) (float64, error) { return 2.3, nil },
	})
	plan := []PlanItem{
		{Index: 1, CueIndexes: []int{1}, OriginalStart: 0, OriginalEnd: 1, SpokenText: "因为我们已准备好", ActualDuration: 1.5},
		{Index: 2, CueIndexes: []int{2}, OriginalStart: 1, OriginalEnd: 2, SpokenText: "所以可以开始。", ActualDuration: 0.5},
	}
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), dir)
	if err != nil || len(got) != 2 || chat.calls != 1 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want rejected measured merge", got, chat.calls, err)
	}
	content, err := os.ReadFile(firstPath)
	if err != nil || string(content) != "original segment" {
		t.Fatalf("original raw audio changed: %q, %v", content, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "merge_candidates", "raw", "1.wav")); !os.IsNotExist(err) {
		t.Fatalf("temporary candidate should be removed: %v", err)
	}
}

func TestLateMergeMeasuresCombinedSpeechEvenWhenStandaloneDurationsExceedSlot(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "raw"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "raw", "60.wav"), []byte("original segment"), 0644); err != nil {
		t.Fatal(err)
	}
	chat := &fakeChat{response: `{"merge":true}`}
	runner := NewRunner(Dependencies{
		TTS: &fakeTTS{writeOnReturn: true}, Config: DefaultConfig(), Duration: func(string) (float64, error) { return 4.5, nil },
	})
	plan := []PlanItem{
		{Index: 60, CueIndexes: []int{60}, OriginalStart: 0, OriginalEnd: 1.8, SpokenText: "一项汇总数百个实验的大型综述发现，", ActualDuration: 3.7},
		{Index: 61, CueIndexes: []int{61}, OriginalStart: 1.8, OriginalEnd: 4.8, SpokenText: "间隔学习几乎总是胜过临时抱佛脚。", ActualDuration: 2.8},
	}
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), dir)
	if err != nil || len(got) != 1 || chat.calls != 1 || got[0].ActualDuration != 4.5 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want measured combined speech", got, chat.calls, err)
	}
}

func TestLateMergeDoesNotJoinOnlyPartOfThreeCueSourceSentence(t *testing.T) {
	chat := &fakeChat{response: `{"merge":true}`}
	plan := []PlanItem{
		{Index: 44, CueIndexes: []int{44}, OriginalStart: 0, OriginalEnd: 2, SourceText: "In one study, students who were simply told", SpokenText: "学生只被告知", ActualDuration: 1},
		{Index: 45, CueIndexes: []int{45}, OriginalStart: 2, OriginalEnd: 4, SourceText: "they'd have to teach the material remembered more", SpokenText: "要教这些内容的学生记得更多", ActualDuration: 2.5},
		{Index: 46, CueIndexes: []int{46}, OriginalStart: 4, OriginalEnd: 6, SourceText: "than students who expected a test.", SpokenText: "比预期考试的学生多。", ActualDuration: 2.5},
	}
	runner := NewRunner(Dependencies{Config: DefaultConfig()})
	got, err := runner.mergeStubbornSegments(context.Background(), plan, nil, NewLLMOptimizer(chat, "zh_cn"), t.TempDir())
	if err != nil || len(got) != 3 || chat.calls != 0 {
		t.Fatalf("plan = %+v, calls = %d, error = %v; want intact source sentence boundary", got, chat.calls, err)
	}
}
