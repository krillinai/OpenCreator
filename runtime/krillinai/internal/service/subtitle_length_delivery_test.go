package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
)

const attentionSource = "finding something to write about or build is merely a matter of paying attention."
const attentionTarget = "找到可以写或创作的东西，不过是留心观察的事。"

func TestSubtitleLimitAcceptsUpToSixtyFiveCharacters(t *testing.T) {
	for _, target := range []string{strings.Repeat("好", 60), "译" + strings.Repeat("a", 59)} {
		input := pairedTranslationInput{MaxTargetChars: 60, Sentences: []pairedTranslationSource{{ID: "1", Text: "Hello."}}}
		translator := &Translator{}
		for _, extra := range []string{"", "a", "aaaaa", "aaaaaa"} {
			text := target + extra
			data, _ := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: text, Source: []string{"Hello."}, Target: []string{text}}})
			_, err := translator.parsePairedTranslation(string(data), input, "en", "zh_cn")
			if (err != nil) != (subtitleTargetLength(text) > 65) {
				t.Fatalf("65个Unicode字符验收边界错误: text=%q err=%v", text, err)
			}
		}
	}
}

func TestSubtitleExportNeverWrapsEvenWhenOverlong(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 8
	for _, text := range []string{"cafe\u0301 cafe\u0301 👩🏽‍💻👨‍👩‍👧‍👦 你好世界", strings.Repeat("a", 19), strings.Repeat("。", 19)} {
		path := filepath.Join(t.TempDir(), "subtitle.srt")
		data := []byte("129\n00:06:26,680 --> 00:06:35,670\n" + text + "\n\n")
		if err := os.WriteFile(path, data, 0640); err != nil {
			t.Fatal(err)
		}
		if err := ReportSubtitleLengthFallbacks(path); err != nil {
			t.Fatal(err)
		}
		first, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(first) != string(data) {
			t.Fatalf("export modified or wrapped the subtitle: %q", first)
		}
		if err := ReportSubtitleLengthFallbacks(path); err != nil {
			t.Fatal(err)
		}
		second, _ := os.ReadFile(path)
		info, _ := os.Stat(path)
		if string(first) != string(second) || info.Mode().Perm() != 0640 {
			t.Fatal("重复导出改变内容或文件权限")
		}
	}
}

func TestAudioSubtitleFallbackKeepsEachLanguageOnOneLine(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	for _, targetFirst := range []bool{false, true} {
		dir := t.TempDir()
		target := strings.Repeat("完整译文", 20)
		blocks := []*util.SrtBlock{{Index: 1, Timestamp: "00:06:26,680 --> 00:06:35,670", OriginLanguageSentence: attentionSource, TargetLanguageSentence: target}}
		svc := &YouTubeSubtitleService{}
		bilingual := filepath.Join(dir, types.SubtitleTaskBilingualSrtFileName)
		if err := svc.writeBilingualSrtFile(blocks, bilingual, targetFirst); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{types.SubtitleTaskShortOriginSrtFileName, types.SubtitleTaskShortOriginMixedSrtFileName} {
			if err := svc.writeOriginLanguageSrtFile(blocks, filepath.Join(dir, name)); err != nil {
				t.Fatal(err)
			}
		}
		resultType := types.SubtitleResultTypeBilingualTranslationOnBottom
		if targetFirst {
			resultType = types.SubtitleResultTypeBilingualTranslationOnTop
		}
		param := &types.SubtitleTaskStepParam{TaskBasePath: dir, BilingualSrtFilePath: bilingual, OriginLanguage: "en", TargetLanguage: "zh_cn", SubtitleResultType: resultType}
		if err := splitSrt(param); err != nil {
			t.Fatal(err)
		}
		for name, text := range map[string]string{types.SubtitleTaskOriginLanguageSrtFileName: attentionSource, types.SubtitleTaskTargetLanguageSrtFileName: target} {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(string(data)), "\n")[2:]
			if !subtitleSegmentsPreserveText(text, lines) {
				t.Fatalf("单语字幕混入另一语言或丢失文字: %s: %q", name, lines)
			}
			if len(lines) != 1 || lines[0] != text {
				t.Fatalf("单语字幕不得换行: %s: %q", name, data)
			}
		}
	}
}

