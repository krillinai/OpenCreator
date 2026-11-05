package dubbing

import (
	"context"
	"krillin-ai/internal/types"
	"testing"
)

func TestPlannerKeepsOnePlanItemPerCue(t *testing.T) {
	cfg := DefaultConfig()
	cues := []Cue{
		{Index: 1, Start: 0, End: 0.8, Text: "你好"},
		{Index: 2, Start: 1.0, End: 2.2, Text: "我们开始吧"},
		{Index: 3, Start: 5.0, End: 6.0, Text: "下一段"},
	}
	planner := NewPlanner(cfg, NewStatisticalEstimator(), nil)
	plan, err := planner.Plan(cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatalf("Plan() error = %v", err)
	}
	if len(plan) != 3 {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPlannerKeepsAdjacentCuesIndependent(t *testing.T) {
	cfg := DefaultConfig()
	cues := []Cue{
		{Index: 1, Start: 0, End: 3.0, Text: "这是第一句已经足够长的字幕"},
		{Index: 2, Start: 3.2, End: 6.2, Text: "这是第二句同样足够长的字幕"},
	}
	planner := NewPlanner(cfg, NewStatisticalEstimator(), nil)
	plan, err := planner.Plan(cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatalf("Plan() error = %v", err)
	}
	if len(plan) != 2 {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPlannerDoesNotCreateChunkPlan(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MaxChunkSize = 2
	cues := []Cue{
		{Index: 1, Start: 0, End: 0.5, Text: "一"},
		{Index: 2, Start: 0.6, End: 1.1, Text: "二"},
		{Index: 3, Start: 1.2, End: 1.7, Text: "三"},
	}
	planner := NewPlanner(cfg, NewStatisticalEstimator(), nil)
	plan, err := planner.Plan(cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatalf("Plan() error = %v", err)
	}
	if len(plan) != 3 {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPlannerUsesLLMSemanticMergeForAdjacentShortCues(t *testing.T) {
	cfg := DefaultConfig()
	cfg.EnableTextRewrite = false
	chat := &fakeChat{response: `{"groups":[[1,2],[3]]}`}
	planner := NewPlanner(cfg, NewStatisticalEstimator(), NewLLMOptimizer(chat))
	cues := []Cue{
		{Index: 1, Start: 0, End: 0.8, Text: "因为我们已经准备好了"},
		{Index: 2, Start: 0.9, End: 1.7, Text: "所以现在可以开始。"},
		{Index: 3, Start: 2.0, End: 2.8, Text: "下一句。"},
	}
	plan, err := planner.PlanContext(context.Background(), cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatalf("PlanContext() error = %v", err)
	}
	if len(plan) != 2 || len(plan[0].CueIndexes) != 2 || plan[0].CueIndexes[0] != 1 || plan[0].CueIndexes[1] != 2 {
		t.Fatalf("plan=%+v", plan)
	}
	if plan[0].OriginalStart != 0 || plan[0].OriginalEnd != 1.7 || plan[0].SpokenText != "因为我们已经准备好了 所以现在可以开始。" {
		t.Fatalf("merged plan item=%+v", plan[0])
	}
}

func TestPlannerRejectsInvalidLLMSemanticMerge(t *testing.T) {
	cfg := DefaultConfig()
	cfg.EnableTextRewrite = false
	chat := &fakeChat{response: `{"groups":[[1,3],[2]]}`}
	planner := NewPlanner(cfg, NewStatisticalEstimator(), NewLLMOptimizer(chat))
	cues := []Cue{
		{Index: 1, Start: 0, End: 0.8, Text: "第一段"},
		{Index: 2, Start: 0.9, End: 1.7, Text: "第二段"},
		{Index: 3, Start: 1.8, End: 2.6, Text: "第三段"},
	}
	plan, err := planner.PlanContext(context.Background(), cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatalf("PlanContext() error = %v", err)
	}
	if len(plan) != len(cues) {
		t.Fatalf("invalid merge changed cue boundaries: %+v", plan)
	}
}

func TestPlannerRetriesTransientSemanticMergeFailure(t *testing.T) {
	cfg := DefaultConfig()
	cfg.EnableTextRewrite = false
	chat := &fakeChat{responses: []string{"not json", `{"groups":[[1,2],[3]]}`}}
	planner := NewPlanner(cfg, NewStatisticalEstimator(), NewLLMOptimizer(chat))
	cues := []Cue{
		{Index: 1, Start: 0, End: 0.8, Text: "因为我们已经准备好了"},
		{Index: 2, Start: 0.9, End: 1.7, Text: "所以现在可以开始。"},
		{Index: 3, Start: 2.0, End: 2.8, Text: "下一句。"},
	}
	plan, err := planner.PlanContext(context.Background(), cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatalf("PlanContext() error = %v", err)
	}
	if chat.calls != 2 || len(plan) != 2 || len(plan[0].CueIndexes) != 2 {
		t.Fatalf("calls=%d plan=%+v, want retry and merged cues", chat.calls, plan)
	}
}
