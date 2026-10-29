package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"krillin-ai/config"
	"krillin-ai/pkg/util"
)

func lengthRepairTestPairs() []pairedTranslationSegment {
	return []pairedTranslationSegment{
		{Source: "on this left column I have my ingredients database ", Target: "左边这一栏是我的食材数据库，"},
		{Source: "and it's just a table that shows all of the different ingredients ", Target: "它只是一张表格，列出了各种不同的食材，"},
		{Source: "that I could use for a recipe ", Target: "这些都是我可以用来做菜谱的食材。"},
	}
}

func lengthRepairTestInput(pairs []pairedTranslationSegment) pairedTranslationInput {
	var text strings.Builder
	for _, pair := range pairs {
		text.WriteString(pair.Source)
	}
	return pairedTranslationInput{SourceLanguage: "English", TargetLanguage: "简体中文", MaxSourceChars: 60, MaxTargetChars: 60,
		Sentences: []pairedTranslationSource{{ID: "1", Text: text.String()}}}
}

func lengthRepairTestResponse(id string, pairs []pairedTranslationSegment) string {
	data, _ := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{{ID: id, Segments: pairs}}})
	return string(data)
}

func lengthRepairTestSplit() []pairedTranslationSegment {
	return []pairedTranslationSegment{
		{Source: "and it's just a table ", Target: "它只是一张表格，"},
		{Source: "that shows all of the different ingredients ", Target: "列出了各种不同的食材，"},
	}
}

func TestPairedLengthAcceptanceChecksSourceUnicodeAndCustomLimits(t *testing.T) {
	for _, limit := range []int{8, 50, 60, 65} {
		accepted := limit
		if limit == 60 {
			accepted = 65
		}
		for _, length := range []int{accepted, accepted + 1} {
			for _, emoji := range []bool{false, true} {
				unit := "a"
				if emoji {
					unit = "👩🏽‍💻"
				}
				text := strings.Repeat(unit, length)
				input := pairedTranslationInput{MaxTargetChars: limit, Sentences: []pairedTranslationSource{{ID: "1", Text: text}}}
				response := lengthRepairTestResponse("1", []pairedTranslationSegment{{Source: text, Target: "有效译文"}})
				_, err := (&Translator{}).parsePairedTranslation(response, input, "en", "zh_cn")
				if (err != nil) != (length > accepted) {
					t.Fatalf("原文或字素簇验收错误: limit=%d length=%d emoji=%v err=%v", limit, length, emoji, err)
				}
			}
		}
	}
}

func TestPairedLengthRepairPreservesAcceptedPairs(t *testing.T) {
	pairs := lengthRepairTestPairs()
	input := lengthRepairTestInput(pairs)
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 1 {
			if !strings.Contains(prompt, "current limit is 60") {
				t.Fatal("首译生成目标被改动")
			}
			return lengthRepairTestResponse("1", pairs), nil
		}
		local, err := decodePairedTestInput(prompt)
		if err != nil || len(local.Sentences) != 1 {
			t.Fatalf("局部修复输入错误: %+v %v", local, err)
		}
		pair := local.Sentences[0]
		if pair.ID != "1.2" || pair.Text != pairs[1].Source || pair.TargetText != pairs[1].Target || !strings.Contains(prompt, "ceiling is 65") {
			t.Fatalf("提交了合格对或改动了原译文: %+v", pair)
		}
		// 即使模型额外返回对合格字幕的改写，也不能应用未请求的ID。
		data, _ := json.Marshal(pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{
			{ID: pair.ID, Segments: lengthRepairTestSplit()},
			{ID: "1.1", Segments: []pairedTranslationSegment{{Source: "changed", Target: "不应应用的修改"}}},
		}})
		return string(data), nil
	})}
	var final pairedSentence
	_, err := translator.translatePairedBatch(context.Background(), input, "en", "zh_cn", func(s pairedSentence, complete bool) error {
		if complete {
			final = s
		}
		return nil
	})
	if err != nil || calls != 2 || len(final.Source) != 4 || final.LayoutFallback || !pairedSentenceWithinLimit(final, 60) {
		t.Fatalf("局部修复失败: calls=%d final=%+v err=%v", calls, final, err)
	}
	if final.Source[0] != pairs[0].Source || final.Target[0] != pairs[0].Target || final.Source[3] != pairs[2].Source || final.Target[3] != pairs[2].Target || !pairedSentenceSegmentsValid(final, input.Sentences[0].Text) {
		t.Fatalf("合格字幕被改动或内容丢失: %+v", final)
	}
}

