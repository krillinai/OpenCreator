package dubbing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"os"
	"path/filepath"
	"strings"
)

type Result struct {
	Plan   []PlanItem
	Chunks []Chunk
	Report Report
	DubSRT string
	Audio  string
	Video  string
}

type Runner struct {
	deps Dependencies
}

func NewRunner(deps Dependencies) *Runner {
	if deps.Config == (Config{}) {
		deps.Config = DefaultConfig()
	} else {
		defaults := DefaultConfig()
		if deps.Config.RewriteMaxAttempts <= 0 {
			deps.Config.RewriteMaxAttempts = defaults.RewriteMaxAttempts
		}
		if deps.Config.Estimator == "" {
			deps.Config.Estimator = defaults.Estimator
		}
		if deps.Config.MaxTimingOverrunRatio <= 0 {
			deps.Config.MaxTimingOverrunRatio = defaults.MaxTimingOverrunRatio
		}
		if deps.Config.MaxSubtitleChars <= 0 {
			deps.Config.MaxSubtitleChars = defaults.MaxSubtitleChars
		}
	}
	if deps.FFmpeg == nil {
		deps.FFmpeg = defaultFFmpegRunner
	}
	if deps.Duration == nil {
		deps.Duration = util.GetSpeechDuration
		if deps.SpeechBounds == nil {
			deps.SpeechBounds = util.GetSpeechBounds
		}
	}
	if deps.OutputAudio == "" && deps.Workdir != "" {
		deps.OutputAudio = filepath.Join(deps.Workdir, types.TtsResultAudioFileName)
	}
	if deps.OutputVideo == "" && deps.Workdir != "" {
		deps.OutputVideo = filepath.Join(deps.Workdir, types.SubtitleTaskVideoWithTtsFileName)
	}
	return &Runner{deps: deps}
}

func (r *Runner) Run(ctx context.Context) (Result, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := r.validate(); err != nil {
		return Result{}, err
	}

	cues, err := ParseSRTFile(r.deps.InputSRT)
	if err != nil {
		return Result{}, err
	}
	if len(cues) == 0 {
		return Result{}, errors.New("input srt has no cues")
	}

	dubbingDir := filepath.Join(r.deps.Workdir, DubbingDirName)
	segmentsDir := filepath.Join(dubbingDir, "segments")
	if err := os.MkdirAll(segmentsDir, 0755); err != nil {
		return Result{}, err
	}

	cleanedCues := cleanCuesForSpeech(cues)
	if err := WriteSRTFile(filepath.Join(dubbingDir, DubbingInputFileName), cleanedCues); err != nil {
		return Result{}, err
	}

	r.reportPhase("planning_voice")
	optimizer := NewLLMOptimizer(r.deps.Chat, r.deps.Language, r.deps.Config.MaxSubtitleChars)
	planner := NewPlanner(r.deps.Config, NewStatisticalEstimator())
	plan, err := planner.PlanContext(ctx, cues, r.deps.Language)
	if err != nil {
		return Result{}, err
	}
	if r.deps.SourceSRT != "" {
		if err := attachSourceTexts(plan, r.deps.SourceSRT); err != nil {
			return Result{}, err
		}
	}

	r.reportPhase("generating_voice")
	plan, err = GenerateRawSegmentsWithProgress(
		ctx,
		r.deps.TTS,
		plan,
		r.deps.Voice,
		segmentsDir,
		r.deps.FFmpeg,
		r.deps.Duration,
		r.deps.ReportProgress,
	)
	if err != nil {
		return Result{}, err
	}

	plan, err = r.rewriteOverlongSegments(ctx, plan, planner.estimator, optimizer, segmentsDir)
	if err != nil {
		return Result{}, err
	}
	plan, err = r.mergeStubbornSegments(ctx, plan, planner.estimator, optimizer, segmentsDir)
	if err != nil {
		return Result{}, err
	}

	r.reportPhase("fitting_voice")
	fitted, report, err := FitSegmentsWithConfig(plan, r.deps.Config)
	if err != nil {
		// Preserve the measured mismatch so a failed job explains whether the
		// source speech window or the target TTS duration caused the overflow.
		_ = writeJSON(filepath.Join(dubbingDir, DubbingReportName), report)
		return Result{}, err
	}

	dubSRT := filepath.Join(dubbingDir, DubSubtitleFileName)
	finalCues := BuildDubCues(fitted)
	if err := WriteSRTFile(r.deps.InputSRT, finalCues); err != nil {
		return Result{}, fmt.Errorf("write final target subtitles: %w", err)
	}
	if err := WriteSRTFile(dubSRT, finalCues); err != nil {
		return Result{}, err
	}
	if err := writeJSON(filepath.Join(dubbingDir, DubbingPlanFileName), fitted); err != nil {
		return Result{}, err
	}
	if err := writeJSON(filepath.Join(dubbingDir, DubbingReportName), report); err != nil {
		return Result{}, err
	}

	if err := ensureParentDir(r.deps.OutputAudio); err != nil {
		return Result{}, err
	}
	r.reportPhase("assembling_voice")
	if err := assembleAudioWithBounds(fitted, segmentsDir, r.deps.OutputAudio, r.deps.FFmpeg, r.deps.SpeechBounds); err != nil {
		return Result{}, err
	}
	if err := ensureNonEmptyFile(r.deps.OutputAudio, "output audio"); err != nil {
		return Result{}, err
	}

	if !r.deps.AudioOnly {
		if err := ensureParentDir(r.deps.OutputVideo); err != nil {
			return Result{}, err
		}
		r.reportPhase("muxing_voice")
		if err := r.deps.FFmpeg(buildMuxArgs(r.deps.InputVideo, r.deps.OutputAudio, r.deps.OutputVideo)); err != nil {
			return Result{}, err
		}
		if err := ensureNonEmptyFile(r.deps.OutputVideo, "output video"); err != nil {
			return Result{}, err
		}
	} else {
		r.deps.OutputVideo = ""
	}

	return Result{
		Plan:   fitted,
		Chunks: nil,
		Report: report,
		DubSRT: dubSRT,
		Audio:  r.deps.OutputAudio,
		Video:  r.deps.OutputVideo,
	}, nil
}

