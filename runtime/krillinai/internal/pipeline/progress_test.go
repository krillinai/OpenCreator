package pipeline

import (
	"context"
	"krillin-ai/internal/types"
	"reflect"
	"testing"
)

func TestVideoStagesForwardActualWorkWithoutRegressing(t *testing.T) {
	for _, stage := range []string{"subtitle", "tts", "render"} {
		t.Run(stage, func(t *testing.T) {
			events := []types.TaskProgress{
				{Phase: "processing_audio", Percent: 25, Message: "audio details", Completed: 0, Total: 8},
				{Phase: "processing_audio", Percent: 50, Message: "partial results", Completed: 3, Total: 8},
				{Phase: "processing_audio", Percent: 45, Message: "late transcription update", Completed: 3, Total: 8},
				{Phase: "processing_audio", Percent: 50, Message: "same percent, more work", Completed: 4, Total: 8},
			}
			fake := &fakeStageService{detailedProgress: events}
			var counts []ProgressCounts
			last := 0
			report := func(phase string, percent int, message string, details ...ProgressCounts) {
				if percent < last || percent >= 100 {
					t.Fatalf("invalid stage progress: %d -> %d", last, percent)
				}
				last = percent
				if len(details) > 0 {
					counts = append(counts, details[0])
				}
			}
			var err error
			switch stage {
			case "subtitle":
				_, err = GenerateSubtitles(context.Background(), fake, SubtitleRequest{Workdir: t.TempDir(), CaptionSource: CaptionSourceWhisper, ReportProgress: report})
				// The fake also uses these events for media preparation.
				counts = counts[len(events):]
			case "tts":
				_, err = GenerateTTS(context.Background(), fake, TTSRequest{Workdir: t.TempDir(), AudioOnly: true, ReportProgress: report})
			case "render":
				_, err = Render(context.Background(), fake, RenderRequest{Workdir: t.TempDir(), Horizontal: true, ReportProgress: report})
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(counts, []ProgressCounts{{0, 8}, {3, 8}, {3, 8}, {4, 8}}) {
				t.Fatalf("detailed progress lost: %+v", counts)
			}
		})
	}
}

func TestPlatformVideoTranslationReportsSentenceCounts(t *testing.T) {
	fake := &fakeStageService{translationProgress: []ProgressCounts{{0, 13}, {1, 13}, {13, 13}}}
	var counts []ProgressCounts
	_, err := GenerateSubtitles(context.Background(), fake, SubtitleRequest{
		Input: "https://www.youtube.com/watch?v=progress", Workdir: t.TempDir(), OriginLang: "en", TargetLang: "zh_cn",
		ReportProgress: func(phase string, percent int, _ string, details ...ProgressCounts) {
			if len(details) > 0 {
				if phase != "translating_subtitles" || percent > 85 {
					t.Fatalf("wrong phase/range: %s %d", phase, percent)
				}
				counts = append(counts, details[0])
			}
		},
	})
	if err != nil || !reflect.DeepEqual(counts, fake.translationProgress) {
		t.Fatalf("counts=%v, error=%v", counts, err)
	}
}
