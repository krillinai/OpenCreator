package service

import (
	"context"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"strings"
	"testing"
	"time"

	"golang.org/x/sync/errgroup"
)

func TestAudioTranslationProgressDoesNotWaitForSlowEarlierRequest(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 3
	config.Conf.App.MaxSentenceLength = 100
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	release := make(chan struct{})
	svc := Service{ChatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if input.Sentences[0].ID == "1" {
			select {
			case <-release:
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		return echoPairedTestResponse(input)
	})}
	var sentences []string
	for i := 0; i < 13; i++ {
		sentences = append(sentences, fmt.Sprintf("Sentence number %d is here.", i+1))
	}
	var counts []int
	result, err := svc.splitTextAndTranslateV2(ctx, t.TempDir(), strings.Join(sentences, " "), "en", "zh_cn", false, 0, nil, func(completed, total int) {
		counts = append(counts, completed)
		if completed == 1 {
			close(release)
		}
	})
	if err != nil || len(result) != 13 || fmt.Sprint(counts) != "[0 1 13]" {
		t.Fatalf("result=%d, counts=%v, error=%v", len(result), counts, err)
	}
}

func TestAudioProgressReportsOverlappingRecognitionAndTranslation(t *testing.T) {
	log.InitLogger()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	group, groupCtx := errgroup.WithContext(ctx)
	split := make(chan DataWithId[string], 2)
	transcribe := make(chan DataWithId[string], 2)
	transcriptProgress := make(chan DataWithId[float64], 2)
	transcribed := make(chan DataWithId[*types.TranscriptionData], 2)
	translate := make(chan DataWithId[string], 2)
	translationProgress := make(chan DataWithId[TranslationProgress], 2)
	translated := make(chan DataWithId[[]*TranslatedItem], 2)
	pendingSplit := make(chan DataWithId[[2]float64], 2)
	split <- DataWithId[string]{Id: 0, Data: "audio.wav"}
	transcribed <- DataWithId[*types.TranscriptionData]{Id: 0, Data: &types.TranscriptionData{Text: "Hello world."}}
	translationProgress <- DataWithId[TranslationProgress]{Id: 0, Data: TranslationProgress{Fraction: 0.5, Completed: 1, Total: 2}}
	var last types.TaskProgress
	task := &types.SubtitleTask{}
	task.SetDetailedProgressReporter(func(p types.TaskProgress) {
		if strings.Contains(p.Message, "音频分段 1/2；语音识别 1/2 段") && strings.Contains(p.Message, "第 1 段已翻译 1/2 句") {
			last = p
			cancel()
		}
	})
	(Service{}).startResultHandler(groupCtx, group, &types.SubtitleTaskStepParam{TaskPtr: task}, 2, []float64{0, 1, 2}, make([]AudioSegment, 2), split, transcribe, transcriptProgress, transcribed, translate, translationProgress, translated, pendingSplit)
	if err := group.Wait(); err != nil || last.Phase != "processing_audio" || last.Completed != 0 || last.Total != 2 {
		t.Fatalf("missing real simultaneous progress: %+v, error=%v", last, err)
	}
}