func TestPairedLengthRepairDoesNotCollapseAfterInvalidRepair(t *testing.T) {
	for _, mode := range []string{"missing_word", "changed_target", "empty_target", "line_break", "duplicate_id", "bad_json", "network_error"} {
		t.Run(mode, func(t *testing.T) {
			pairs := lengthRepairTestPairs()
			input := lengthRepairTestInput(pairs)
			calls := 0
			translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				if calls == 1 {
					return lengthRepairTestResponse("1", pairs), nil
				}
				local, err := decodePairedTestInput(prompt)
				if err != nil || len(local.Sentences) != 1 || local.Sentences[0].Text != pairs[1].Source || local.Sentences[0].TargetText != pairs[1].Target {
					t.Fatalf("失败后重新提交了整组或改写了冻结文本: %+v %v", local, err)
				}
				if mode == "network_error" {
					return "", errors.New("connection lost")
				}
				if mode == "bad_json" {
					return "not-json", nil
				}
				parts := lengthRepairTestSplit()
				switch mode {
				case "missing_word":
					parts[1].Source = strings.ReplaceAll(parts[1].Source, "different ", "")
				case "changed_target":
					parts[0].Target = "这是修改后的译文，"
				case "empty_target":
					parts[0].Target = ""
				case "line_break":
					parts[0].Target = "它只是一张\n表格，"
				}
				item := pairedTranslationOutputSentence{ID: local.Sentences[0].ID, Segments: parts}
				output := pairedTranslationOutput{Sentences: []pairedTranslationOutputSentence{item}}
				if mode == "duplicate_id" {
					output.Sentences = append(output.Sentences, item)
				}
				data, _ := json.Marshal(output)
				return string(data), nil
			})}
			var final pairedSentence
			_, err := translator.translatePairedBatch(context.Background(), input, "en", "zh_cn", func(s pairedSentence, complete bool) error {
				if complete {
					final = s
				}
				return nil
			})
			wantCalls := 3
			if mode == "network_error" {
				wantCalls = 2
			}
			if err != nil || calls != wantCalls || len(final.Source) != len(pairs) || !final.LayoutFallback {
				t.Fatalf("局部失败被放大为整组回退: calls=%d final=%+v err=%v", calls, final, err)
			}
			for i, pair := range pairs {
				if final.Source[i] != pair.Source || final.Target[i] != pair.Target {
					t.Fatalf("失败回复覆盖了原有字幕: %+v", final)
				}
			}
		})
	}
}

func TestPairedLengthRepairBatchesFailuresAndRetriesOnlyRemainingPairs(t *testing.T) {
	pairs := append(lengthRepairTestPairs(), pairedTranslationSegment{
		Source: "and I just have the name of the ingredient with a little emoji that most closely correlates to it ",
		Target: "我只放了食材的名称，再配上一个最能代表它的小表情符号。",
	})
	input := lengthRepairTestInput(pairs)
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 1 {
			return lengthRepairTestResponse("1", pairs), nil
		}
		local, err := decodePairedTestInput(prompt)
		if err != nil || len(local.Sentences) != 4-calls {
			t.Fatalf("未批量修复或重复提交了成功对: %+v err=%v", local, err)
		}
		var output pairedTranslationOutput
		for _, pair := range local.Sentences {
			parts := lengthRepairTestSplit()
			if pair.Text == pairs[3].Source {
				parts = []pairedTranslationSegment{
					{Source: "and I just have the name of the ingredient ", Target: "我只放了食材的名称，"},
					{Source: "with a little emoji that most closely correlates to it ", Target: "再配上一个最能代表它的小表情符号。"},
				}
			} else if calls == 2 {
				parts[1].Source = strings.ReplaceAll(parts[1].Source, "different ", "")
			}
			output.Sentences = append(output.Sentences, pairedTranslationOutputSentence{ID: pair.ID, Segments: parts})
		}
		data, _ := json.Marshal(output)
		return string(data), nil
	})}
	var final pairedSentence
	_, err := translator.translatePairedBatch(context.Background(), input, "en", "zh_cn", func(s pairedSentence, complete bool) error {
		if complete {
			final = s
		}
		return nil
	})
	if err != nil || calls != 3 || len(final.Source) != 6 || !pairedSentenceWithinLimit(final, 60) || !pairedSentenceSegmentsValid(final, input.Sentences[0].Text) {
		t.Fatalf("批量局部修复失败: calls=%d final=%+v err=%v", calls, final, err)
	}
}

func TestPairedLengthRepairRejectsBrokenGraphemeBoundaries(t *testing.T) {
	source := pairedTranslationSource{ID: "1.2", Text: "e\u0301x", TargetText: "好呀"}
	_, err := validatePairedLengthRepair(pairedTranslationOutputSentence{ID: source.ID, Segments: []pairedTranslationSegment{
		{Source: "e", Target: "好"}, {Source: "\u0301x", Target: "呀"},
	}}, source)
	if err == nil {
		t.Fatal("接受了破坏字素簇的切口")
	}
}

