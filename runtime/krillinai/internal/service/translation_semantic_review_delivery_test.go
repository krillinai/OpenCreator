package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
)

type semanticReviewDeliveryCase struct {
	name, source, previous, corrected, quote string
	originLang, targetLang                   types.StandardLanguageCode
	segments                                 []pairedTranslationSegment
	correctedSegments                        []pairedTranslationSegment
}

func semanticReviewDeliveryCases() []semanticReviewDeliveryCase {
	return []semanticReviewDeliveryCase{
		{
			name: "source_long_negation", originLang: "en", targetLang: "zh_cn",
			source:    "The changes will not happen today, but they may happen tomorrow.",
			previous:  "这些变化会在今天发生，也会在明天发生。",
			corrected: "这些变化不会在今天发生，但可能在明天发生。",
			quote:     "will not",
			segments: []pairedTranslationSegment{
				{Source: "The changes will not happen today, ", Target: "这些变化会在今天发生，"},
				{Source: "but they may happen tomorrow.", Target: "也会在明天发生。"},
			},
			correctedSegments: []pairedTranslationSegment{
				{Source: "The changes will not happen today, ", Target: "这些变化不会在今天发生，"},
				{Source: "but they may happen tomorrow.", Target: "但可能在明天发生。"},
			},
		},
		{
			name: "target_long_number", originLang: "zh_cn", targetLang: "en",
			source:    "请在周五前支付三十五美元，而不是五十美元。",
			previous:  "Please pay 50 dollars before Friday.",
			corrected: "Please pay 35 dollars before Friday, rather than the 50 dollars previously stated.",
			quote:     "三十五美元，而不是五十美元",
			segments: []pairedTranslationSegment{
				{Source: "请在周五前支付三十五美元，而不是五十美元。", Target: "Please pay 50 dollars before Friday."},
			},
			correctedSegments: []pairedTranslationSegment{
				{Source: "请在周五前支付三十五美元，", Target: "Please pay 35 dollars before Friday, "},
				{Source: "而不是五十美元。", Target: "rather than the 50 dollars previously stated."},
			},
		},
	}
}

