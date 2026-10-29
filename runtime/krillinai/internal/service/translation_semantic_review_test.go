package service

import (
	"context"
	"encoding/json"
	"errors"
	"krillin-ai/config"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	openaiapi "github.com/sashabaranov/go-openai"
)

type semanticReviewTestCompleter func(context.Context, string) (string, error)

func (f semanticReviewTestCompleter) ChatCompletion(prompt string) (string, error) {
	return f(context.Background(), prompt)
}

func (f semanticReviewTestCompleter) ChatCompletionContext(ctx context.Context, prompt string) (string, error) {
	return f(ctx, prompt)
}

func semanticReviewTestSentence() pairedSentence {
	return pairedSentence{ID: "1", FullSource: "She did not agree.", FullTarget: "她同意了。", Source: []string{"She did not agree."}, Target: []string{"她同意了。"}}
}

func semanticReviewTestCorrection() semanticCorrection {
	return semanticCorrection{pairedTranslationOutputSentence: pairedTranslationOutputSentence{
		ID: "1", FullTarget: "她没有同意。", Segments: []pairedTranslationSegment{{Source: "She did not agree.", Target: "她没有同意。"}},
	}, OriginalTarget: "她同意了。", Kind: "meaning", SourceQuote: "did not", Reason: "原文是否定，原译错误地表示同意。"}
}

func semanticReviewTestResponse(corrections ...semanticCorrection) string {
	data, _ := json.Marshal(struct {
		Corrections []semanticCorrection `json:"corrections"`
	}{corrections})
	return string(data)
}

func TestSemanticReviewCorrectionReachesNativeSRTAndAudioCheckpoint(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	for _, route := range []string{"platform", "audio"} {
		t.Run(route, func(t *testing.T) {
			dir := t.TempDir()
			translationCalls, reviewCalls := 0, 0
			completer := semanticReviewTestCompleter(func(ctx context.Context, prompt string) (string, error) {
				if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
					reviewCalls++
					if !strings.Contains(prompt, `"target_text":"她同意了。"`) {
						t.Fatal("语义审核未收到分段派生的完整译文")
					}
					return semanticReviewTestResponse(semanticReviewTestCorrection()), nil
				}
				translationCalls++
				return `{"sentences":[{"sentence_id":"1","segments":[{"source":"She did not agree.","target":"她同意了。"}]}]}`, nil
			})
			if route == "platform" {
				vtt := filepath.Join(dir, "source.vtt")
				if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nShe did not agree.\n"), 0600); err != nil {
					t.Fatal(err)
				}
				path, err := (&YouTubeSubtitleService{translator: &Translator{chatCompleter: completer}}).processYouTubeSubtitle(context.Background(), &YoutubeSubtitleReq{
					VttFile: vtt, TaskBasePath: dir, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true,
				})
				if err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(path)
				if err != nil || !strings.Contains(string(data), "她没有同意。\nShe did not agree.") {
					t.Fatalf("修正未进入原生双语字幕: %s err=%v", data, err)
				}
			} else {
				items, err := (Service{ChatCompleter: completer}).splitTextAndTranslateV2(context.Background(), dir, "She did not agree.", "en", "zh_cn", false, 0, nil)
				if err != nil || len(items) != 1 || items[0].TranslatedText != "她没有同意。" {
					t.Fatalf("音频路径仍输出审核前结果: %+v err=%v", items, err)
				}
				files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
				if len(files) != 1 {
					t.Fatal(files)
				}
				data, err := os.ReadFile(files[0])
				if err != nil || !strings.Contains(string(data), "她没有同意。") || strings.Contains(string(data), "她同意了。") {
					t.Fatalf("音频聚合检查点未更新: %s err=%v", data, err)
				}
			}
			files, _ := filepath.Glob(filepath.Join(dir, "translation-checkpoints", "*", "1.json"))
			if len(files) != 1 {
				t.Fatal(files)
			}
			data, _ := os.ReadFile(files[0])
			if !strings.Contains(string(data), "她没有同意。") || translationCalls != 1 || reviewCalls != 1 {
				t.Fatalf("单句修正未保存或增加了恢复调用: %s calls=%d/%d", data, translationCalls, reviewCalls)
			}
		})
	}
}

func TestSemanticReviewRejectsUnsafeCorrections(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*semanticCorrection)
	}{
		{"unknown_id", func(c *semanticCorrection) { c.ID = "2" }},
		{"stale_target", func(c *semanticCorrection) { c.OriginalTarget = "不同原译。" }},
		{"unsupported_evidence", func(c *semanticCorrection) { c.SourceQuote = "no such source" }},
		{"style", func(c *semanticCorrection) { c.Kind = "style" }},
		{"missing_reason", func(c *semanticCorrection) { c.Reason = "" }},
		{"wrong_language", func(c *semanticCorrection) { c.FullTarget = "She did not agree."; c.Segments[0].Target = c.FullTarget }},
		{"empty_target", func(c *semanticCorrection) { c.FullTarget = "" }},
		{"linebreak", func(c *semanticCorrection) {
			c.FullTarget = "她没有\n同意。"
			c.Segments[0].Target = c.FullTarget
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			correction := semanticReviewTestCorrection()
			tc.mutate(&correction)
			translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(context.Context, string) (string, error) { return semanticReviewTestResponse(correction), nil })}
			result, err := translator.reviewPairedSemanticErrors(context.Background(), []pairedSentence{semanticReviewTestSentence()}, "en", "zh_cn", 60, func(pairedSentence) error { t.Fatal("无效修正不应写入"); return nil })
			if err != nil || len(result) != 1 || result[0].FullTarget != "她同意了。" {
				t.Fatalf("无效审核改变了原译: %+v err=%v", result, err)
			}
		})
	}
}

