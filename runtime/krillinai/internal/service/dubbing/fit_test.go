package dubbing

import (
	"strings"
	"testing"
)

func TestFitTimelineProducesMonotonicTimesAndChunkSpeed(t *testing.T) {
	cfg := DefaultConfig()
	plan := []PlanItem{
		{Index: 1, OriginalStart: 0, OriginalEnd: 1, SpokenText: "一", ActualDuration: 0.8, ChunkID: 1},
		{Index: 2, OriginalStart: 1.1, OriginalEnd: 2, SpokenText: "二", ActualDuration: 0.8, ChunkID: 1},
	}
	chunks := []Chunk{{ID: 1, Items: []int{0, 1}, Start: 0, End: 2.5}}
	got, _, report, err := FitTimeline(plan, chunks, cfg)
	if err != nil {
		t.Fatalf("FitTimeline() error = %v", err)
	}
	if got[0].NewStart != 0 || got[1].NewStart < got[0].NewEnd {
		t.Fatalf("timeline overlaps: %+v", got)
	}
	if report.MaxSpeedFactor <= 0 {
		t.Fatalf("MaxSpeedFactor not set: %+v", report)
	}
}

func TestFitTimelineUsesChunkAudioAndEstimatedWeights(t *testing.T) {
	cfg := DefaultConfig()
	plan := []PlanItem{
		{Index: 1, EstimatedDuration: 1, ChunkID: 1},
		{Index: 2, EstimatedDuration: 3, ChunkID: 1},
	}
	chunks := []Chunk{{ID: 1, Items: []int{0, 1}, Start: 10, End: 15, ActualDuration: 4}}

	got, _, report, err := FitTimeline(plan, chunks, cfg)
	if err != nil {
		t.Fatalf("FitTimeline() error = %v", err)
	}
	if got[0].NewStart != 10 || got[0].NewEnd != 11 {
		t.Fatalf("first cue window = %.3f --> %.3f, want 10 --> 11", got[0].NewStart, got[0].NewEnd)
	}
	if got[1].NewStart != 11 || got[1].NewEnd != 14 {
		t.Fatalf("second cue window = %.3f --> %.3f, want 11 --> 14", got[1].NewStart, got[1].NewEnd)
	}
	if got[0].SpeedFactor != 1 || got[1].SpeedFactor != 1 {
		t.Fatalf("SpeedFactor = %.3f %.3f, want chunk speed 1", got[0].SpeedFactor, got[1].SpeedFactor)
	}
	if report.MaxSpeedFactor != 1 {
		t.Fatalf("MaxSpeedFactor = %v, want 1", report.MaxSpeedFactor)
	}
}

func TestFitTimelineUsesRequiredSpeedBeyondQualityLimitWithoutOverflow(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SpeedMax = 1.25
	cfg.SpeedAccept = 1.1
	plan := []PlanItem{
		{Index: 1, ActualDuration: 4, ChunkID: 1},
	}
	chunks := []Chunk{{ID: 1, Items: []int{0}, Start: 0, End: 2}}
	got, _, report, err := FitTimeline(plan, chunks, cfg)
	if err != nil {
		t.Fatalf("FitTimeline() error = %v", err)
	}
	if report.MaxSpeedFactor != 2 {
		t.Fatalf("MaxSpeedFactor = %v, want raw required speed 2", report.MaxSpeedFactor)
	}
	if got[0].SpeedFactor != 2 {
		t.Fatalf("SpeedFactor = %v, want required speed 2", got[0].SpeedFactor)
	}
	if got[0].NewEnd != chunks[0].End {
		t.Fatalf("NewEnd = %v, want chunk end %v", got[0].NewEnd, chunks[0].End)
	}
	if !warningsContain(report.Warnings, "exceeds max") || warningsContain(report.Warnings, "overflows") {
		t.Fatalf("warnings = %+v, want max warning without overflow", report.Warnings)
	}
}

