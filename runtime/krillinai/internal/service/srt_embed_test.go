package service

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
)

func TestSplitChineseTextDoesNotBreakCommonWords(t *testing.T) {
	got := splitChineseText("你花在刷屏上的每一小时", 10)
	joined := strings.Join(got, "\n")
	if strings.Contains(joined, "小\n时") {
		t.Fatalf("splitChineseText broke 小时: %q", joined)
	}
	if strings.Contains(joined, "每一小\n时") {
		t.Fatalf("splitChineseText broke 每一小时: %q", joined)
	}
}

func TestSplitChineseTextAvoidsShortTrailingLine(t *testing.T) {
	got := splitChineseText("你每小时花在划屏上的时间", 10)
	joined := strings.Join(got, "\n")
	if strings.HasSuffix(joined, "\n时间") {
		t.Fatalf("splitChineseText created a short trailing line: %q", joined)
	}
	if len(got) != 2 {
		t.Fatalf("line count = %d, want 2; lines = %#v", len(got), got)
	}
}

func TestSplitChineseTextBalancesDisplayWidth(t *testing.T) {
	got := splitChineseText("你花在刷屏上的每一小时都会从未来的自己那里借走注意力", 10)
	if len(got) < 2 {
		t.Fatalf("line count = %d, want at least 2; lines = %#v", len(got), got)
	}

	firstWidth := subtitleDisplayWidth(got[0])
	secondWidth := subtitleDisplayWidth(got[1])
	if math.Abs(float64(firstWidth-secondWidth)) > 6 {
		t.Fatalf("line widths are not balanced: lines=%#v widths=%d,%d", got, firstWidth, secondWidth)
	}
}

func TestVerticalAssKeepsChineseLineInSingleDialogueWithLineBreak(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "short.srt")
	out := filepath.Join(dir, "short.ass")
	content := "1\n00:00:28,600 --> 00:00:30,190\n大多数人看完这个视频后什么也不会做。\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	err := srtToAss(in, out, false, &types.SubtitleTaskStepParam{TaskBasePath: dir})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if count := strings.Count(ass, "Dialogue:"); count != 1 {
		t.Fatalf("Dialogue count = %d, want 1; ass = %s", count, ass)
	}
	if strings.Contains(ass, `\N`) {
		t.Fatalf("moderate vertical Chinese subtitle should stay on one line: %s", ass)
	}
}

func TestVerticalAssKeepsBothLinesFromBilingualSRT(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "bilingual.srt")
	out := filepath.Join(dir, "bilingual.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n这是中文字幕\nThis is the English subtitle\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	err := srtToAss(in, out, false, &types.SubtitleTaskStepParam{TaskBasePath: dir})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if !strings.Contains(ass, "{\\rMajor}{\\an2}这是中文字幕") {
		t.Fatalf("vertical bilingual SRT should keep first line as Major: %s", ass)
	}
	if !strings.Contains(ass, "{\\rMinor}{\\an2}This is the English subtitle") {
		t.Fatalf("vertical bilingual SRT should keep second line as Minor: %s", ass)
	}
}

func TestHorizontalAssKeepsSingleLineSubtitle(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "single-line.srt")
	out := filepath.Join(dir, "single-line.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n我认为学习速记是一项技能\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{TaskBasePath: dir})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if count := strings.Count(ass, "Dialogue:"); count != 1 {
		t.Fatalf("Dialogue count = %d, want 1; ass = %s", count, ass)
	}
	if !strings.Contains(ass, "{\\rMajor}{\\an2}我认为学习速记是一项技能") {
		t.Fatalf("single-line subtitle was not written as Major dialogue: %s", ass)
	}
	if strings.Contains(ass, "{\\rMinor}") {
		t.Fatalf("single-line subtitle should not include Minor style: %s", ass)
	}
}

func TestHorizontalAssUsesCustomSubtitleStyle(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "subtitle.srt")
	out := filepath.Join(dir, "subtitle.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n主字幕\n副字幕\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	fontSize := 22
	marginV := 44
	outline := 4.0
	fadeIn := 120
	fadeOut := 180
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontSize = &fontSize
	style.Horizontal.Major.PrimaryColor = "#FFFFFF"
	style.Horizontal.Major.MarginV = &marginV
	style.Horizontal.Major.Outline = &outline
	style.Horizontal.Major.FadeInMS = &fadeIn
	style.Horizontal.Major.FadeOutMS = &fadeOut
	style.Horizontal.Major.OverrideTags = `\blur1`

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
	})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if !strings.Contains(ass, "Style: Major,Arial,22,&H00FFFFFF") {
		t.Fatalf("custom Major style missing:\n%s", ass)
	}
	if !strings.Contains(ass, ",4,1.5,2,10,10,44,1") {
		t.Fatalf("custom outline/margin missing:\n%s", ass)
	}
	if !strings.Contains(ass, `{\rMajor}{\an2}{\fad(120,180)\blur1}主字幕`) {
		t.Fatalf("custom dialogue tags missing:\n%s", ass)
	}
}