func TestSemanticReviewFailureKeepsCompletedTranslation(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		err            error
	}{
		{"bad_json", "not-json", nil},
		{"missing_field", "{}", nil},
		{"duplicate_id", semanticReviewTestResponse(semanticReviewTestCorrection(), semanticReviewTestCorrection()), nil},
		{"rate_limit", "", &openaiapi.APIError{HTTPStatusCode: 429}},
		{"truncated", "", errors.New("llm_translation_truncated")},
		{"deadline", "", context.DeadlineExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(ctx context.Context, _ string) (string, error) {
				calls++
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) > 30*time.Second {
					t.Fatal("审核未设置时间预算")
				}
				return tc.response, tc.err
			})}
			result, err := translator.reviewPairedSemanticErrors(context.Background(), []pairedSentence{semanticReviewTestSentence()}, "en", "zh_cn", 60, nil)
			if err != nil || calls != 1 || len(result) != 1 || result[0].FullTarget != "她同意了。" {
				t.Fatalf("审核失败阻止交付或发生重试: %+v calls=%d err=%v", result, calls, err)
			}
		})
	}
}

func TestSemanticReviewHonorsCancellationAndPersistenceFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(ctx context.Context, _ string) (string, error) {
		cancel()
		return "", ctx.Err()
	})}
	if _, err := translator.reviewPairedSemanticErrors(ctx, []pairedSentence{semanticReviewTestSentence()}, "en", "zh_cn", 60, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("审核吞掉用户取消: %v", err)
	}
	translator.chatCompleter = semanticReviewTestCompleter(func(context.Context, string) (string, error) {
		return semanticReviewTestResponse(semanticReviewTestCorrection()), nil
	})
	result, err := translator.reviewPairedSemanticErrors(context.Background(), []pairedSentence{semanticReviewTestSentence()}, "en", "zh_cn", 60, func(pairedSentence) error { return errors.New("disk error") })
	if err != nil || result[0].FullTarget != "她同意了。" {
		t.Fatalf("未持久化的审核修正替换了原译: %+v err=%v", result, err)
	}
}

func TestSemanticReviewBatchesPreserveBudgetAndCoverage(t *testing.T) {
	var sentences []pairedSentence
	for i := 0; i < 180; i++ {
		sentence := semanticReviewTestSentence()
		sentence.ID = strings.Repeat("x", i+1)
		sentence.FullSource = strings.Repeat("Source text. ", 20)
		sentence.FullTarget = strings.Repeat("译文。", 20)
		sentences = append(sentences, sentence)
	}
	var ids []string
	batches := semanticReviewBatches(sentences, "en", "zh_cn", 60)
	if len(batches) < 2 {
		t.Fatal("未按预算切窗口")
	}
	for _, batch := range batches {
		data, _ := json.Marshal(batch)
		if len(data)+len(translationSemanticReviewPrompt) > semanticReviewRequestBytes {
			t.Fatal("审核超出请求预算")
		}
		for _, row := range batch.Sentences {
			ids = append(ids, row.ID)
		}
	}
	if len(ids) != len(sentences) {
		t.Fatal("审核漏句或重复句")
	}
	for i, id := range ids {
		if id != sentences[i].ID {
			t.Fatal("审核窗口乱序")
		}
	}
}

