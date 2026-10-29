package service

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/BurntSushi/toml"
)

// 只审计已有产物，不调用模型，不修改字幕文件。
func TestGeneratedWordSubtitleAuditLive(t *testing.T) {
	dir := os.Getenv("KRILLINAI_SUBTITLE_AUDIT_DIR")
	vtt := os.Getenv("KRILLINAI_SUBTITLE_AUDIT_VTT")
	if dir == "" || vtt == "" {
		t.Skip("指定新视频的字幕目录和VTT后审计")
	}
	log.InitLogger()
	svc := &YouTubeSubtitleService{}
	words, err := svc.ExtractWordsFromVtt(vtt)
	if err != nil {
		t.Fatal(err)
	}
	var rawSource strings.Builder
	for _, word := range words {
		rawSource.WriteString(word.Text)
	}
	read := func(name string) []*util.SrtBlock {
		t.Helper()
		blocks, err := util.ParseSrtFile(filepath.Join(dir, name))
		if err != nil || len(blocks) == 0 {
			t.Fatalf("无法读取字幕%s: %v", name, err)
		}
		for i, block := range blocks {
			start, end, err := parseSRTTimeline(block.Timestamp)
			if err != nil || start < 0 || end <= start || block.Index != i+1 {
				t.Fatalf("字幕%s第%d条编号或时间无效", name, i+1)
			}
		}
		return blocks
	}
	origin := read(types.SubtitleTaskOriginLanguageSrtFileName)
	target := read(types.SubtitleTaskTargetLanguageSrtFileName)
	bilingual := read(types.SubtitleTaskBilingualSrtFileName)
	short := read(types.SubtitleTaskShortOriginMixedSrtFileName)
	if len(origin) != len(target) || len(origin) != len(bilingual) {
		t.Fatal("普通字幕三类产物条数不一致")
	}
	var source strings.Builder
	limit := 50
	if value := os.Getenv("KRILLINAI_SUBTITLE_AUDIT_LIMIT"); value != "" {
		var err error
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 {
			t.Fatal("KRILLINAI_SUBTITLE_AUDIT_LIMIT 必须为正整数")
		}
	}
	maxChars, maxSourceChars, totalChars, maxRunes := 0, 0, 0, 0
	spans, err := subtitleWordTimingSpans(words, rawSource.String())
	if err != nil {
		t.Fatal(err)
	}
	sourcePosition := 0
	var previousEnd int64
	for i, block := range origin {
		source.WriteString(block.OriginLanguageSentence)
		translation := target[i].OriginLanguageSentence
		size := subtitleTargetLength(translation)
		sourceSize := subtitleTargetLength(block.OriginLanguageSentence)
		if size > limit || sourceSize > limit || !hasSubtitleContent(translation) || !hasSubtitleContent(block.OriginLanguageSentence) || hasSubtitleLineBreak(translation) || hasSubtitleLineBreak(block.OriginLanguageSentence) {
			t.Fatalf("普通字幕第%d条原文或译文无效，或超出%d显示单位: source=%d target=%d", i+1, limit, sourceSize, size)
		}
		if block.Timestamp != target[i].Timestamp || block.Timestamp != bilingual[i].Timestamp || bilingual[i].OriginLanguageSentence != translation || bilingual[i].TargetLanguageSentence != block.OriginLanguageSentence {
			t.Fatalf("普通字幕第%d条双语配对或时间不一致", i+1)
		}
		start, end, _ := parseSRTTimeline(block.Timestamp)
		if start < previousEnd {
			t.Fatalf("普通字幕第%d条时间重叠", i+1)
		}
		nextPosition := sourcePosition + utf8.RuneCountInString(compactSubtitleText(block.OriginLanguageSentence))
		if start != subtitlePositionTime(spans, sourcePosition, false) || end != subtitlePositionTime(spans, nextPosition, true) {
			t.Fatalf("普通字幕第%d条时间与原文词位置不一致", i+1)
		}
		sourcePosition = nextPosition
		previousEnd = end
		maxChars = max(maxChars, size)
		maxSourceChars = max(maxSourceChars, sourceSize)
		maxRunes = max(maxRunes, utf8.RuneCountInString(translation))
		totalChars += size
	}
	if compactSubtitleText(source.String()) != compactSubtitleText(rawSource.String()) {
		t.Fatal("全片原文存在遗漏、重复或改写")
	}
	sentences := svc.splitByPrimarySentencePunctuation(words)
	position, unchanged, split := 0, 0, 0
	for _, sentence := range sentences {
		expected := compactSubtitleText(sentence.Text)
		var joined strings.Builder
		segments := 0
		var sourceSegments, targetSegments []string
		for joined.String() != expected {
			if position >= len(origin) {
				t.Fatalf("原句没有对应字幕: %s", sentence.Text)
			}
			joined.WriteString(compactSubtitleText(origin[position].OriginLanguageSentence))
			if !strings.HasPrefix(expected, joined.String()) {
				t.Fatalf("字幕跨句或原文错序: %s", sentence.Text)
			}
			sourceSegments = append(sourceSegments, origin[position].OriginLanguageSentence)
			targetSegments = append(targetSegments, target[position].OriginLanguageSentence)
			position++
			segments++
		}
		if segments == 1 {
			unchanged++
		} else {
			split++
		}
		if !subtitleSegmentsHaveSafeBoundaries(sourceSegments) || !subtitleSegmentsHaveSafeBoundaries(targetSegments) {
			t.Fatalf("原句的字幕分段破坏字素簇: %s", sentence.Text)
		}
	}
	shortPosition, shortSourceCount, shortMaxChars := 0, 0, 0
	var shortPreviousEnd int64
	for i, block := range origin {
		if shortPosition >= len(short) || short[shortPosition].OriginLanguageSentence != target[i].OriginLanguageSentence || short[shortPosition].Timestamp != block.Timestamp {
			t.Fatalf("短字幕第%d组缺少完整译文或改变了译文时间", i+1)
		}
		shortPosition++
		expected := compactSubtitleText(block.OriginLanguageSentence)
		var joined strings.Builder
		blockStart, blockEnd, _ := parseSRTTimeline(block.Timestamp)
		for joined.String() != expected {
			if shortPosition >= len(short) {
				t.Fatalf("短字幕第%d组原文不完整", i+1)
			}
			cue := short[shortPosition]
			if !hasSubtitleContent(cue.OriginLanguageSentence) || hasSubtitleLineBreak(cue.OriginLanguageSentence) {
				t.Fatalf("短字幕第%d条为空或存在语言内部换行", shortPosition+1)
			}
			joined.WriteString(compactSubtitleText(cue.OriginLanguageSentence))
			start, end, _ := parseSRTTimeline(cue.Timestamp)
			if !strings.HasPrefix(expected, joined.String()) || start < shortPreviousEnd || start < blockStart-20 || end > blockEnd+20 {
				t.Fatalf("短字幕第%d组原文错序或词时间无效: %+v", i+1, cue)
			}
			shortPreviousEnd = end
			shortMaxChars = max(shortMaxChars, utf8.RuneCountInString(cue.OriginLanguageSentence))
			shortSourceCount++
			shortPosition++
		}
	}
	if position != len(origin) || shortPosition != len(short) {
		t.Fatal("字幕末尾有额外内容")
	}
	report := map[string]any{
		"检查通过": true, "原始单词数": len(words), "原始句子数": len(sentences),
		"普通字幕条数": len(origin), "保留完整原句数": unchanged, "拆分原句数": split,
		"普通字幕长度规则":     "宽字素簇计2，其余基础字素簇计1；原文和译文使用同一上限",
		"普通字幕双侧显示单位上限": limit, "普通原文最大加权字符数": maxSourceChars,
		"普通译文最大加权字符数": maxChars, "普通译文平均加权字符数": float64(totalChars) / float64(len(origin)), "普通译文最大Unicode字符数": maxRunes,
		"短字幕总条数": len(short), "短字幕完整译文条数": len(target), "短字幕原文条数": shortSourceCount,
		"短字幕原文最大字符数": shortMaxChars, "短字幕说明": "按词及字素边界拆分原文并保留标点，复用词级时间；译文保留完整配对片段",
		"全片原文完整覆盖": true, "普通字幕三类配对一致": true, "短字幕两种语言均完整": true, "词级时间映射一致": true,
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "subtitle_audit.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	t.Log(string(data))
}

func TestTask792FailedBatchRetryLive(t *testing.T) {
	configPath := os.Getenv("KRILLINAI_TRANSLATION_CONFIG")
	output := os.Getenv("KRILLINAI_TRANSLATION_OUTPUT")
	if configPath == "" || output == "" {
		t.Skip("指定真实配置及独立输出目录后复测792失败批次")
	}
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	if _, err := toml.DecodeFile(configPath, &config.Conf); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(output, 0755); err != nil {
		t.Fatal(err)
	}
	texts := []string{
		"So, let me give you a model that I teach my movement maker clients.",
		"Make a list of 50 people who could each be worth six or seven figures to your business.",
		"Not customers, connectors, people who already have the audience or the network that you really want to reach.",
	}
	cases := [][]string{texts, {
		"They found out that a lab with billions of dollars of computers was short on cardiologist and then they went and they hired them for that.",
		"The experts get paid 75 to 150 bucks an hour, which is real money for a few hours a week on top of a existing day job.",
		"A radiologist reads scans all day long, then spends three evenings a month telling an LLM where it got a scan wrong.",
	}}
	for caseIndex, texts := range cases {
		for round := range 3 {
			translator := NewTranslator()
			result, err := translator.translatePairedSentences(context.Background(), texts, "en", "zh_cn", subtitleTargetLimit(), 3, nil)
			if err != nil {
				t.Fatalf("第%d轮失败: %v", round+1, err)
			}
			data, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(output, fmt.Sprintf("failed-batch-%d-round-%d.json", caseIndex+1, round+1)), data, 0600); err != nil {
				t.Fatal(err)
			}
			t.Logf("第%d轮原译配对、原文覆盖和50加权长度检查通过", round+1)
		}
	}
}