func TestHorizontalAssKeepsLargeFontChineseSubtitleSingleLine(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "large-chinese.srt")
	out := filepath.Join(dir, "large-chinese.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n这是一段字号很大的中文字幕如果不自动换行就会超出屏幕之外影响观看体验\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	fontSize := 80
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontSize = &fontSize

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
	})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if strings.Contains(ass, `\N`) || !strings.Contains(ass, "WrapStyle: 2") {
		t.Fatalf("large-font Chinese subtitle must remain a single line: %s", ass)
	}
}

func TestAssBilingualNeverWrapsEitherLanguage(t *testing.T) {
	for _, horizontal := range []bool{true, false} {
		for _, target := range []string{strings.Repeat("中文字幕", 15), strings.Repeat("한국어 자막 ", 12), strings.Repeat("हिन्दी उपशीर्षक ", 10)} {
			dir := t.TempDir()
			in, out := filepath.Join(dir, "bilingual.srt"), filepath.Join(dir, "bilingual.ass")
			source := "In The Artist's Way, Julia Cameron suggests three pages of stream of consciousness writing every single morning."
			if err := os.WriteFile(in, []byte("1\n00:00:01,000 --> 00:00:09,000\n"+target+"\n"+source+"\n\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := srtToAss(in, out, horizontal, &types.SubtitleTaskStepParam{RenderWidth: 360, RenderHeight: 640}); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(out)
			if err != nil {
				t.Fatal(err)
			}
			ass := string(data)
			if strings.Count(ass, "Dialogue:") != 1 || strings.Count(ass, `\N`) != 1 || !strings.Contains(ass, "WrapStyle: 2") || !strings.Contains(ass, strings.TrimSuffix(source, ".")) {
				t.Fatalf("bilingual rendering must keep exactly one line per language: %s", ass)
			}
		}
	}
}

func TestHorizontalAssKeepsChineseSubtitleSingleLine(t *testing.T) {
	text := "只是想让你知道你走在正确的道路上"
	got := wrapSubtitleForASS(text, subtitlestyle.Style{}, &types.SubtitleTaskStepParam{RenderWidth: 720, RenderHeight: 1280})
	if len(got) != 1 || got[0] != text {
		t.Fatalf("single-language subtitle was wrapped: %#v", got)
	}
}

func TestHorizontalAssWrapsChineseAtWordBoundaries(t *testing.T) {
	fontSize := 26
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontSize = &fontSize

	got := wrapSubtitleForASS("很多克服糟糕的日子和重新开始", style.Horizontal.Major, &types.SubtitleTaskStepParam{
		RenderWidth:  1920,
		RenderHeight: 1080,
	})
	joined := strings.Join(got, "\n")
	if strings.Contains(joined, "糟\n糕") {
		t.Fatalf("Chinese subtitle should not break inside the word 糟糕: lines=%#v", got)
	}
}

func TestHorizontalAssDoesNotInsertEnglishLineBreaks(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "large-english.srt")
	out := filepath.Join(dir, "large-english.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\nThis large subtitle should wrap at natural word boundaries before it runs beyond the edge of the video frame\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	fontSize := 58
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontSize = &fontSize

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
	})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if strings.Contains(ass, `\N`) {
		t.Fatalf("English subtitle should rely on ASS/libass wrapping, not manual line breaks: %s", ass)
	}
}

func TestHorizontalAssDoesNotSplitLongEnglishToken(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "long-token.srt")
	out := filepath.Join(dir, "long-token.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\nDonaudampfschifffahrtsgesellschaftskapitaensmuetzeDonaudampfschifffahrtsgesellschaftskapitaensmuetze\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	fontSize := 46
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontSize = &fontSize

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
	})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if strings.Contains(ass, `\N`) {
		t.Fatalf("long English token should rely on ASS/libass wrapping, not manual line breaks: %s", ass)
	}
}