func TestPairedLengthRepairRetriesOnlyOverlongChildren(t *testing.T) {
	head := "and I just have the name of the ingredient with a little emoji that most "
	tail := "closely correlates to it "
	headTarget := "我只放了食材的名称，再配上一个最能代表它的"
	tailTarget := "小表情符号。"
	pairs := []pairedTranslationSegment{lengthRepairTestPairs()[0], {Source: head + tail, Target: headTarget + tailTarget}}
	input := lengthRepairTestInput(pairs)
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 1 {
			return lengthRepairTestResponse("1", pairs), nil
		}
		local, err := decodePairedTestInput(prompt)
		if err != nil || len(local.Sentences) != 1 {
			t.Fatalf("局部输入错误: %+v err=%v", local, err)
		}
		pair := local.Sentences[0]
		if calls == 2 {
			return lengthRepairTestResponse(pair.ID, []pairedTranslationSegment{{Source: head, Target: headTarget}, {Source: tail, Target: tailTarget}}), nil
		}
		if pair.Text != head || pair.TargetText != headTarget {
			t.Fatalf("再次提交了已经拆短的子字幕: %+v", pair)
		}
		return lengthRepairTestResponse(pair.ID, []pairedTranslationSegment{
			{Source: "and I just have the name of the ingredient ", Target: "我只放了食材的名称，"},
			{Source: "with a little emoji that most ", Target: "再配上一个最能代表它的"},
		}), nil
	})}
	var final pairedSentence
	_, err := translator.translatePairedBatch(context.Background(), input, "en", "zh_cn", func(s pairedSentence, complete bool) error {
		if complete {
			final = s
		}
		return nil
	})
	if err != nil || calls != 3 || len(final.Source) != 4 || final.Source[0] != pairs[0].Source || final.Source[3] != tail || final.Target[3] != tailTarget || !pairedSentenceWithinLimit(final, 60) || !pairedSentenceSegmentsValid(final, input.Sentences[0].Text) {
		t.Fatalf("子字幕局部重试失败: calls=%d final=%+v err=%v", calls, final, err)
	}
}

func TestPairedLengthRepairHonorsCancellationAndPreservesCheckpoint(t *testing.T) {
	pairs := lengthRepairTestPairs()
	input := lengthRepairTestInput(pairs)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	var saved pairedSentence
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 1 {
			return lengthRepairTestResponse("1", pairs), nil
		}
		cancel()
		return "", ctx.Err()
	})}
	_, err := translator.translatePairedBatch(ctx, input, "en", "zh_cn", func(s pairedSentence, _ bool) error { saved = s; return nil })
	if !errors.Is(err, context.Canceled) || calls != 2 || !reflect.DeepEqual(saved.Source, []string{pairs[0].Source, pairs[1].Source, pairs[2].Source}) {
		t.Fatalf("取消时丢失原有字幕: %+v calls=%d err=%v", saved, calls, err)
	}
}

func TestPairedLengthRepairExportsNativeSingleLineBilingualSRT(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.MaxSentenceLength = 60
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.VttBatchSize = 3
	pairs := lengthRepairTestPairs()
	input := lengthRepairTestInput(pairs)
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 1 {
			return lengthRepairTestResponse("1", pairs), nil
		}
		local, err := decodePairedTestInput(prompt)
		if err != nil || len(local.Sentences) != 1 || local.Sentences[0].Text != pairs[1].Source {
			t.Fatalf("字幕导出触发了整组重翻: %+v err=%v", local, err)
		}
		return lengthRepairTestResponse(local.Sentences[0].ID, lengthRepairTestSplit()), nil
	})}
	dir := t.TempDir()
	vtt := filepath.Join(dir, "source.vtt")
	if err := os.WriteFile(vtt, []byte("WEBVTT\n\n00:00:01.000 --> 00:00:09.000\n"+input.Sentences[0].Text+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	path, err := (&YouTubeSubtitleService{translator: translator}).ProcessBlockLevelVtt(context.Background(), &YoutubeSubtitleReq{
		VttFile: vtt, TaskBasePath: dir, OriginLanguage: "en", TargetLanguage: "zh_cn", TargetLanguageFirst: true,
	})
	if err != nil || calls != 2 {
		t.Fatalf("字幕文件未生成: calls=%d path=%s err=%v", calls, path, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cues := strings.Split(strings.TrimSpace(string(data)), "\n\n")
	if len(cues) != 4 {
		t.Fatalf("最终字幕条数错误: %s", data)
	}
	for _, cue := range cues {
		lines := strings.Split(cue, "\n")
		if len(lines) != 4 || subtitleTargetLength(lines[2]) > 65 || subtitleTargetLength(lines[3]) > 65 {
			t.Fatalf("双语字幕存在折行或超长: %s", cue)
		}
		if start, end, err := parseSRTTimeline(lines[1]); err != nil || end <= start {
			t.Fatalf("字幕时间无效: %s", cue)
		}
	}
	origin, err := util.ParseSrtFile(filepath.Join(dir, "origin_language_srt.srt"))
	var sources []string
	for _, block := range origin {
		sources = append(sources, block.OriginLanguageSentence)
	}
	if err != nil || !subtitleSegmentsPreserveText(input.Sentences[0].Text, sources) || sources[0] != strings.TrimSpace(pairs[0].Source) || sources[3] != strings.TrimSpace(pairs[2].Source) {
		t.Fatalf("最终文件遗漏或改动合格原文: %+v err=%v", origin, err)
	}
}
