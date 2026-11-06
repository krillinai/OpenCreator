package dubbing

import (
	"context"
	"fmt"
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
	Merge(ctx context.Context, cues []Cue, language types.StandardLanguageCode, minDuration, gapTolerance float64, maxGroupSize, maxSubtitleChars int) ([][]int, error)
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
	var semanticMerger SemanticMerger
	if merger, ok := p.optimizer.(SemanticMerger); ok && merger != nil {
		semanticMerger = merger
		minDuration := p.cfg.MinSubtitleDuration
		gapTolerance := p.cfg.GapTolerance
		maxGroupSize := p.cfg.MaxChunkSize
		maxSubtitleChars := p.cfg.MaxSubtitleChars
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
		if maxSubtitleChars <= 0 {
			maxSubtitleChars = defaults.MaxSubtitleChars
		}
		// A transient model failure must not silently discard semantic merging:
		// singleton fallback can create very short slots that no TTS can satisfy.
		for attempt := 0; attempt < 3; attempt++ {
			merged, err := merger.Merge(ctx, cues, language, minDuration, gapTolerance, maxGroupSize, maxSubtitleChars)
			if err == nil {
				if validated, valid := validateCueGroups(merged, cues, minDuration, gapTolerance, maxGroupSize, maxSubtitleChars); valid {
					groups = validated
					break
				}
			}
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, ctxErr
			}
		}
	}
	if semanticMerger != nil {
		groups = rescueShortSingletons(ctx, groups, cues, language, semanticMerger, p.cfg)
	}
	maxSubtitleChars := p.cfg.MaxSubtitleChars
	if maxSubtitleChars <= 0 {
		maxSubtitleChars = DefaultConfig().MaxSubtitleChars
	}
	for _, group := range groups {
		if subtitleLength(cueGroupText(group, cues)) > maxSubtitleChars {
			return nil, fmt.Errorf("subtitle group exceeds %d characters", maxSubtitleChars)
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
			if err == nil && optimized != "" && optimized != spoken && subtitleLength(optimized) <= maxSubtitleChars {
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

// rescueShortSingletons gives an extremely short cue one local semantic check
// after the global merge response. This keeps a failed global response from
// leaving a standalone fragment that no natural TTS voice can fit.
func rescueShortSingletons(ctx context.Context, groups [][]int, cues []Cue, language types.StandardLanguageCode, merger SemanticMerger, cfg Config) [][]int {
	if merger == nil || len(groups) < 2 {
		return groups
	}
	minDuration := cfg.MinSubtitleDuration
	if minDuration <= 0 {
		minDuration = DefaultConfig().MinSubtitleDuration
	}
	// A cue around one second can still be an inseparable continuation of its
	// neighbor (for example, a second half of a short suggestion). Keep the
	// rescue pass limited to these short windows instead of rechecking every cue.
	shortLimit := minDuration * 0.4
	if shortLimit <= 0 {
		return groups
	}
	gapTolerance := cfg.GapTolerance
	if gapTolerance < 0 {
		gapTolerance = DefaultConfig().GapTolerance
	}
	maxGroupSize := cfg.MaxChunkSize
	if maxGroupSize < 2 {
		maxGroupSize = DefaultConfig().MaxChunkSize
	}
	maxSubtitleChars := cfg.MaxSubtitleChars
	if maxSubtitleChars <= 0 {
		maxSubtitleChars = DefaultConfig().MaxSubtitleChars
	}

	for groupIndex := 0; groupIndex < len(groups); groupIndex++ {
		group := groups[groupIndex]
		if len(group) != 1 || group[0] < 0 || group[0] >= len(cues) || cues[group[0]].Duration() >= shortLimit {
			continue
		}
		for _, neighborIndex := range []int{groupIndex - 1, groupIndex + 1} {
			if neighborIndex < 0 || neighborIndex >= len(groups) || len(groups[neighborIndex]) != 1 {
				continue
			}
			left, right := groups[groupIndex][0], groups[neighborIndex][0]
			if left > right {
				left, right = right, left
			}
			if right != left+1 || cues[right].Start-cues[left].End > gapTolerance ||
				subtitleLength(cueGroupText([]int{left, right}, cues)) > maxSubtitleChars ||
				maxGroupSize < 2 {
				continue
			}
			decision, err := merger.Merge(ctx, []Cue{cues[left], cues[right]}, language, minDuration, gapTolerance, maxGroupSize, maxSubtitleChars)
			if err != nil || len(decision) != 1 || len(decision[0]) != 2 || decision[0][0] != 0 || decision[0][1] != 1 {
				continue
			}
			low, high := groupIndex, neighborIndex
			if low > high {
				low, high = high, low
			}
			groups[low] = []int{left, right}
			groups = append(groups[:high], groups[high+1:]...)
			if high < groupIndex {
				groupIndex--
			}
			break
		}
	}
	return groups
}

func singletonCueGroups(count int) [][]int {
	groups := make([][]int, count)
	for i := range groups {
		groups[i] = []int{i}
	}
	return groups
}

func validateCueGroups(groups [][]int, cues []Cue, minDuration, gapTolerance float64, maxGroupSize, maxSubtitleChars int) ([][]int, bool) {
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
		if len(group) > 1 && subtitleLength(cueGroupText(group, cues)) > maxSubtitleChars {
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

func cueGroupText(group []int, cues []Cue) string {
	texts := make([]string, 0, len(group))
	for _, index := range group {
		texts = append(texts, CleanTextForSpeech(cues[index].Text))
	}
	return strings.Join(texts, " ")
}
