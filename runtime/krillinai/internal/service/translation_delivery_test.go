package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"krillin-ai/config"
	"krillin-ai/pkg/util"

	openaiapi "github.com/sashabaranov/go-openai"
)

func TestTranslationFailureStillExportsNativeBilingualSRT(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	config.Conf.App.VttBatchSize = 3
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.TranslateMaxAttempts = 20 // 配置过大也不能突破三次接口预算。
	for _, tc := range []struct {
		name, response string
		status, calls  int
	}{
		{"invalid_content", "not-json", 0, 5},
		{"persistent_429", "", 429, 3},
		{"persistent_500", "", 500, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			vtt := filepath.Join(dir, "source.vtt")
			if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello<00:00:01.000><c> world.</c>\n\n00:00:02.000 --> 00:00:04.000\nGoodbye<00:00:03.000><c> friends.</c>\n"), 0600); err != nil {
				t.Fatal(err)
			}
			calls := 0
			translator := &Translator{recoveryDelay: time.Millisecond, chatCompleter: translationCompleterFunc(func(string) (string, error) {
				calls++
				if tc.status != 0 {
					return "", &openaiapi.APIError{HTTPStatusCode: tc.status}
				}
				return tc.response, nil
			})}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			path, err := (&YouTubeSubtitleService{translator: translator}).processYouTubeSubtitle(ctx, &YoutubeSubtitleReq{
				VttFile: vtt, TaskBasePath: dir, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true,
			})
			if err != nil || calls != tc.calls {
				t.Fatalf("未在请求预算内导出: path=%s calls=%d err=%v", path, calls, err)
			}
			blocks, err := util.ParseSrtFile(path)
			if err != nil || len(blocks) != 2 {
				t.Fatalf("未生成完整双语SRT: blocks=%+v err=%v", blocks, err)
			}
			data, err := os.ReadFile(path)
			if err != nil || strings.Count(string(data), "[待翻译]") != 2 || !strings.Contains(string(data), "Hello world.") || !strings.Contains(string(data), "Goodbye friends.") {
				t.Fatalf("未译内容丢失或被冒充成译文: %s err=%v", data, err)
			}
		})
	}
}

func TestTranslationUntranslatedCheckpointIsRetried(t *testing.T) {
	calls := 0
	translator := &Translator{checkpointDir: t.TempDir(), chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		return echoPairedTestResponse(input)
	})}
	checkpoint, err := translator.openTranslationCheckpoint([]string{"Hello."}, "en", "zh_cn")
	if err != nil {
		t.Fatal(err)
	}
	if err := checkpoint.save(translator.untranslatedPairedSentence(pairedTranslationSource{ID: "1", Text: "Hello."}, "zh_cn")); err != nil {
		t.Fatal(err)
	}
	result, err := translator.translatePairedSentences(context.Background(), []string{"Hello."}, "en", "zh_cn", 60, 1, nil)
	if err != nil || calls != 1 || len(result) != 1 || result[0].Untranslated || strings.Contains(result[0].FullTarget, "待翻译") {
		t.Fatalf("未译检查点被当成成功缓存: result=%+v calls=%d err=%v", result, calls, err)
	}
}