func TestFitTimelineKeepsOverlongChunkBeforeNextChunkBoundary(t *testing.T) {
	cfg := DefaultConfig()
	plan := []PlanItem{
		{Index: 33, EstimatedDuration: 4.8, ChunkID: 13},
		{Index: 34, EstimatedDuration: 3.6, ChunkID: 13},
		{Index: 35, EstimatedDuration: 4.9, ChunkID: 13},
		{Index: 36, EstimatedDuration: 5.1, ChunkID: 14},
	}
	chunks := []Chunk{
		{ID: 13, Items: []int{0, 1, 2}, Start: 82.8, End: 90, ActualDuration: 11.04},
		{ID: 14, Items: []int{3}, Start: 90, End: 93.28, ActualDuration: 3.28},
	}

	got, gotChunks, report, err := FitTimeline(plan, chunks, cfg)
	if err != nil {
		t.Fatalf("FitTimeline() error = %v", err)
	}
	if got[2].NewEnd > got[3].NewStart {
		t.Fatalf("chunk boundary overlaps: previous end %.3f next start %.3f", got[2].NewEnd, got[3].NewStart)
	}
	if gotChunks[0].SpeedFactor <= cfg.SpeedMax {
		t.Fatalf("chunk 13 speed = %.3f, want fallback above max %.3f", gotChunks[0].SpeedFactor, cfg.SpeedMax)
	}
	if warningsContain(report.Warnings, "overflows") {
		t.Fatalf("warnings = %+v, want no overflow warning", report.Warnings)
	}
}