// Run the real translation, checkpoint and export code with fixed responses and timings.
// No HTTP client or transcription service is used by this fixture.
func runSemanticReviewDelivery(t *testing.T, tc semanticReviewDeliveryCase, route string, targetFirst bool, reviewMode string) (string, int, int) {
	t.Helper()
	dir := t.TempDir()
	translationCalls, reviewCalls := 0, 0
	completer := semanticReviewTestCompleter(func(ctx context.Context, prompt string) (string, error) {
		if strings.HasPrefix(prompt, translationSemanticReviewPrompt) {
			reviewCalls++
			if !strings.Contains(prompt, `"target_text":"`+tc.previous+`"`) {
				t.Fatal("审核未收到完整的初译")
			}
			if reviewMode == "deadline" {
				return "", context.DeadlineExceeded
			}
			if reviewMode == "bad_json" {
				return "not-json", nil
			}
			quote := tc.quote
			if reviewMode == "invalid_evidence" {
				quote = "evidence not in the source"
			}
			return semanticReviewTestResponse(semanticCorrection{
				pairedTranslationOutputSentence: pairedTranslationOutputSentence{ID: "1", FullTarget: tc.corrected},
				OriginalTarget:                  tc.previous, Kind: "meaning", SourceQuote: quote, Reason: "Correct the negation or number contradicted by the source.",
			}), nil
		}
		translationCalls++
		segments := tc.segments
		if reviewCalls > 0 {
			input, err := decodePairedTestInput(prompt)
			if err != nil || input.Sentences[0].TargetText != tc.corrected {
				t.Fatalf("审核修正后的分段必须冻结译文: input=%+v err=%v", input, err)
			}
			segments = tc.correctedSegments
		}
		data, err := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: "1", Segments: segments}}})
		return string(data), err
	})
	if route == "platform" {
		vtt := filepath.Join(dir, "source.vtt")
		if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:00:01.000 --> 00:00:09.000\n"+tc.source+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := (&YouTubeSubtitleService{translator: &Translator{chatCompleter: completer}}).processYouTubeSubtitle(context.Background(), &YoutubeSubtitleReq{
			VttFile: vtt, TaskBasePath: dir, OriginLanguage: string(tc.originLang), TargetLanguage: string(tc.targetLang), TargetLanguageFirst: targetFirst,
		}); err != nil {
			t.Fatal(err)
		}
	} else {
		items, err := (Service{ChatCompleter: completer}).splitTextAndTranslateV2(context.Background(), dir, tc.source, tc.originLang, tc.targetLang, false, 0, nil)
		if err != nil {
			t.Fatal(err)
		}
		var blocks []*util.SrtBlock
		for i, item := range items {
			blocks = append(blocks, &util.SrtBlock{Index: i + 1, OriginLanguageSentence: item.OriginText, TargetLanguageSentence: item.TranslatedText})
		}
		texts := strings.Fields(tc.source)
		var words []types.Word
		for i, text := range texts {
			words = append(words, types.Word{Num: i, Text: text, Start: 1 + 8*float64(i)/float64(len(texts)), End: 1 + 8*float64(i+1)/float64(len(texts))})
		}
		resultType := types.SubtitleResultTypeBilingualTranslationOnBottom
		if targetFirst {
			resultType = types.SubtitleResultTypeBilingualTranslationOnTop
		}
		param := &types.SubtitleTaskStepParam{TaskBasePath: dir, OriginLanguage: tc.originLang, TargetLanguage: tc.targetLang, SubtitleResultType: resultType}
		if err := generateSrtWithTimestamps(blocks, 0, words, 0, param); err != nil {
			t.Fatal(err)
		}
		for _, files := range [][2]string{
			{types.SubtitleTaskSplitBilingualSrtFileNamePattern, types.SubtitleTaskBilingualSrtFileName},
			{types.SubtitleTaskSplitShortOriginSrtFileNamePattern, types.SubtitleTaskShortOriginSrtFileName},
			{types.SubtitleTaskSplitShortOriginMixedSrtFileNamePattern, types.SubtitleTaskShortOriginMixedSrtFileName},
		} {
			if err := util.MergeSrtFiles(filepath.Join(dir, files[1]), filepath.Join(dir, fmt.Sprintf(files[0], 0))); err != nil {
				t.Fatal(err)
			}
		}
		param.BilingualSrtFilePath = filepath.Join(dir, types.SubtitleTaskBilingualSrtFileName)
		if err := splitSrt(param); err != nil {
			t.Fatal(err)
		}
	}
	return dir, translationCalls, reviewCalls
}

