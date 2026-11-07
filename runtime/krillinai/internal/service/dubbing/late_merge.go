package dubbing

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type mergeCandidate struct {
	left, right int
	predicted   float64
}

// Only a measured failure that survived the rewrite pass can spend a
// neighboring subtitle's time. A very short continuation may follow a period.
func (r *Runner) mergeStubbornSegments(ctx context.Context, plan []PlanItem, estimator DurationEstimator, optimizer *LLMOptimizer, segmentsDir string) ([]PlanItem, error) {
	if optimizer == nil || optimizer.chat == nil || len(plan) < 2 || r.deps.Config.MaxChunkSize == 1 {
		return plan, nil
	}
	maxRatio := 1 + normalizeTimingConfig(r.deps.Config).MaxTimingOverrunRatio
	maxChars := r.deps.Config.MaxSubtitleChars
	if maxChars <= 0 {
		maxChars = DefaultMaxSubtitleChars
	}
	gapTolerance := r.deps.Config.GapTolerance
	if gapTolerance < 0 {
		gapTolerance = DefaultConfig().GapTolerance
	}
	for i := 0; i < len(plan); i++ {
		if plan[i].ActualDuration/planSlot(plan[i]) <= maxRatio+timelineComparisonEpsilon {
			continue
		}
		candidates := make([]mergeCandidate, 0, 2)
		for _, neighbor := range []int{i - 1, i + 1} {
			if neighbor < 0 || neighbor >= len(plan) {
				continue
			}
			left, right := i, neighbor
			if left > right {
				left, right = right, left
			}
			a, b := plan[left], plan[right]
			shortContinuation := right == i && planSlot(plan[i]) <= 1.0
			if len(a.CueIndexes) != 1 || len(b.CueIndexes) != 1 ||
				b.OriginalStart-a.OriginalEnd > gapTolerance ||
				((hasSentenceEnd(a.SpokenText) || hasSentenceEnd(a.SourceText)) && !shortContinuation) ||
				subtitleLength(joinSpoken(a.SpokenText, b.SpokenText)) > maxChars {
				continue
			}
			// A two-cue merge cannot preserve a source sentence that continues
			// outside the pair; its missing clause would be lost to the model.
			if (left > 0 && !hasSentenceEnd(plan[left-1].SourceText) && !hasSentenceEnd(a.SourceText)) ||
				(right+1 < len(plan) && !hasSentenceEnd(b.SourceText)) {
				continue
			}
			predicted := (a.ActualDuration + b.ActualDuration) / (b.OriginalEnd - a.OriginalStart)
			candidates = append(candidates, mergeCandidate{left, right, predicted})
		}
		sort.Slice(candidates, func(a, b int) bool { return candidates[a].predicted < candidates[b].predicted })
		for _, choice := range candidates {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			left, right := plan[choice.left], plan[choice.right]
			merge, err := optimizer.ShouldMergeForTiming(ctx, left, right)
			if err != nil || !merge {
				if ctxErr := ctx.Err(); ctxErr != nil {
					return nil, ctxErr
				}
				continue
			}
			combined := left
			combined.CueIndexes = append(append([]int(nil), left.CueIndexes...), right.CueIndexes...)
			combined.OriginalEnd = right.OriginalEnd
			combined.OriginalText = joinSpoken(left.OriginalText, right.OriginalText)
			combined.SourceText = joinSpoken(left.SourceText, right.SourceText)
			combined.CleanText = joinSpoken(left.CleanText, right.CleanText)
			combined.SpokenText = joinSpoken(left.SpokenText, right.SpokenText)
			combined.RewriteAttempts += right.RewriteAttempts
			if estimator != nil {
				combined.EstimatedDuration, combined.EstimateConfidence, err = estimator.Estimate(combined.SpokenText, r.deps.Language)
				if err != nil {
					return nil, err
				}
			}
			candidateDir := filepath.Join(segmentsDir, "merge_candidates")
			candidatePath := filepath.Join(candidateDir, "raw", fmt.Sprintf("%d.wav", combined.Index))
			if err := regenerateRawSegment(ctx, r.deps.TTS, &combined, r.deps.Voice, candidateDir, r.deps.FFmpeg, r.deps.Duration); err != nil {
				_ = os.Remove(candidatePath)
				if ctxErr := ctx.Err(); ctxErr != nil {
					return nil, ctxErr
				}
				continue
			}
			if combined.ActualDuration/planSlot(combined) > maxRatio+timelineComparisonEpsilon {
				_ = os.Remove(candidatePath)
				continue
			}
			if err := os.Rename(candidatePath, filepath.Join(segmentsDir, "raw", fmt.Sprintf("%d.wav", left.Index))); err != nil {
				return nil, err
			}
			plan[choice.left] = combined
			plan = append(plan[:choice.right], plan[choice.right+1:]...)
			i = choice.left
			break
		}
	}
	return plan, nil
}

func planSlot(item PlanItem) float64 {
	return math.Max(item.OriginalEnd-item.OriginalStart, timelineComparisonEpsilon)
}

func joinSpoken(left, right string) string {
	return strings.TrimSpace(strings.TrimSpace(left) + " " + strings.TrimSpace(right))
}

func hasSentenceEnd(text string) bool {
	text = strings.TrimRight(strings.TrimSpace(text), " \t\n\r\"'”’）)]}")
	return strings.HasSuffix(text, ".") || strings.HasSuffix(text, "!") || strings.HasSuffix(text, "?") ||
		strings.HasSuffix(text, "。") || strings.HasSuffix(text, "！") || strings.HasSuffix(text, "？")
}
