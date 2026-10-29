package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"krillin-ai/config"

	openaiapi "github.com/sashabaranov/go-openai"
)

func saveLengthTestCheckpoint(t *testing.T, translator *Translator, texts []string, sentences ...pairedSentence) {
	t.Helper()
	checkpoint, err := translator.openTranslationCheckpoint(texts, "en", "zh_cn")
	if err != nil {
		t.Fatal(err)
	}
	for _, sentence := range sentences {
		if err := checkpoint.save(sentence); err != nil {
			t.Fatal(err)
		}
	}
}

func lengthTestCachedSentence(pairs []pairedTranslationSegment) pairedSentence {
	sentence := pairedSentence{ID: "1"}
	for _, pair := range pairs {
		sentence.Source = append(sentence.Source, pair.Source)
		sentence.Target = append(sentence.Target, pair.Target)
		sentence.FullSource += pair.Source
		sentence.FullTarget += pair.Target
	}
	return sentence
}

func TestCheckpointLengthAccepts61Through65WithoutRequests(t *testing.T) {
	for length := 61; length <= 65; length++ {
		t.Run(fmt.Sprint(length), func(t *testing.T) {
			source, target := strings.Repeat("a", length), strings.Repeat("中", length)
			translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(string) (string, error) {
				t.Fatal("合格检查点不应请求翻译或拆分")
				return "", nil
			})}
			cached := pairedSentence{ID: "1", FullTarget: target, Source: []string{source}, Target: []string{target}}
			saveLengthTestCheckpoint(t, translator, []string{source}, cached)
			result, err := translator.translatePairedSentences(context.Background(), []string{source}, "en", "zh_cn", 60, 1, nil)
			if err != nil || len(result) != 1 || !reflect.DeepEqual(result[0].Source, cached.Source) || !reflect.DeepEqual(result[0].Target, cached.Target) {
				t.Fatalf("合格检查点被改动: result=%+v err=%v", result, err)
			}
		})
	}
}

