package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"krillin-ai/config"
	"krillin-ai/pkg/util"

	openaiapi "github.com/sashabaranov/go-openai"
)

func TestTranslationSentenceRequestBudgetExportsSRT(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	config.Conf.App.VttBatchSize = 3
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.TranslateMaxAttempts = 20
	for _, tc := range []struct {
		name, text   string
		untranslated string
	}{
		{"rate_limit_invalid_json", "Hello.", "1"},
		{"server_error_truncated", "Hello.", "1"},
		{"keep_layout_target", "Hello.", ""},
		{"partial_batch", "First. Second.", "2"},
		{"plain_children", "First. Second.", "1"},
		{"last_allowed_success", "Hello.", ""},
		{"independent_batches", "First. Second. Third. Fourth.", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.name == "independent_batches" {
				config.Conf.App.VttBatchSize = 1
			} else {
				config.Conf.App.VttBatchSize = 3
			}
			dir := t.TempDir()
			calls := make(map[string]int)
			var requests []map[string]any
			longTarget := strings.Repeat("完整译文", 22)
			translator := &Translator{recoveryDelay: time.Millisecond, chatCompleter: translationCompleterFunc(func(prompt string) (response string, requestErr error) {
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				var ids []string
				for _, source := range input.Sentences {
					ids = append(ids, source.ID)
					calls[source.ID]++
				}
				plain := strings.HasPrefix(prompt, plainTranslationPrompt)
				defer func() {
					requests = append(requests, map[string]any{"ids": ids, "plain": plain, "response": response, "status": translationRequestStatus(requestErr), "failed": requestErr != nil})
				}()
				ordinal := len(requests) + 1
				source := input.Sentences[0]
				rateLimit := func() (string, error) { return "", &openaiapi.APIError{HTTPStatusCode: 429} }
				switch tc.name {
				case "rate_limit_invalid_json":
					if ordinal%3 != 0 {
						return rateLimit()
					}
					return "not-json", nil
				case "server_error_truncated":
					if ordinal%2 == 1 {
						return "", &openaiapi.APIError{HTTPStatusCode: 500}
					}
					return "", errors.New("llm_translation_truncated")
				case "keep_layout_target":
					if ordinal != 2 {
						return rateLimit()
					}
					data, err := encodePairedTestResponse([]pairedSentence{{ID: source.ID, FullTarget: longTarget, Source: []string{source.Text}, Target: []string{longTarget}}})
					return string(data), err
				case "partial_batch":
					if ordinal%2 == 1 {
						return rateLimit()
					}
					if ordinal != 2 {
						return "not-json", nil
					}
					var sentences []pairedSentence
					for _, source := range input.Sentences {
						target := "有效译文" + source.ID
						if source.ID == "2" {
							target = source.Text
						}
						sentences = append(sentences, pairedSentence{ID: source.ID, Source: []string{source.Text}, Target: []string{target}})
					}
					data, err := encodePairedTestResponse(sentences)
					return string(data), err
				case "plain_children", "last_allowed_success":
					if !plain {
						return "not-json", nil
					}
					if tc.name == "plain_children" && source.ID == "1" {
						return rateLimit()
					}
					return fmt.Sprintf(`{"sentence_id":%q,"target_text":%q}`, source.ID, "有效译文"+source.ID), nil
				case "independent_batches":
					if calls[source.ID] == 1 {
						return rateLimit()
					}
				}
				return echoPairedTestResponse(input)
			})}
			vtt := filepath.Join(dir, "source.vtt")
			if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:00:01.000 --> 00:00:09.000\n"+tc.text+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			path, err := (&YouTubeSubtitleService{translator: translator}).processYouTubeSubtitle(ctx, &YoutubeSubtitleReq{
				VttFile: vtt, TaskBasePath: dir, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true,
			})
			evidence, _ := json.Marshal(map[string]any{"calls_by_sentence": calls, "requests": requests, "output": path})
			t.Logf("BUDGET_EVIDENCE %s", evidence)
			if err != nil {
				t.Fatal(err)
			}
			files, err := filepath.Glob(filepath.Join(dir, "translation-checkpoints", "*", "*.json"))
			if err != nil || len(files) != len(splitTranslationSentences(tc.text)) {
				t.Fatalf("字幕缺少检查点: files=%v err=%v", files, err)
			}
			for _, file := range files {
				data, err := os.ReadFile(file)
				var sentence pairedSentence
				if err != nil || json.Unmarshal(data, &sentence) != nil {
					t.Fatalf("检查点无效: %s err=%v", data, err)
				}
				wantUntranslated := sentence.ID == tc.untranslated
				if sentence.Untranslated != wantUntranslated {
					t.Fatalf("未译标记不符: %+v", sentence)
				}
				if tc.name == "keep_layout_target" && (sentence.FullTarget != longTarget || !sentence.LayoutFallback) {
					t.Fatalf("预算耗尽丢失已有有效译文: %+v", sentence)
				}
			}
			bilingual, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if (tc.untranslated != "") != strings.Contains(string(bilingual), "[待翻译]") {
				t.Fatalf("最终字幕未明确标识待翻译: %s", bilingual)
			}
			if tc.name == "keep_layout_target" && !strings.Contains(compactSubtitleText(string(bilingual)), longTarget) {
				t.Fatalf("最终字幕丢失保留译文: %s", bilingual)
			}
			for _, name := range []string{"origin_language_srt.srt", "target_language_srt.srt", "bilingual_srt.srt", "short_origin_mixed_srt.srt"} {
				data, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil {
					t.Fatal(err)
				}
				for _, cue := range strings.Split(strings.TrimSpace(string(data)), "\n\n") {
					lines := strings.Split(cue, "\n")
					if len(lines) < 3 {
						t.Fatalf("导出不完整: %s", data)
					}
					if start, end, err := parseSRTTimeline(lines[1]); err != nil || end <= start {
						t.Fatalf("字幕时间无效: %s", cue)
					}
					for _, line := range lines[2:] {
						if subtitleTargetLength(line) > 60 {
							t.Fatalf("最终字幕行超60字素: %q", line)
						}
					}
				}
			}
			origin, err := util.ParseSrtFile(filepath.Join(dir, "origin_language_srt.srt"))
			var sourceParts []string
			for _, block := range origin {
				sourceParts = append(sourceParts, block.OriginLanguageSentence)
			}
			if err != nil || !subtitleSegmentsPreserveText(tc.text, sourceParts) {
				t.Fatalf("预算耗尽遗漏原文: %+v err=%v", origin, err)
			}
			for id, attempts := range calls {
				if attempts > 4 {
					t.Errorf("句子%s参与%d次请求，超过首次生成加三次恢复的总上限4", id, attempts)
				}
			}
			if tc.name == "partial_batch" && calls["1"] != 2 {
				t.Fatalf("重复请求已完成句子: %v", calls)
			}
			if (tc.name == "plain_children" || tc.name == "last_allowed_success") && calls[fmt.Sprint(len(calls))] != 4 {
				t.Fatalf("最后一次允许的整句恢复没有机会完成: %v", calls)
			}
		})
	}
}
