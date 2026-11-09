package dubbing

import (
	"context"
	"fmt"

	"krillin-ai/internal/types"
)

type Planner struct {
	cfg       Config
	estimator DurationEstimator
}

func NewPlanner(cfg Config, estimator DurationEstimator) *Planner {
	if estimator == nil {
		estimator = NewStatisticalEstimator()
	}
	return &Planner{cfg: cfg, estimator: estimator}
}

func (p *Planner) Plan(cues []Cue, language types.StandardLanguageCode) ([]PlanItem, error) {
	return p.PlanContext(context.Background(), cues, language)
}

// Keep translated subtitle boundaries until measured TTS proves that a slot
// cannot be fitted naturally. The runner may then merge a verified continuation.
func (p *Planner) PlanContext(ctx context.Context, cues []Cue, language types.StandardLanguageCode) ([]PlanItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	maxSubtitleChars := p.cfg.MaxSubtitleChars
	if maxSubtitleChars <= 0 {
		maxSubtitleChars = DefaultConfig().MaxSubtitleChars
	}
	plan := make([]PlanItem, 0, len(cues))
	for _, cue := range cues {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		clean := CleanTextForSpeech(cue.Text)
		if subtitleLength(clean) > maxSubtitleChars {
			return nil, fmt.Errorf("subtitle %d exceeds %d characters", cue.Index, maxSubtitleChars)
		}
		estimate, confidence, err := p.estimator.Estimate(clean, language)
		if err != nil {
			return nil, err
		}
		plan = append(plan, PlanItem{
			Index:              cue.Index,
			CueIndexes:         []int{cue.Index},
			OriginalStart:      cue.Start,
			OriginalEnd:        cue.End,
			OriginalText:       cue.Text,
			CleanText:          clean,
			SpokenText:         clean,
			EstimatedDuration:  estimate,
			EstimateConfidence: confidence,
		})
	}
	return plan, nil
}
