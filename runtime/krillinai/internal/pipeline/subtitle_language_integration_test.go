package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/service"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// Exercise the real service constructor, HTTP LLM client, translator, timing and
// subtitle writers. The synthetic probes test routing, not model language skill.
func TestCatalogSourceTranslationIntegration(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf = config.Config{}
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.TranslateMaxAttempts = 1
	config.Conf.App.MaxSentenceLength = 100
	config.Conf.App.ShortSubtitleMaxChars = 20
	config.Conf.Llm.Model = "catalog-test"

	sources := 0
	for _, language := range types.LanguageCatalog {
		if !language.Speech {
			continue
		}
		sources++
		t.Run(language.Code, func(t *testing.T) {
			original := []string{language.NativeName + " OpenCreator 2026!", language.NativeName + " OpenCreator 52!"}
			target := []string{"测试译文2026。", "测试译文52。"}
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var request struct {
					Model    string                     `json:"model"`
					Messages []struct{ Content string } `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Model != "catalog-test" || len(request.Messages) != 2 || r.URL.Path != "/v1/chat/completions" {
					t.Errorf("unexpected LLM request: %+v error=%v path=%s", request, err, r.URL.Path)
					http.Error(w, "invalid LLM request", http.StatusBadRequest)
					return
				}
				_, payload, found := strings.Cut(request.Messages[1].Content, "输入 JSON：\n")
				var input struct {
					SourceLanguage string `json:"source_language"`
					TargetLanguage string `json:"target_language"`
					Sentences      []struct {
						ID   string `json:"sentence_id"`
						Text string `json:"text"`
					} `json:"sentences"`
				}
				if err := json.NewDecoder(strings.NewReader(payload)).Decode(&input); err != nil || !found || input.SourceLanguage != language.NativeName || input.TargetLanguage != "简体中文" || len(input.Sentences) != 2 {
					t.Errorf("language or sentence routing failed: %+v error=%v", input, err)
					http.Error(w, "invalid subtitle input", http.StatusBadRequest)
					return
				}
				sentences := make([]map[string]any, len(input.Sentences))
				for index, sentence := range input.Sentences {
					if sentence.Text != original[index] || sentence.ID != fmt.Sprint(index+1) {
						t.Errorf("source text or order changed: %+v", sentence)
					}
					sentences[index] = map[string]any{"sentence_id": sentence.ID, "target_text": target[index], "segments": []map[string]string{{"source": sentence.Text, "target": target[index]}}}
				}
				content, err := json.Marshal(map[string]any{"sentences": sentences})
				if err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if err := json.NewEncoder(w).Encode(map[string]any{"id": "local-catalog-test", "choices": []map[string]any{{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": string(content)}}}}); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			config.Conf.Llm.BaseUrl = server.URL + "/v1"
			svc := service.NewService()
			for _, route := range []string{"srt", "block-vtt"} {
				t.Run(route, func(t *testing.T) {
					workdir := t.TempDir()
					sourcePath := filepath.Join(workdir, "source."+route)
					if route == "srt" {
						content := fmt.Sprintf("1\n00:00:02,000 --> 00:00:04,000\n%s\n\n2\n00:00:05,000 --> 00:00:07,000\n%s\n\n", original[0], original[1])
						if err := os.WriteFile(sourcePath, []byte(content), 0600); err != nil {
							t.Fatal(err)
						}
						response, err := GenerateSubtitles(context.Background(), NewServiceAdapter(svc), SubtitleRequest{TaskID: language.Code, Workdir: workdir, OriginLang: language.Code, TargetLang: "zh_cn", InputSRT: sourcePath, BilingualTop: true})
						if err != nil {
							t.Fatal(err)
						}
						assertCatalogSubtitleFiles(t, response.Outputs.OriginSRT, response.Outputs.TargetSRT, response.Outputs.BilingualSRT, original, target)
						manifest, err := LoadManifest(workdir)
						if err != nil || manifest.OriginLanguage != language.Code || manifest.TargetLanguage != "zh_cn" {
							t.Fatalf("language metadata changed: %+v error=%v", manifest, err)
						}
					} else {
						content := fmt.Sprintf("WEBVTT\n\n00:00:02.000 --> 00:00:04.000\n%s\n\n00:00:05.000 --> 00:00:07.000\n%s\n\n", original[0], original[1])
						if err := os.WriteFile(sourcePath, []byte(content), 0600); err != nil {
							t.Fatal(err)
						}
						_, err := svc.ProcessYouTubeSubtitle(context.Background(), &service.YoutubeSubtitleReq{TaskId: language.Code, TaskBasePath: workdir, OriginLanguage: language.Code, TargetLanguage: "zh_cn", VttFile: sourcePath, TargetLanguageFirst: true})
						if err != nil {
							t.Fatal(err)
						}
						assertCatalogSubtitleFiles(t, filepath.Join(workdir, types.SubtitleTaskOriginLanguageSrtFileName), filepath.Join(workdir, types.SubtitleTaskTargetLanguageSrtFileName), filepath.Join(workdir, types.SubtitleTaskBilingualSrtFileName), original, target)
					}
				})
			}
			if calls.Load() != 2 {
				t.Fatalf("expected one HTTP translation per route, got %d", calls.Load())
			}
		})
	}
	if sources != 123 {
		t.Fatalf("expected 123 source languages, got %d", sources)
	}
}

func assertCatalogSubtitleFiles(t *testing.T, sourcePath, targetPath, bilingualPath string, original, translated []string) {
	t.Helper()
	for path, text := range map[string][]string{sourcePath: original, targetPath: translated, bilingualPath: {translated[0] + "\n" + original[0], translated[1] + "\n" + original[1]}} {
		blocks, err := readSRTBlocks(path)
		if err != nil || len(blocks) != 2 {
			t.Fatalf("invalid output %s: %+v error=%v", filepath.Base(path), blocks, err)
		}
		for index, block := range blocks {
			start := 2 + index*3
			if block.Index != fmt.Sprint(index+1) || block.Timestamp != fmt.Sprintf("00:00:%02d,000 --> 00:00:%02d,000", start, start+2) || strings.Join(block.Lines, "\n") != text[index] {
				t.Fatalf("text, order or timestamp changed in %s: %+v want=%q", filepath.Base(path), block, text[index])
			}
		}
	}
}