func assertSemanticReviewDelivery(t *testing.T, dir string, tc semanticReviewDeliveryCase, route string, targetFirst, corrected bool) {
	t.Helper()
	target := tc.previous
	if corrected {
		target = tc.corrected
	}
	for _, file := range []struct{ name, text string }{
		{types.SubtitleTaskOriginLanguageSrtFileName, tc.source},
		{types.SubtitleTaskTargetLanguageSrtFileName, target},
		{types.SubtitleTaskBilingualSrtFileName, ""},
	} {
		data, err := os.ReadFile(filepath.Join(dir, file.name))
		if err != nil {
			t.Fatal(err)
		}
		var textLines []string
		cues := strings.Split(strings.TrimSpace(string(data)), "\n\n")
		for _, cue := range cues {
			lines := strings.Split(cue, "\n")
			wantLines := 3
			if file.text == "" {
				wantLines = 4
			}
			if len(lines) != wantLines {
				t.Fatalf("字幕块不完整: %s", data)
			}
			for _, line := range lines[2:] {
				if subtitleTargetLength(line) > 60 {
					t.Fatalf("最终字幕行超过60字素: %s: %q", file.name, line)
				}
			}
			textLines = append(textLines, lines[2:]...)
		}
		if file.text != "" {
			if !subtitleSegmentsPreserveText(file.text, textLines) || !subtitleSegmentsHaveSafeBoundariesInText(file.text, textLines) {
				t.Fatalf("原文或修正译文未完整进入%s: %q", file.name, data)
			}
		} else {
			segments := tc.segments
			if corrected {
				segments = tc.correctedSegments
			}
			if len(cues) != len(segments) {
				t.Fatalf("字幕没有按双语配对拆成独立时间段: %s", data)
			}
			var previousEnd int64 = 1000
			for i, cue := range cues {
				lines := strings.Split(cue, "\n")
				start, end, err := parseSRTTimeline(lines[1])
				if err != nil || start < previousEnd || end <= start || i == 0 && start != 1000 || i == len(cues)-1 && end != 9000 {
					t.Fatalf("分段时间无效: %s", data)
				}
				previousEnd = end
				first, second := strings.TrimSpace(segments[i].Source), strings.TrimSpace(segments[i].Target)
				if targetFirst {
					first, second = second, first
				}
				if lines[2] != first || lines[3] != second {
					t.Fatalf("双语配对错位或折行: %s", data)
				}
			}
		}
	}
	files, err := filepath.Glob(filepath.Join(dir, "translation-checkpoints", "*", "1.json"))
	if err != nil || len(files) != 1 {
		t.Fatalf("单句检查点缺失: %v err=%v", files, err)
	}
	data, err := os.ReadFile(files[0])
	var saved pairedSentence
	if err != nil || json.Unmarshal(data, &saved) != nil || saved.FullTarget != target {
		t.Fatalf("检查点未保存最终译文: %s err=%v", data, err)
	}
	if corrected && (saved.LayoutFallback || len(saved.Source) != len(tc.correctedSegments) || !subtitleSegmentsPreserveText(tc.source, saved.Source) || !subtitleSegmentsPreserveText(target, saved.Target)) {
		t.Fatalf("检查点未保存修正后的单行配对: %+v", saved)
	}
	files, err = filepath.Glob(filepath.Join(dir, "translation_*.json"))
	if err != nil || (route == "audio" && len(files) != 1) {
		t.Fatalf("音频聚合检查点缺失: %v err=%v", files, err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		var items []*TranslatedItem
		if err != nil || json.Unmarshal(data, &items) != nil {
			t.Fatalf("音频聚合检查点无效: %s err=%v", data, err)
		}
		var targets []string
		for _, item := range items {
			targets = append(targets, item.TranslatedText)
		}
		if !subtitleSegmentsPreserveText(target, targets) {
			t.Fatalf("音频聚合检查点仍是旧译文: %s", data)
		}
	}
}

func TestSemanticReviewLongCorrectionsReachNativeDelivery(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	for _, tc := range semanticReviewDeliveryCases() {
		for _, route := range []string{"platform", "audio"} {
			for _, targetFirst := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/target_first_%t", tc.name, route, targetFirst), func(t *testing.T) {
					dir, translations, reviews := runSemanticReviewDelivery(t, tc, route, targetFirst, "valid")
					if translations != 2 || reviews != 1 {
						t.Fatalf("修正引入额外模型调用: translations=%d reviews=%d", translations, reviews)
					}
					assertSemanticReviewDelivery(t, dir, tc, route, targetFirst, true)
				})
			}
		}
	}
}

func TestSemanticReviewLongFailureStillExportsNativeSRT(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	tc := semanticReviewDeliveryCases()[0]
	for _, mode := range []string{"deadline", "bad_json", "invalid_evidence"} {
		for _, route := range []string{"platform", "audio"} {
			t.Run(mode+"/"+route, func(t *testing.T) {
				dir, translations, reviews := runSemanticReviewDelivery(t, tc, route, true, mode)
				if translations != 1 || reviews != 1 {
					t.Fatalf("审核失败发生重试: translations=%d reviews=%d", translations, reviews)
				}
				assertSemanticReviewDelivery(t, dir, tc, route, true, false)
			})
		}
	}
}