func TestFitTimelineRejectsNonPositiveActualDuration(t *testing.T) {
	cfg := DefaultConfig()
	plan := []PlanItem{
		{Index: 7, ActualDuration: 1, ChunkID: 3},
		{Index: 8, ActualDuration: 0, ChunkID: 3},
	}
	chunks := []Chunk{{ID: 3, Items: []int{0, 1}, Start: 0, End: 1}}
	_, _, _, err := FitTimeline(plan, chunks, cfg)
	if err == nil {
		t.Fatal("FitTimeline() error = nil, want non-positive actual duration error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "chunk 3") || !strings.Contains(msg, "item 1") || !strings.Contains(msg, "plan index 1") {
		t.Fatalf("error = %q, want chunk id and item/plan index", msg)
	}
}

func TestFitTimelineNormalizesZeroSpeedConfig(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SpeedMin = 0
	cfg.SpeedAccept = 0
	cfg.SpeedMax = 0
	plan := []PlanItem{
		{Index: 1, ActualDuration: 1.2, ChunkID: 1},
	}
	chunks := []Chunk{{ID: 1, Items: []int{0}, Start: 0, End: 1}}
	got, _, report, err := FitTimeline(plan, chunks, cfg)
	if err != nil {
		t.Fatalf("FitTimeline() error = %v", err)
	}
	defaults := DefaultConfig()
	if got[0].SpeedFactor != 1.2 {
		t.Fatalf("SpeedFactor = %v, want required speed 1.2", got[0].SpeedFactor)
	}
	if warningsContain(report.Warnings, "acceptable 0") || warningsContain(report.Warnings, "max 0") {
		t.Fatalf("warnings = %+v, want normalized default speed limits %+v", report.Warnings, defaults)
	}
}

func TestFitTimelineRejectsInvalidSpeedOrder(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SpeedMin = 1.4
	cfg.SpeedMax = 1.3
	plan := []PlanItem{
		{Index: 1, ActualDuration: 1, ChunkID: 1},
	}
	chunks := []Chunk{{ID: 1, Items: []int{0}, Start: 0, End: 1}}
	_, _, _, err := FitTimeline(plan, chunks, cfg)
	if err == nil {
		t.Fatal("FitTimeline() error = nil, want invalid speed config error")
	}
	if !strings.Contains(err.Error(), "speed config") {
		t.Fatalf("error = %q, want speed config error", err.Error())
	}
}

func TestFitSegmentsKeepsOriginalSubtitleWindowAndNaturalSpeed(t *testing.T) {
	plan := []PlanItem{{
		Index:          7,
		OriginalStart:  12.5,
		OriginalEnd:    15,
		SpokenText:     "短句",
		ActualDuration: 1.2,
	}}

	fitted, report, err := FitSegments(plan)
	if err != nil {
		t.Fatalf("FitSegments() error = %v", err)
	}
	if fitted[0].NewStart != 12.5 || fitted[0].NewEnd != 13.7 {
		t.Fatalf("audio window = %.3f --> %.3f", fitted[0].NewStart, fitted[0].NewEnd)
	}
	if fitted[0].SourceSpeechDuration != 2.5 || fitted[0].TargetSpeechDuration != 1.2 || fitted[0].DurationRatio != 0.48 {
		t.Fatalf("duration diagnostics = source %.3f target %.3f ratio %.3f", fitted[0].SourceSpeechDuration, fitted[0].TargetSpeechDuration, fitted[0].DurationRatio)
	}
	if fitted[0].SpeedFactor != 1 || report.MaxSpeedFactor != 1 {
		t.Fatalf("speed = %.3f report=%.3f, want natural speed", fitted[0].SpeedFactor, report.MaxSpeedFactor)
	}
	cue := BuildDubCues(fitted)[0]
	if cue.Start != 12.5 || cue.End != 15 || cue.Text != "短句" {
		t.Fatalf("subtitle cue = %+v, want original window and final text", cue)
	}
}

func TestFitSegmentsRequiresRewriteThenAcceptsConfiguredOverrun(t *testing.T) {
	plan := []PlanItem{{
		Index:           4,
		OriginalStart:   8.24,
		OriginalEnd:     13.72,
		SpokenText:      "目标字幕",
		ActualDuration:  5.48 * 1.0365,
		RewriteAttempts: 1,
	}}

	fitted, report, err := FitSegmentsWithConfig(plan, DefaultConfig())
	if err != nil {
		t.Fatalf("FitSegmentsWithConfig() error = %v", err)
	}
	if fitted[0].SpeedFactor <= 1 || fitted[0].SpeedFactor > 1.10 {
		t.Fatalf("speed = %.4f, want a small accepted speed adjustment", fitted[0].SpeedFactor)
	}
	if fitted[0].NewEnd > fitted[0].OriginalEnd+timelineComparisonEpsilon {
		t.Fatalf("new end %.4f exceeds slot end %.4f", fitted[0].NewEnd, fitted[0].OriginalEnd)
	}
	if report.MaxSpeedFactor != fitted[0].SpeedFactor {
		t.Fatalf("max speed = %.4f, want %.4f", report.MaxSpeedFactor, fitted[0].SpeedFactor)
	}
}

func TestFitSegmentsUsesForcedAtempoFallbackAboveConfiguredTolerance(t *testing.T) {
	plan := []PlanItem{{Index: 4, OriginalStart: 0, OriginalEnd: 5, ActualDuration: 5.51, RewriteAttempts: 3}}
	fitted, report, err := FitSegmentsWithConfig(plan, DefaultConfig())
	if err != nil {
		t.Fatalf("FitSegmentsWithConfig() error = %v, want forced timing fallback", err)
	}
	if fitted[0].SpeedFactor < 1.1019 || fitted[0].SpeedFactor > 1.1021 {
		t.Fatalf("speed = %.3f, want 1.102", fitted[0].SpeedFactor)
	}
	if fitted[0].NewEnd != 5 {
		t.Fatalf("new end = %.3f, want 5.000", fitted[0].NewEnd)
	}
	if len(report.Warnings) != 1 || !strings.Contains(report.Warnings[0], "atempo_required=true") {
		t.Fatalf("timing warnings = %+v", report.Warnings)
	}
}

func TestFitSegmentsUsesForcedAtempoFallbackForMeasuredOverflow(t *testing.T) {
	plan := []PlanItem{{Index: 9, OriginalStart: 0, OriginalEnd: 1, ActualDuration: 1.5, RewriteAttempts: 2}}
	fitted, report, err := FitSegments(plan)
	if err != nil {
		t.Fatalf("FitSegments() error = %v, want forced timing fallback", err)
	}
	if fitted[0].SpeedFactor != 1.5 || fitted[0].NewEnd != 1 {
		t.Fatalf("fitted segment = %+v, want 1.5x speed ending at 1s", fitted[0])
	}
	if len(report.FailedIndexes) != 0 || len(report.Warnings) != 1 || !strings.Contains(report.Warnings[0], "target_tts_longer_than_source_speech_window") {
		t.Fatalf("timing diagnostics = %+v", report)
	}
}

func warningsContain(warnings []string, substr string) bool {
	for _, warning := range warnings {
		if strings.Contains(warning, substr) {
			return true
		}
	}
	return false
}