func TestCheckpointLengthRepairsOnlyOverlongPairsAndKeepsFreshBatch(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	for _, side := range []string{"source", "target"} {
		t.Run(side, func(t *testing.T) {
			pairs, split := lengthRepairTestPairs(), lengthRepairTestSplit()
			if side == "target" {
				pairs[1] = pairedTranslationSegment{Source: "and all the ingredients ", Target: strings.Repeat("中", 66)}
				split = []pairedTranslationSegment{{Source: "and all ", Target: strings.Repeat("中", 33)}, {Source: "the ingredients ", Target: strings.Repeat("中", 33)}}
			}
			cached := lengthTestCachedSentence(pairs)
			texts := []string{strings.TrimSpace(cached.FullSource) + ".", "Fresh.", "Cached."}
			cached.FullSource = texts[0]
			cached.Source[2] = strings.TrimSpace(cached.Source[2]) + "."
			other := pairedSentence{ID: "3", FullTarget: "缓存。", Source: []string{texts[2]}, Target: []string{"缓存。"}}
			calls := 0
			translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				input, err := decodePairedTestInput(prompt)
				if err != nil || len(input.Sentences) != 1 {
					t.Fatalf("请求包含不需要处理的句子: %+v err=%v", input, err)
				}
				source := input.Sentences[0]
				switch source.ID {
				case "1.2":
					if source.Text != pairs[1].Source || source.TargetText != pairs[1].Target {
						t.Fatalf("没有冻结待拆字幕: %+v", source)
					}
					return lengthRepairTestResponse(source.ID, split), nil
				case "2":
					if source.TargetText != "" {
						t.Fatal("首次翻译被错误冻结")
					}
					return lengthRepairTestResponse("2", []pairedTranslationSegment{{Source: texts[1], Target: "新译文。"}}), nil
				default:
					t.Fatalf("重译或改动了合格检查点: %+v", source)
					return "", nil
				}
			})}
			saveLengthTestCheckpoint(t, translator, texts, cached, other)
			var committed []pairedSentence
			result, err := translator.translatePairedSentences(context.Background(), texts, "en", "zh_cn", 60, 3, func(batch []pairedSentence, _, _ int) error {
				committed = append(committed, batch...)
				return nil
			})
			if err != nil || calls != 2 || len(result) != 3 || len(committed) != 3 || committed[0].ID != "1" || committed[1].ID != "2" || committed[2].ID != "3" {
				t.Fatalf("恢复与首译混合批次失败: calls=%d result=%+v committed=%+v err=%v", calls, result, committed, err)
			}
			final := result[0]
			if len(final.Source) != 4 || final.Source[0] != cached.Source[0] || final.Source[3] != cached.Source[2] || final.Target[0] != cached.Target[0] || final.Target[3] != cached.Target[2] || final.FullTarget != cached.FullTarget || !pairedSentenceWithinLimit(final, 60) {
				t.Fatalf("局部修复破坏了原字幕: %+v", final)
			}
			if _, err := translator.translatePairedSentences(context.Background(), texts, "en", "zh_cn", 60, 1, nil); err != nil || calls != 2 {
				t.Fatalf("修好的检查点没有复用: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestCheckpointLengthOldFallbackExportsSRTDespiteRepairFailure(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.TranslateMaxAttempts = 3
	for _, mode := range []string{"success", "invalid_json", "network", "budget"} {
		t.Run(mode, func(t *testing.T) {
			cached := lengthTestCachedSentence(lengthRepairTestPairs())
			text := strings.TrimSpace(cached.FullSource)
			cached.Source, cached.Target = nil, nil // 旧检查点仅有整句译文。
			calls := 0
			dir := t.TempDir()
			translator := &Translator{checkpointDir: dir, recoveryDelay: time.Millisecond, chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				input, err := decodePairedTestInput(prompt)
				if err != nil || len(input.Sentences) != 1 || input.Sentences[0].ID != "1.1" || input.Sentences[0].TargetText != cached.FullTarget {
					t.Fatalf("旧检查点未走冻结拆分: %+v err=%v", input, err)
				}
				switch mode {
				case "invalid_json":
					return "bad json", nil
				case "network":
					return "", errors.New("offline fixture disconnect")
				case "budget":
					if calls > 1 {
						return "", &openaiapi.APIError{HTTPStatusCode: 503, Message: "offline fixture temporary failure"}
					}
					return "bad json", nil
				}
				pairs := lengthRepairTestPairs()
				fixed := append([]pairedTranslationSegment{pairs[0]}, lengthRepairTestSplit()...)
				fixed = append(fixed, pairs[2])
				return lengthRepairTestResponse("1.1", fixed), nil
			})}
			saveLengthTestCheckpoint(t, translator, []string{text}, cached)
			vtt := filepath.Join(dir, "source.vtt")
			if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:00:01.000 --> 00:00:09.000\n"+text+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			path, err := (&YouTubeSubtitleService{translator: translator}).ProcessBlockLevelVtt(context.Background(), &YoutubeSubtitleReq{VttFile: vtt, TaskBasePath: dir, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true})
			if err != nil {
				t.Fatalf("拆分失败不应阻止交付字幕: %v", err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			cues := strings.Split(strings.TrimSpace(string(data)), "\n\n")
			wantCalls, wantCues := 1, 1
			if mode == "success" {
				wantCues = 4
			} else if mode == "invalid_json" {
				wantCalls = 3
			} else if mode == "budget" {
				wantCalls = translationSentenceRequestLimit
			}
			if calls != wantCalls || len(cues) != wantCues {
				t.Fatalf("请求预算或交付条数错误: calls=%d cues=%d", calls, len(cues))
			}
			for _, cue := range cues {
				lines := strings.Split(cue, "\n")
				if len(lines) != 4 || mode == "success" && max(subtitleTargetLength(lines[2]), subtitleTargetLength(lines[3])) > 65 {
					t.Fatalf("最终双语字幕格式错误: %s", cue)
				}
			}
			checkpoint, err := translator.openTranslationCheckpoint([]string{text}, "en", "zh_cn")
			if err != nil || checkpoint.sentences["1"].FullTarget != cached.FullTarget || !pairedSentenceSegmentsValid(checkpoint.sentences["1"], text) {
				t.Fatalf("恢复后未保存完整原译文: %+v err=%v", checkpoint, err)
			}
		})
	}
}

func TestCheckpointLengthCancellationPreservesSavedTranslation(t *testing.T) {
	cached := lengthTestCachedSentence(lengthRepairTestPairs())
	text := strings.TrimSpace(cached.FullSource)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(string) (string, error) {
		cancel()
		return "", ctx.Err()
	})}
	saveLengthTestCheckpoint(t, translator, []string{text}, cached)
	_, err := translator.translatePairedSentences(ctx, []string{text}, "en", "zh_cn", 60, 1, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("取消没有传递: %v", err)
	}
	checkpoint, err := translator.openTranslationCheckpoint([]string{text}, "en", "zh_cn")
	if err != nil || !reflect.DeepEqual(checkpoint.sentences["1"], cached) {
		t.Fatalf("取消破坏了已保存译文: %+v err=%v", checkpoint, err)
	}
}

func TestCheckpointLengthRepairsUseConfiguredConcurrency(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 3
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	entered, release := make(chan struct{}, 3), make(chan struct{})
	var calls atomic.Int32
	translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		input, err := decodePairedTestInput(prompt)
		if err != nil || len(input.Sentences) != 1 {
			return "", fmt.Errorf("invalid local request")
		}
		source := input.Sentences[0]
		cut := 31 + strings.Index(source.Text[30:], " ")
		return lengthRepairTestResponse(source.ID, []pairedTranslationSegment{
			{Source: source.Text[:cut], Target: "完整"}, {Source: source.Text[cut:], Target: "译文。"},
		}), nil
	})}
	var texts []string
	var cached []pairedSentence
	for i := 1; i <= 3; i++ {
		text := fmt.Sprintf("Group %d ", i) + strings.Repeat("word ", 14) + "end."
		texts = append(texts, text)
		cached = append(cached, pairedSentence{ID: fmt.Sprint(i), FullTarget: "完整译文。"})
	}
	saveLengthTestCheckpoint(t, translator, texts, cached...)
	done := make(chan error, 1)
	go func() {
		result, err := translator.translatePairedSentences(ctx, texts, "en", "zh_cn", 60, 1, nil)
		if err == nil {
			for _, sentence := range result {
				if len(sentence.Source) != 2 || !pairedSentenceWithinLimit(sentence, 60) {
					err = fmt.Errorf("cached repair failed: %+v", sentence)
				}
			}
		}
		done <- err
	}()
	for range 3 {
		select {
		case <-entered:
		case <-ctx.Done():
			<-done
			t.Fatal("缓存拆分没有使用配置的三路并发")
		}
	}
	close(release)
	if err := <-done; err != nil || calls.Load() != 3 {
		t.Fatalf("缓存并发恢复失败: calls=%d err=%v", calls.Load(), err)
	}
}
