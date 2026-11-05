package dubbing

import (
	"context"
	"strings"

	"krillin-ai/internal/types"
)

type Planner struct {
	cfg       Config
	estimator DurationEstimator
	optimizer TextOptimizer
}

// SemanticMerger is deliberately optional. A failed or unavailable model
// must leave the original cue boundaries intact.
type SemanticMerger interface {
	Merge(ctx context.Context, cues []Cue, language types.StandardLanguageCode, minDuration, gapTolerance float64, maxGroupSize int) ([][]int, error)
}

func NewPlanner(cfg Config, estimator DurationEstimator, optimizer TextOptimizer) *Planner {
	if estimator == nil {
		estimator = NewStatisticalEstimator()
	}
	return &Planner{
		cfg:       cfg,
		estimator: estimator,
		optimizer: optimizer,
	}
}

func (p *Planner) Plan(cues []Cue, language types.StandardLanguageCode) ([]PlanItem, error) {
	return p.PlanContext(context.Background(), cues, language)
}

func (p *Planner) PlanContext(ctx context.Context, cues []Cue, language types.StandardLanguageCode) ([]PlanItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(cues) == 0 {
		return nil, nil
	}

	groups := singletonCueGroups(len(cues))
	if merger, ok := p.optimizer.(SemanticMerger); ok && merger != nil {
		minDuration := p.cfg.MinSubtitleDuration
		gapTolerance := p.cfg.GapTolerance
		maxGroupSize := p.cfg.MaxChunkSize
		defaults := DefaultConfig()
		if minDuration <= 0 {
			minDuration = defaults.MinSubtitleDuration
		}
		if gapTolerance < 0 {
			gapTolerance = defaults.GapTolerance
		}
		if maxGroupSize < 2 {
			maxGroupSize = defaults.MaxChunkSize
		}
		// A transient model failure must not silently discard semantic merging:
		// singleton fallback can create very short slots that no TTS can satisfy.
		for attempt := 0; attempt < 3; attempt++ {
			merged, err := merger.Merge(ctx, cues, language, minDuration, gapTolerance, maxGroupSize)
			if err == nil {
				if validated, valid := validateCueGroups(merged, cues, minDuration, gapTolerance, maxGroupSize); valid {
					groups = validated
					break
				}
			}
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, ctxErr
			}
		}
	}

	plan := make([]PlanItem, 0, len(groups))
	for _, group := range groups {
		if len(group) == 0 {
			continue
		}
		first, last := cues[group[0]], cues[group[len(group)-1]]
		var texts []string
		for _, index := range group {
			texts = append(texts, CleanTextForSpeech(cues[index].Text))
		}
		clean := strings.Join(texts, " ")
		var originalTexts []string
		for _, index := range group {
			originalTexts = append(originalTexts, cues[index].Text)
		}
		originalText := strings.Join(originalTexts, " ")
		estimate, confidence, err := p.estimator.Estimate(clean, language)
		if err != nil {
			return nil, err
		}

		spoken := clean
		rewriteAttempts := 0
		available := last.End - first.Start
		if p.cfg.EnableTextRewrite && estimate > available && p.optimizer != nil {
			optimized, err := p.optimizer.Optimize(ctx, clean, available, "estimated_too_long")
			if err == nil && optimized != "" && optimized != spoken {
				spoken = optimized
				rewriteAttempts = 1
				// The rewritten text is the final text used by both subtitles and TTS.
				rewrittenEstimate, rewrittenConfidence, estimateErr := p.estimator.Estimate(spoken, language)
				if estimateErr != nil {
					return nil, estimateErr
				}
				estimate = rewrittenEstimate
				confidence = rewrittenConfidence
			}
		}

		cueIndexes := make([]int, len(group))
		for i, index := range group {
			cueIndexes[i] = cues[index].Index
		}
		plan = append(plan, PlanItem{
			Index:              first.Index,
			CueIndexes:         cueIndexes,
			OriginalStart:      first.Start,
			OriginalEnd:        last.End,
			OriginalText:       originalText,
			CleanText:          clean,
			SpokenText:         spoken,
			EstimatedDuration:  estimate,
			EstimateConfidence: confidence,
			RewriteAttempts:    rewriteAttempts,
		})
	}

	return plan, nil
}

func singletonCueGroups(count int) [][]int {
	groups := make([][]int, count)
	for i := range groups {
		groups[i] = []int{i}
	}
	return groups
}

func validateCueGroups(groups [][]int, cues []Cue, minDuration, gapTolerance float64, maxGroupSize int) ([][]int, bool) {
	if len(groups) == 0 {
		return nil, false
	}
	seen := make(map[int]bool, len(cues))
	validated := make([][]int, 0, len(cues))
	lastGroupIndex := -1
	for _, group := range groups {
		if len(group) == 0 || len(group) > maxGroupSize {
			return nil, false
		}
		for i, index := range group {
			if index < 0 || index >= len(cues) || seen[index] {
				return nil, false
			}
			if index <= lastGroupIndex {
				return nil, false
			}
			if i > 0 {
				previous := group[i-1]
				if index != previous+1 || cues[index].Start-cues[previous].End > gapTolerance {
					return nil, false
				}
				if cues[index].Duration() > minDuration || cues[previous].Duration() > minDuration {
					return nil, false
				}
			}
			seen[index] = true
			lastGroupIndex = index
		}
		validated = append(validated, append([]int(nil), group...))
	}
	if len(seen) != len(cues) {
		return nil, false
	}
	return validated, true
}