func TestTask792WordPairedLive(t *testing.T) {
	configPath, vttPath, output := os.Getenv("KRILLINAI_TRANSLATION_CONFIG"), os.Getenv("KRILLINAI_TASK792_VTT"), os.Getenv("KRILLINAI_TRANSLATION_OUTPUT")
	if configPath == "" || vttPath == "" || output == "" {
		t.Skip("指定真实配置、任务792的VTT和独立输出目录后运行")
	}
	testWordPairedLive(t, configPath, vttPath, output, []string{"We might have AI", "YouTube just threw", "heartpounding"})
}

func TestFailedTasks20261015WordPairedLive(t *testing.T) {
	configPath, taskRoot, output := os.Getenv("KRILLINAI_TRANSLATION_CONFIG"), os.Getenv("KRILLINAI_FAILED_TASKS_ROOT"), os.Getenv("KRILLINAI_TRANSLATION_OUTPUT")
	if configPath == "" || taskRoot == "" || output == "" {
		t.Skip("指定真实配置、失败任务根目录和独立输出目录后运行")
	}
	for _, sample := range []struct {
		id, directory, vtt string
		phrases            []string
	}{
		{"800", "watch_vHo5JdXgp_Gwjh", "Ho5JdXgpnkA.en-orig.vtt", []string{"Those are skills", "here's roughly"}},
		{"803", "watch_v2g3xb7PK_dJZa", "2g3xb7PKcXs.en-orig.vtt", []string{"This is exactly what", "Robert Green addresses", "The envious person knows"}},
		{"792", "watch_vFzet_OPh_Joh2", "Fzet_OPhZMk.en-orig.vtt", []string{"YouTube just threw"}},
	} {
		t.Run(sample.id, func(t *testing.T) {
			testWordPairedLive(t, configPath, filepath.Join(taskRoot, sample.directory, sample.vtt), filepath.Join(output, "task-"+sample.id), sample.phrases)
		})
	}
}

