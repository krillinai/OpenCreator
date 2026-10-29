package pipeline

import (
	"krillin-ai/internal/types"
	"sync"
)

type ProgressReporter func(phase string, percent int, message string, counts ...ProgressCounts)

// Keep retries, overlapping work and legacy callbacks from moving a stage
// backwards. Counts and messages still flow when the integer percent is equal.
func monotonicProgress(report ProgressReporter) ProgressReporter {
	var mu sync.Mutex
	last := 0
	return func(phase string, percent int, message string, counts ...ProgressCounts) {
		if report == nil {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		last = max(last, min(99, percent))
		report(phase, last, message, counts...)
	}
}

func forwardTaskProgress(task *types.SubtitleTask, report ProgressReporter, scale func(int) int) {
	task.SetDetailedProgressReporter(func(progress types.TaskProgress) {
		if report == nil {
			return
		}
		percent := progress.Percent
		if scale != nil {
			percent = scale(percent)
		}
		if progress.Total > 0 {
			report(progress.Phase, percent, progress.Message, ProgressCounts{progress.Completed, progress.Total})
		} else {
			report(progress.Phase, percent, progress.Message)
		}
	})
}
