package types

// TaskProgress describes real work reported by a service. Percent uses that
// service's range; the pipeline maps it into its stage's overall range.
type TaskProgress struct {
	Phase     string
	Percent   int
	Message   string
	Completed int
	Total     int
}

func (t *SubtitleTask) SetDetailedProgressReporter(reporter func(TaskProgress)) {
	if t != nil {
		t.detailedProgressReporter = reporter
	}
}

// 恢复消息不修改旧任务百分比；统一流水线负责保持整体进度单调。
func (t *SubtitleTask) ReportTranslationRecovery(message string) {
	if t != nil && t.detailedProgressReporter != nil {
		t.detailedProgressReporter(TaskProgress{Phase: "recovering_translation", Message: message})
	}
}

func (t *SubtitleTask) ReportProgress(progress TaskProgress) {
	if t == nil {
		return
	}
	progress.Percent = max(0, min(100, progress.Percent))
	if t.detailedProgressReporter != nil {
		t.detailedProgressReporter(progress)
		return
	}
	t.SetProgress(uint8(progress.Percent))
}
