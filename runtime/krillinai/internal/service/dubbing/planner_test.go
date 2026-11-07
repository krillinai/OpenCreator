package dubbing

import (
	"context"
	"krillin-ai/internal/types"
	"testing"
)

func TestPlannerPreservesShortCompleteSentences(t *testing.T) {
	planner := NewPlanner(DefaultConfig(), NewStatisticalEstimator())
	cues := []Cue{
		{Index: 23, Start: 49.928, End: 51.654, Text: "这叫帕金森定律。"},
		{Index: 24, Start: 51.654, End: 54.130, Text: "工作会把你给它的时间填满。"},
	}
	plan, err := planner.Plan(cues, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan) != 2 || plan[0].Index != 23 || plan[1].Index != 24 ||
		plan[0].SpokenText != cues[0].Text || plan[1].SpokenText != cues[1].Text ||
		plan[0].RewriteAttempts != 0 || plan[1].RewriteAttempts != 0 {
		t.Fatalf("plan = %+v, want original separate cues", plan)
	}
}

func TestPlannerDefersRewriteUntilTTSIsMeasured(t *testing.T) {
	input := "你在看学习视频，却没有真正学习。"
	planner := NewPlanner(DefaultConfig(), NewStatisticalEstimator())
	plan, err := planner.Plan([]Cue{{Index: 1, Start: 0, End: 3.83, Text: input}}, types.LanguageNameSimplifiedChinese)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan) != 1 || plan[0].SpokenText != input || plan[0].RewriteAttempts != 0 {
		t.Fatalf("plan = %+v, want original target subtitle", plan)
	}
}

func TestPlannerRejectsOverlongOriginalSubtitle(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MaxSubtitleChars = 4
	planner := NewPlanner(cfg, NewStatisticalEstimator())
	_, err := planner.Plan([]Cue{{Index: 1, Start: 0, End: 1, Text: "这是一条很长的字幕"}}, types.LanguageNameSimplifiedChinese)
	if err == nil {
		t.Fatal("Plan() should reject subtitles over the configured length")
	}
}

func TestPlannerHonorsCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	planner := NewPlanner(DefaultConfig(), NewStatisticalEstimator())
	if _, err := planner.PlanContext(ctx, []Cue{{Index: 1, Start: 0, End: 1, Text: "你好"}}, types.LanguageNameSimplifiedChinese); err == nil {
		t.Fatal("PlanContext() should stop on cancellation")
	}
}
