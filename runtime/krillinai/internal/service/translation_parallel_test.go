package service

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/zap"
)

type blockingTranslationCompleter struct {
	entered chan struct{}
	release chan struct{}
	active  atomic.Int32
	peak    atomic.Int32
	calls   atomic.Int32
}

func (c *blockingTranslationCompleter) ChatCompletion(prompt string) (string, error) {
	return c.ChatCompletionContext(context.Background(), prompt)
}

func (c *blockingTranslationCompleter) ChatCompletionContext(ctx context.Context, prompt string) (string, error) {
	c.calls.Add(1)
	active := c.active.Add(1)
	defer c.active.Add(-1)
	for peak := c.peak.Load(); active > peak; peak = c.peak.Load() {
		if c.peak.CompareAndSwap(peak, active) {
			break
		}
	}
	c.entered <- struct{}{}
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-c.release:
	}
	return (subtitleRoutingCompleter{}).ChatCompletion(prompt)
}

func TestSubtitleTranslationConcurrencyAndCancellation(t *testing.T) {
	previousApp, previousLogger := config.Conf.App, log.Logger
	config.Conf.App.TranslateParallelNum = 3
	config.Conf.App.MaxSentenceLength = 100
	config.Conf.App.VttBatchSize = 10
	log.Logger = zap.NewNop()
	t.Cleanup(func() { config.Conf.App, log.Logger = previousApp, previousLogger })

	for _, path := range []string{"platform", "imported", "transcribed"} {
		for _, cancelTask := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/cancel=%t", path, cancelTask), func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				completer := &blockingTranslationCompleter{
					entered: make(chan struct{}, 40),
					release: make(chan struct{}),
				}
				translator := &Translator{chatCompleter: completer}
				service := Service{
					ChatCompleter:      completer,
					YouTubeSubtitleSrv: &YouTubeSubtitleService{translator: translator},
				}
				parts := make([]string, 37)
				blocks := make([]*util.SrtBlock, len(parts))
				for index := range parts {
					parts[index] = fmt.Sprintf("Sentence number %d is here.", index+1)
					blocks[index] = &util.SrtBlock{
						Index:                  index + 1,
						Timestamp:              fmt.Sprintf("00:00:%02d,000 --> 00:00:%02d,900", index, index),
						OriginLanguageSentence: parts[index],
					}
				}
				var results []*TranslatedItem
				var progress []int
				var platformProgress []uint8
				task := &types.SubtitleTask{}
				task.SetProgressReporter(func(percent uint8) { platformProgress = append(platformProgress, percent) })
				checkpointDir := t.TempDir()
				done := make(chan error, 1)
				go func() {
					var err error
					switch path {
					case "platform":
						blocks, err = translator.BatchTranslateSrtBlocks(ctx, blocks, "en", "zh_cn", task)
					case "imported":
						blocks, err = service.TranslateSubtitleBlocks(ctx, blocks, &types.SubtitleTaskStepParam{OriginLanguage: "en", TargetLanguage: "zh_cn"})
					case "transcribed":
						results, err = service.splitTextAndTranslateV2(ctx, checkpointDir, strings.Join(parts, " "), "en", "zh_cn", false, 0, func(completed, total int) error {
							progress = append(progress, completed)
							return nil
						})
					}
					done <- err
				}()

				for range 3 {
					select {
					case <-completer.entered:
					case <-ctx.Done():
						<-done
						t.Fatal("translation did not start three concurrent requests")
					}
				}
				if cancelTask {
					cancel()
				} else {
					close(completer.release)
				}
				err := <-done
				if cancelTask {
					if !errors.Is(err, context.Canceled) || completer.calls.Load() != 3 {
						t.Fatalf("cancel error = %v, calls = %d; want cancellation with no retries or queued requests", err, completer.calls.Load())
					}
				} else {
					if err != nil {
						t.Fatal(err)
					}
					for index, part := range parts {
						if path == "transcribed" {
							if len(results) != len(parts) || results[index].OriginText != part || results[index].TranslatedText != "测试译文："+part {
								t.Fatalf("translation order mismatch at %d", index)
							}
						} else if blocks[index].TargetLanguageSentence != "测试译文："+part {
							t.Fatalf("subtitle order mismatch at %d: %q", index, blocks[index].TargetLanguageSentence)
						}
					}
					if path == "transcribed" {
						for index, completed := range progress {
							if index > 0 && completed <= progress[index-1] {
								t.Fatalf("non-monotonic progress: %v", progress)
							}
						}
						if len(progress) == 0 || progress[len(progress)-1] != len(parts) {
							t.Fatalf("incomplete progress: %v", progress)
						}
					}
					if path == "platform" {
						for index, percent := range platformProgress {
							if index > 0 && percent < platformProgress[index-1] {
								t.Fatalf("non-monotonic platform progress: %v", platformProgress)
							}
						}
						if task.ProcessPct != 90 {
							t.Fatalf("platform progress = %d, want 90", task.ProcessPct)
						}
					}
				}
				if completer.peak.Load() != 3 || completer.active.Load() != 0 {
					t.Fatalf("peak = %d, active = %d; want peak 3 and no unfinished requests", completer.peak.Load(), completer.active.Load())
				}
			})
		}
	}
}

func TestTranslationParallelismUsesConfiguredLimitAndDefault(t *testing.T) {
	previous := config.Conf.App.TranslateParallelNum
	t.Cleanup(func() { config.Conf.App.TranslateParallelNum = previous })
	for _, test := range []struct{ configured, want int }{{3, 3}, {1, 1}, {0, 3}, {-1, 3}} {
		config.Conf.App.TranslateParallelNum = test.configured
		if got := translationParallelism(); got != test.want {
			t.Fatalf("parallelism for %d = %d, want %d", test.configured, got, test.want)
		}
	}
}
