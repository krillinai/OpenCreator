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

// 使用真实 HTTP 客户端、翻译器、时间映射、文件导出和恢复检查点。
func TestSubtitleRecoveryIntegration(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf = config.Config{}
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.MaxSentenceLength = 50
	config.Conf.Llm.Model = "recovery-test"
	for _, route := range []string{"srt", "vtt"} {
		for _, length := range []int{51, 56} {
			t.Run(fmt.Sprintf("%s/%d", route, length), func(t *testing.T) {
				target := "译" + strings.Repeat("a", length-1)
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var request struct {
						Messages []struct {
							Content string `json:"content"`
						} `json:"messages"`
					}
					_ = json.NewDecoder(r.Body).Decode(&request)
					content, _ := json.Marshal(map[string]any{"sentences": []any{map[string]any{"sentence_id": "1", "target_text": target, "segments": []any{map[string]string{"source": "Hello.", "target": target}}}}})
					if strings.HasPrefix(request.Messages[len(request.Messages)-1].Content, "检查以下") {
						content = []byte(`{"corrections":[]}`)
					} else {
						calls.Add(1)
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "recovery", "choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": string(content)}}}})
				}))
				defer server.Close()
				config.Conf.App.MaxSentenceLength = 50
				config.Conf.Llm.BaseUrl = server.URL + "/v1"
				workdir := t.TempDir()
				path := filepath.Join(workdir, "input."+route)
				input := "1\n00:00:01,000 --> 00:00:03,000\nHello.\n\n"
				if route == "vtt" {
					input = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello.\n\n"
				}
				if err := os.WriteFile(path, []byte(input), 0600); err != nil {
					t.Fatal(err)
				}
				run := func() {
					svc := service.NewService()
					if route == "srt" {
						response, err := GenerateSubtitles(context.Background(), NewServiceAdapter(svc), SubtitleRequest{TaskID: "recovery", Workdir: workdir, InputSRT: path, OriginLang: "en", TargetLang: "zh_cn", BilingualTop: true})
						if err != nil || !response.OK {
							t.Fatalf("response=%+v err=%v", response, err)
						}
					} else {
						if _, err := svc.ProcessYouTubeSubtitle(context.Background(), &service.YoutubeSubtitleReq{TaskId: "recovery", TaskBasePath: workdir, VttFile: path, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true}); err != nil {
							t.Fatal(err)
						}
					}
					blocks, err := readSRTBlocks(filepath.Join(workdir, types.SubtitleTaskTargetLanguageSrtFileName))
					if err != nil || len(blocks) != 1 || strings.Join(blocks[0].Lines, "") != target || blocks[0].Timestamp != "00:00:01,000 --> 00:00:03,000" {
						t.Fatalf("最终导出内容或时间丢失: %+v err=%v", blocks, err)
					}
					for _, line := range blocks[0].Lines {
						if len([]rune(line)) > config.Conf.App.MaxSentenceLength {
							t.Fatalf("最终导出行超过上限: %q", line)
						}
					}
				}
				run()
				want := int32(3)
				if calls.Load() != want {
					t.Fatalf("额外翻译请求: got=%d want=%d", calls.Load(), want)
				}
				config.Conf.App.MaxSentenceLength = 20
				run()
				if calls.Load() != want {
					t.Fatalf("修改排版设置后重译了已保存内容: %d", calls.Load())
				}
			})
		}
	}
}