func (r *Runner) rewriteOverlongSegments(ctx context.Context, plan []PlanItem, estimator DurationEstimator, optimizer TextOptimizer, segmentsDir string) ([]PlanItem, error) {
	maxAttempts := r.deps.Config.RewriteMaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = DefaultConfig().RewriteMaxAttempts
	}
	maxAcceptedRatio := 1 + normalizeTimingConfig(r.deps.Config).MaxTimingOverrunRatio

	for {
		overlong := overlongPlanIndexes(plan)
		pending := make([]int, 0, len(overlong))
		for _, index := range overlong {
			item := plan[index]
			slot := item.OriginalEnd - item.OriginalStart
			ratio := item.ActualDuration / slot
			// Once the bounded rewrite budget is exhausted, keep the last valid
			// TTS result and let FitSegments apply the mandatory atempo fallback.
			if item.RewriteAttempts >= maxAttempts {
				continue
			}
			// The first overrun must be sent to LLM. After a rewrite, a result
			// within the configured tolerance is eligible for atempo fitting.
			if item.RewriteAttempts > 0 && ratio <= maxAcceptedRatio+timelineComparisonEpsilon {
				continue
			}
			pending = append(pending, index)
		}
		if len(pending) == 0 {
			return plan, nil
		}
		if !r.deps.Config.EnableTextRewrite || optimizer == nil {
			return plan, nil
		}

		for _, index := range pending {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			item := &plan[index]
			slot := item.OriginalEnd - item.OriginalStart
			if item.RewriteAttempts >= maxAttempts {
				continue
			}
			reason := fmt.Sprintf("measured_too_long: actual_duration=%.3f, slot_duration=%.3f", item.ActualDuration, slot)
			previousTarget := item.SpokenText
			if strings.TrimSpace(item.SourceText) != "" {
				var rewritten string
				var rewriteErr error
				if contextualOptimizer, ok := optimizer.(ContextualMeasuredTextOptimizer); ok {
					surrounding := RewriteContext{OriginalTarget: item.OriginalText}
					if index > 0 {
						surrounding.PreviousSource = plan[index-1].SourceText
						surrounding.PreviousTarget = plan[index-1].OriginalText
					}
					if index+1 < len(plan) {
						surrounding.NextSource = plan[index+1].SourceText
						surrounding.NextTarget = plan[index+1].OriginalText
					}
					rewritten, rewriteErr = contextualOptimizer.OptimizeWithSourceMeasuredContext(ctx, item.SourceText, item.SpokenText, slot, item.ActualDuration, reason, surrounding)
				} else if measuredOptimizer, ok := optimizer.(MeasuredSourceAwareTextOptimizer); ok {
					rewritten, rewriteErr = measuredOptimizer.OptimizeWithSourceMeasured(ctx, item.SourceText, item.SpokenText, slot, item.ActualDuration, reason)
				} else if sourceOptimizer, ok := optimizer.(SourceAwareTextOptimizer); ok {
					rewritten, rewriteErr = sourceOptimizer.OptimizeWithSource(ctx, item.SourceText, item.SpokenText, slot, reason)
				} else {
					rewriteErr = fmt.Errorf("source-aware optimizer is unavailable")
				}
				rewritten = strings.TrimSpace(rewritten)
				if rewriteErr != nil || rewritten == "" || rewritten == previousTarget {
					if ctxErr := ctx.Err(); ctxErr != nil {
						return nil, ctxErr
					}
					item.RewriteAttempts++
					continue
				}
				item.SpokenText = rewritten
			} else {
				rewritten, rewriteErr := optimizer.Optimize(ctx, item.SpokenText, slot, reason)
				if rewriteErr != nil {
					if ctxErr := ctx.Err(); ctxErr != nil {
						return nil, ctxErr
					}
					item.RewriteAttempts++
					continue
				}
				rewritten = strings.TrimSpace(rewritten)
				if rewritten == "" || rewritten == previousTarget {
					item.RewriteAttempts++
					continue
				}
				item.SpokenText = rewritten
			}
			item.RewriteAttempts++
			if estimator != nil {
				estimate, confidence, estimateErr := estimator.Estimate(item.SpokenText, r.deps.Language)
				if estimateErr != nil {
					return nil, fmt.Errorf("estimate rewritten subtitle %d: %w", item.Index, estimateErr)
				}
				item.EstimatedDuration = estimate
				item.EstimateConfidence = confidence
			}
			if err := regenerateRawSegment(ctx, r.deps.TTS, item, r.deps.Voice, segmentsDir, r.deps.FFmpeg, r.deps.Duration); err != nil {
				return nil, err
			}
		}
	}
}