func TestSubtitleAttentionOverflowUsesLastPairedRepair(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			return "", err
		}
		if calls > 1 && input.Sentences[0].TargetText != attentionTarget {
			t.Fatal("拆段时没有冻结完整译文")
		}
		sentence := pairedSentence{ID: input.Sentences[0].ID, FullTarget: attentionTarget, Source: []string{attentionSource}, Target: []string{attentionTarget}}
		if calls == 3 {
			sentence.Source = []string{"finding something to write about or build", "is merely a matter of paying attention."}
			sentence.Target = []string{"找到可以写或创作的东西，", "不过是留心观察的事。"}
		}
		data, err := encodePairedTestResponse([]pairedSentence{sentence})
		return string(data), err
	})}
	blocks, err := translator.BatchTranslateSrtBlocks(context.Background(), []*util.SrtBlock{{Index: 1, Timestamp: "00:06:26,680 --> 00:06:35,670", OriginLanguageSentence: attentionSource}}, "en", "zh_cn", nil)
	if err != nil || calls != 3 || len(blocks) != 2 {
		t.Fatalf("提前交付了超长片段: calls=%d blocks=%+v err=%v", calls, blocks, err)
	}
	for _, block := range blocks {
		if subtitleTargetLength(block.OriginLanguageSentence) > 60 || subtitleTargetLength(block.TargetLanguageSentence) > 60 {
			t.Fatalf("最终字幕超长: %+v", block)
		}
	}
	if blocks[0].TargetLanguageSentence != "找到可以写或创作的东西，" || blocks[1].TargetLanguageSentence != "不过是留心观察的事。" {
		t.Fatalf("原译意群配对错误: %+v", blocks)
	}
}

func TestSubtitleOverflowFallbackExportsSingleLinesWithoutHidingOverflow(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	for _, cached := range []bool{false, true} {
		dir := t.TempDir()
		calls := 0
		translator := &Translator{checkpointDir: dir, chatCompleter: translationCompleterFunc(func(string) (string, error) {
			calls++
			data, err := encodePairedTestResponse([]pairedSentence{{ID: "1", FullTarget: attentionTarget, Source: []string{attentionSource}, Target: []string{attentionTarget}}})
			return string(data), err
		})}
		if cached {
			checkpoint, err := translator.openTranslationCheckpoint([]string{attentionSource}, "en", "zh_cn")
			if err != nil {
				t.Fatal(err)
			}
			if err := checkpoint.save(pairedSentence{ID: "1", FullTarget: attentionTarget, Source: []string{attentionSource}, Target: []string{attentionTarget}, LayoutFallback: true}); err != nil {
				t.Fatal(err)
			}
		}
		vtt := filepath.Join(dir, "source.vtt")
		if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:06:26.680 --> 00:06:35.670\n"+attentionSource+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		path, err := (&YouTubeSubtitleService{translator: translator}).ProcessBlockLevelVtt(context.Background(), &YoutubeSubtitleReq{VttFile: vtt, TaskBasePath: dir, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true})
		wantCalls := 3
		if cached {
			wantCalls = 0
		}
		if err != nil || calls != wantCalls {
			t.Fatalf("未在预算内导出: cached=%v calls=%d path=%s err=%v", cached, calls, path, err)
		}
		for _, name := range []string{"origin_language_srt.srt", "target_language_srt.srt", "bilingual_srt.srt", "short_origin_mixed_srt.srt"} {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(string(data)), "\n")
			if len(lines) < 3 || lines[0] != "1" || lines[1] != "00:06:26,680 --> 00:06:35,670" {
				t.Fatalf("回退改变了字幕时间: %s", data)
			}
			wantLines := 3
			if name == "bilingual_srt.srt" || name == "short_origin_mixed_srt.srt" {
				wantLines = 4
			}
			if len(lines) != wantLines {
				t.Fatalf("回退字幕不得折行: %s: %q", name, data)
			}
			text := compactSubtitleText(strings.Join(lines[2:], ""))
			if name != "target_language_srt.srt" && !strings.Contains(text, compactSubtitleText(attentionSource)) || name != "origin_language_srt.srt" && !strings.Contains(text, attentionTarget) {
				t.Fatalf("最终文件遗漏原文或译文: %s: %s", name, data)
			}
		}
	}
}