func TestSemanticReviewLongCorrectionsRestorePairedLayout(t *testing.T) {
	const source = "The changes will not happen today, but they may happen tomorrow."
	const previous = "这些变化会在今天发生，也会在明天发生。"
	const corrected = "这些变化不会在今天发生，但可能在明天发生。"
	var sentences []pairedSentence
	var corrections []semanticCorrection
	for i := 1; i <= 5; i++ {
		id := strconv.Itoa(i)
		sentences = append(sentences, pairedSentence{ID: id, FullSource: source, FullTarget: previous, Source: []string{source}, Target: []string{previous}})
		corrections = append(corrections, semanticCorrection{pairedTranslationOutputSentence: pairedTranslationOutputSentence{ID: id, FullTarget: corrected}, OriginalTarget: previous, SourceQuote: "will not", Kind: "meaning", Reason: "原译丢失否定和可能性。"})
	}
	previousConfig := config.Conf
	t.Cleanup(func() { config.Conf = previousConfig })
	config.Conf.App.TranslateParallelNum = 1
	calls := 0
	translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(ctx context.Context, prompt string) (string, error) {
		calls++
		if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
			return semanticReviewTestResponse(corrections...), nil
		}
		input, err := decodePairedTestInput(prompt)
		if err != nil || len(input.Sentences) != 1 || input.Sentences[0].TargetText != corrected {
			t.Fatalf("layout input did not freeze correction: %+v err=%v", input, err)
		}
		data, err := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: input.Sentences[0].ID,
			Segments: []pairedTranslationSegment{
				{Source: "The changes will not happen today, ", Target: "这些变化不会在今天发生，"},
				{Source: "but they may happen tomorrow.", Target: "但可能在明天发生。"},
			},
		}}})
		return string(data), err
	})}
	saved := 0
	result, err := translator.reviewPairedSemanticErrors(context.Background(), sentences, "en", "zh_cn", 60, func(sentence pairedSentence) error {
		saved++
		if sentence.FullTarget != corrected || sentence.LayoutFallback {
			t.Fatalf("持久化未收到长句修正: %+v", sentence)
		}
		return nil
	})
	if err != nil || calls != 6 || saved != 5 || len(result) != 5 {
		t.Fatalf("长句修正未恢复配对: calls=%d result=%+v err=%v", calls, result, err)
	}
	for i, sentence := range result {
		if sentence.FullSource != source || sentence.FullTarget != corrected || sentence.LayoutFallback || len(sentence.Source) != 2 || len(sentence.Target) != 2 || !subtitleSegmentsPreserveText(source, sentence.Source) || !subtitleSegmentsPreserveText(corrected, sentence.Target) {
			t.Fatalf("长句修正未保留完整原译配对: i=%d sentence=%+v", i, sentence)
		}
		if sentences[i].FullTarget != previous || sentences[i].Target[0] != previous {
			t.Fatal("审核修改了调用方持有的旧译文")
		}
	}
}

func TestSemanticReviewLongCorrectionPersistenceFailureKeepsCompletedTranslation(t *testing.T) {
	for _, tc := range semanticReviewDeliveryCases() {
		t.Run(tc.name, func(t *testing.T) {
			original := pairedSentence{ID: "1", FullSource: tc.source, FullTarget: tc.previous}
			for _, segment := range tc.segments {
				original.Source = append(original.Source, segment.Source)
				original.Target = append(original.Target, segment.Target)
			}
			translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(_ context.Context, prompt string) (string, error) {
				if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
					return semanticReviewTestResponse(semanticCorrection{
						pairedTranslationOutputSentence: pairedTranslationOutputSentence{ID: "1", FullTarget: tc.corrected},
						OriginalTarget:                  tc.previous, Kind: "meaning", SourceQuote: tc.quote, Reason: "Correct the negation or number.",
					}), nil
				}
				data, err := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: "1", Segments: tc.correctedSegments}}})
				return string(data), err
			})}
			saves := 0
			result, err := translator.reviewPairedSemanticErrors(context.Background(), []pairedSentence{original}, tc.originLang, tc.targetLang, 60, func(sentence pairedSentence) error {
				saves++
				return errors.New("disk error")
			})
			if err != nil || saves != 1 || len(result) != 1 {
				t.Fatalf("未测试长句修正保存失败: saves=%d result=%+v err=%v", saves, result, err)
			}
			got, _ := json.Marshal(result[0])
			want, _ := json.Marshal(original)
			if string(got) != string(want) {
				t.Fatalf("保存失败破坏原译或原有配对: got=%s want=%s", got, want)
			}
		})
	}
}

func TestSemanticReviewExactlySixtyCharactersKeepsNormalLayout(t *testing.T) {
	const source = "The changes won't happen today but they may happen tomorrow."
	const previous = "这些变化会在今天发生，也会在明天发生。"
	const corrected = "这些变化不会在今天发生，但可能在明天发生。"
	if subtitleTargetLength(source) != 60 {
		t.Fatal("边界用例必须恰好60字素")
	}
	translator := &Translator{chatCompleter: semanticReviewTestCompleter(func(context.Context, string) (string, error) {
		return semanticReviewTestResponse(semanticCorrection{
			pairedTranslationOutputSentence: pairedTranslationOutputSentence{ID: "1", FullTarget: corrected},
			OriginalTarget:                  previous, Kind: "meaning", SourceQuote: "won't", Reason: "The source negates the event.",
		}), nil
	})}
	result, err := translator.reviewPairedSemanticErrors(context.Background(), []pairedSentence{{ID: "1", FullSource: source, FullTarget: previous, Source: []string{source}, Target: []string{previous}}}, "en", "zh_cn", 60, nil)
	if err != nil || len(result) != 1 || result[0].FullTarget != corrected || result[0].LayoutFallback || len(result[0].Source) != 1 || len(result[0].Target) != 1 || result[0].Source[0] != source || result[0].Target[0] != corrected {
		t.Fatalf("恰好60字素的修正未沿用正常配对: result=%+v err=%v", result, err)
	}
}