func attachSourceTexts(plan []PlanItem, sourcePath string) error {
	cues, err := ParseSRTFile(sourcePath)
	if err != nil {
		return fmt.Errorf("parse source subtitles for dubbing: %w", err)
	}
	byIndex := make(map[int]Cue, len(cues))
	for _, cue := range cues {
		byIndex[cue.Index] = cue
	}
	for i := range plan {
		indexes := plan[i].CueIndexes
		if len(indexes) == 0 {
			indexes = []int{plan[i].Index}
		}
		parts := make([]string, 0, len(indexes))
		for _, index := range indexes {
			cue, ok := byIndex[index]
			if !ok {
				return fmt.Errorf("source subtitle cue %d missing for target cue %d", index, plan[i].Index)
			}
			text := strings.TrimSpace(cue.Text)
			if text != "" {
				parts = append(parts, text)
			}
		}
		plan[i].SourceText = strings.Join(parts, " ")
	}
	return nil
}

func overlongPlanIndexes(plan []PlanItem) []int {
	overlong := make([]int, 0)
	for i, item := range plan {
		slot := item.OriginalEnd - item.OriginalStart
		if slot > 0 && item.ActualDuration > slot+timelineComparisonEpsilon {
			overlong = append(overlong, i)
		}
	}
	return overlong
}

func (r *Runner) validate() error {
	if r.deps.Workdir == "" {
		return errors.New("workdir is required")
	}
	if r.deps.InputSRT == "" {
		return errors.New("input srt is required")
	}
	if r.deps.TTS == nil {
		return errors.New("tts is required")
	}
	if r.deps.AudioOnly {
		return nil
	}
	if r.deps.InputVideo == "" {
		return errors.New("input video is required")
	}
	if err := ensureNonEmptyFile(r.deps.InputVideo, "input video"); err != nil {
		return err
	}
	return nil
}

func cleanCuesForSpeech(cues []Cue) []Cue {
	cleaned := make([]Cue, len(cues))
	copy(cleaned, cues)
	for i := range cleaned {
		cleaned[i].Text = CleanTextForSpeech(cleaned[i].Text)
	}
	return cleaned
}

func ensureParentDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "" || dir == "." {
		return nil
	}
	return os.MkdirAll(dir, 0755)
}

func ensureNonEmptyFile(path, label string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("%s %s: %w", label, path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("%s %s is a directory", label, path)
	}
	if info.Size() == 0 {
		return fmt.Errorf("%s %s is empty", label, path)
	}
	return nil
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0644)
}

func (r *Runner) reportPhase(phase string) {
	if r.deps.ReportPhase != nil {
		r.deps.ReportPhase(phase)
	}
}