func testWordPairedLive(t *testing.T, configPath, vttPath, output string, phrases []string) {
	t.Helper()
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	if _, err := toml.DecodeFile(configPath, &config.Conf); err != nil {
		t.Fatal(err)
	}
	svc := &YouTubeSubtitleService{translator: NewTranslator()}
	words, err := svc.ExtractWordsFromVtt(vttPath)
	if err != nil {
		t.Fatal(err)
	}
	sentences := svc.splitByPrimarySentencePunctuation(words)
	calls := 0
	completer := svc.translator.chatCompleter
	svc.translator.chatCompleter = translationCompleterFunc(func(prompt string) (string, error) { calls++; return completer.ChatCompletion(prompt) })
	for _, phrase := range phrases {
		t.Run(phrase, func(t *testing.T) {
			index := -1
			for i, sentence := range sentences {
				if strings.Contains(sentence.Text, phrase) {
					index = i
					break
				}
			}
			if index < 0 {
				t.Fatalf("原始VTT没有找到问题句: %s", phrase)
			}
			selected := sentences[index : index+1]
			if phrase == "heartpounding" {
				selected = sentences[index:min(index+3, len(sentences))]
			}
			dir := filepath.Join(output, fmt.Sprintf("word-%d", index))
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			var selectedWords []VttWord
			for _, sentence := range selected {
				selectedWords = append(selectedWords, sentence.Words...)
			}
			originPath := filepath.Join(dir, "origin_language_srt.srt")
			source, err := svc.generateOriginLanguageSrt(selected, originPath, &YoutubeSubtitleReq{})
			if err != nil {
				t.Fatal(err)
			}
			blocks, err := svc.translator.BatchTranslateSrtBlocks(context.Background(), source, "en", "zh_cn", nil, selectedWords)
			if err != nil {
				t.Fatal(err)
			}
			assertPairedOutput(t, source, blocks, subtitleTargetLimit())
			if err := svc.validateYouTubeSubtitleBlocks(blocks, true); err != nil {
				t.Fatal(err)
			}
			if err := svc.writeOriginLanguageSrtFile(blocks, originPath); err != nil {
				t.Fatal(err)
			}
			if err := svc.writeTargetLanguageSrtFile(blocks, filepath.Join(dir, "target_language_srt.srt")); err != nil {
				t.Fatal(err)
			}
			if err := svc.writeBilingualSrtFile(blocks, filepath.Join(dir, "bilingual_srt.srt"), true); err != nil {
				t.Fatal(err)
			}
			if err := svc.writeShortSubtitleFile(blocks, selected, filepath.Join(dir, "short_origin_mixed.srt"), true); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"origin_language_srt.srt", "target_language_srt.srt", "bilingual_srt.srt"} {
				parsed, err := util.ParseSrtFile(filepath.Join(dir, name))
				if err != nil || len(parsed) != len(blocks) {
					t.Fatalf("产物配对数量不一致 %s: %v", name, err)
				}
				for i := range parsed {
					if parsed[i].Timestamp != blocks[i].Timestamp {
						t.Fatalf("产物时间轴不一致: %s", name)
					}
				}
			}
			short, err := util.ParseSrtFile(filepath.Join(dir, "short_origin_mixed.srt"))
			if err != nil || len(short) < len(blocks)*2 {
				t.Fatalf("短字幕未独立导出完整双轨: %v", err)
			}
			for _, block := range blocks {
				t.Logf("%s | %s | %s", block.Timestamp, block.OriginLanguageSentence, block.TargetLanguageSentence)
			}
		})
	}
	t.Logf("真实VTT问题句%d处，模型调用%d次", len(phrases), calls)
}