func TestHorizontalAssKeepsSingleLineAtNarrowRenderWidth(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "narrow-chinese.srt")
	out := filepath.Join(dir, "narrow-chinese.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n这段字幕需要适配窄屏\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	fontSize := 22
	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.FontSize = &fontSize

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
		RenderWidth:   720,
		RenderHeight:  1280,
	})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if strings.Contains(ass, `\N`) || !strings.Contains(ass, "WrapStyle: 2") {
		t.Fatalf("narrow rendering must not wrap subtitles: %s", ass)
	}
}

func TestVerticalEnglishTranslationUsesMajorStyle(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "subtitle.srt")
	out := filepath.Join(dir, "subtitle.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\nEnglish subtitle\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	fontSize := 11
	style := subtitlestyle.DefaultStyleSet()
	style.Vertical.Major.FontSize = &fontSize
	style.Vertical.Major.PrimaryColor = "#00FF00"

	err := srtToAss(in, out, false, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
	})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if !strings.Contains(ass, "Style: Major,Arial,11,&H0000FF00") || !strings.Contains(ass, `{\rMajor}{\an2}English subtitle`) {
		t.Fatalf("English translation did not use the primary style:\n%s", ass)
	}
}

func TestBilingualTranslationOnBottomKeepsSemanticStylesAndShadow(t *testing.T) {
	for _, horizontal := range []bool{true, false} {
		t.Run(fmt.Sprint(horizontal), func(t *testing.T) {
			dir := t.TempDir()
			in, out := filepath.Join(dir, "subtitle.srt"), filepath.Join(dir, "subtitle.ass")
			if err := os.WriteFile(in, []byte("1\n00:00:00,000 --> 00:00:01,000\nSource\nTranslation\n\n"), 0644); err != nil {
				t.Fatal(err)
			}
			style := subtitlestyle.DefaultStyleSet()
			style.Horizontal.Major.OverrideTags = `\xshad-4\yshad6\blur2.5`
			style.Vertical.Major.OverrideTags = style.Horizontal.Major.OverrideTags
			if err := srtToAss(in, out, horizontal, &types.SubtitleTaskStepParam{SubtitleStyle: style, SubtitleResultType: types.SubtitleResultTypeBilingualTranslationOnBottom}); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(out)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(data), `{\rMinor}{\an2}Source\N{\rMajor}{\an2}{\xshad-4\yshad6\blur2.5}Translation`) {
				t.Fatalf("subtitle roles or shadow reset order are wrong: %s", data)
			}
		})
	}
}

func TestSrtToAssRejectsInvalidSubtitleStyle(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "subtitle.srt")
	out := filepath.Join(dir, "subtitle.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n主字幕\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	style := subtitlestyle.DefaultStyleSet()
	style.Horizontal.Major.PrimaryColor = "not-a-color"

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{
		TaskBasePath:  dir,
		SubtitleStyle: style,
	})
	if err == nil {
		t.Fatal("srtToAss() error = nil, want invalid subtitle style error")
	}
	if !strings.Contains(err.Error(), "subtitle style") && !strings.Contains(err.Error(), "horizontal.major.primary_color") {
		t.Fatalf("srtToAss() error = %q, want subtitle style context", err.Error())
	}
}

func TestSrtToAssDefaultHeaderUsesStyleDefaults(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "subtitle.srt")
	out := filepath.Join(dir, "subtitle.ass")
	content := "1\n00:00:00,840 --> 00:00:02,900\n主字幕\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	err := srtToAss(in, out, true, &types.SubtitleTaskStepParam{TaskBasePath: dir})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if !strings.Contains(ass, "Style: Major,Arial,14,&H0000BFFF") {
		t.Fatalf("default Major style missing:\n%s", ass)
	}
}

func subtitleDisplayWidth(text string) int {
	width := 0
	for _, r := range text {
		if r >= '\u4e00' && r <= '\u9fff' {
			width += 2
		} else {
			width++
		}
	}
	return width
}

func TestVerticalAssSplitsLongChineseAcrossTime(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "short.srt")
	out := filepath.Join(dir, "short.ass")
	content := "1\n00:00:28,600 --> 00:00:30,190\n你花在刷屏上的每一小时都会从未来的自己那里借走注意力。\n\n"
	if err := os.WriteFile(in, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	err := srtToAss(in, out, false, &types.SubtitleTaskStepParam{TaskBasePath: dir})
	if err != nil {
		t.Fatalf("srtToAss() error = %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	ass := string(data)
	if count := strings.Count(ass, "Dialogue:"); count < 2 {
		t.Fatalf("Dialogue count = %d, want at least 2 for time-sliced Chinese lines; ass = %s", count, ass)
	}
	if strings.Contains(ass, `\N`) {
		t.Fatalf("long vertical Chinese subtitle should be split across time, not stacked with line breaks: %s", ass)
	}
}
