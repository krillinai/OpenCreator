package service

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"krillin-ai/internal/storage"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/clipperhouse/uax29/v2/graphemes"
	"github.com/go-ego/gse"
	"go.uber.org/zap"
)

var (
	chineseSegmenterOnce sync.Once
	chineseSegmenter     gse.Segmenter
	chineseSegmenterErr  error
)

const (
	verticalChineseMaxRunesPerLine = 18
	assDefaultPlayResX             = 384
	assDefaultPlayResY             = 288
	subtitleWrapSafetyRatio        = 0.92
)

func (s Service) embedSubtitles(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	var err error
	if stepParam.EmbedSubtitleVideoType == "horizontal" || stepParam.EmbedSubtitleVideoType == "vertical" || stepParam.EmbedSubtitleVideoType == "all" {
		var width, height int
		width, height, err = getResolution(stepParam.InputVideoPath)
		if err != nil {
			log.GetLogger().Error("embedSubtitles getResolution error", zap.Any("step param", stepParam), zap.Error(err))
			return fmt.Errorf("embedSubtitles getResolution error: %w", err)
		}

		// 横屏可以合成竖屏的，但竖屏暂时不支持合成横屏的
		if stepParam.EmbedSubtitleVideoType == "horizontal" || stepParam.EmbedSubtitleVideoType == "all" {
			if width < height {
				log.GetLogger().Info("检测到输入视频是竖屏，无法合成横屏视频，跳过")
				return nil
			}
			log.GetLogger().Info("合成视频：横屏")
			err = embedSubtitles(stepParam, true, stepParam.EnableTts)
			if err != nil {
				log.GetLogger().Error("embedSubtitles embedSubtitles error", zap.Any("step param", stepParam), zap.Error(err))
				return fmt.Errorf("embedSubtitles embedSubtitles error: %w", err)
			}
		}
		if stepParam.EmbedSubtitleVideoType == "vertical" || stepParam.EmbedSubtitleVideoType == "all" {
			if width > height {
				// 生成竖屏视频
				transferredVerticalVideoPath := filepath.Join(stepParam.TaskBasePath, types.SubtitleTaskTransferredVerticalVideoFileName)
				err = convertToVertical(stepParam.InputVideoPath, transferredVerticalVideoPath, stepParam.VerticalVideoMajorTitle, stepParam.VerticalVideoMinorTitle)
				if err != nil {
					log.GetLogger().Error("embedSubtitles convertToVertical error", zap.Any("step param", stepParam), zap.Error(err))
					return fmt.Errorf("embedSubtitles convertToVertical error: %w", err)
				}
				stepParam.InputVideoPath = transferredVerticalVideoPath
			}
			log.GetLogger().Info("合成视频：竖屏")
			err = embedSubtitles(stepParam, false, stepParam.EnableTts)
			if err != nil {
				log.GetLogger().Error("embedSubtitles embedSubtitles error", zap.Any("step param", stepParam), zap.Error(err))
				return fmt.Errorf("embedSubtitles embedSubtitles error: %w", err)
			}
		}
		log.GetLogger().Info("字幕嵌入视频成功")
		return nil
	}
	log.GetLogger().Info("合成视频：不合成")
	return nil
}

func splitMajorTextInHorizontal(text string, language types.StandardLanguageCode, maxWordOneLine int) []string {
	// 按语言情况分割
	var (
		segments []string
		sep      string
	)
	if language == types.LanguageNameSimplifiedChinese || language == types.LanguageNameTraditionalChinese ||
		language == types.LanguageNameJapanese || language == types.LanguageNameKorean || language == types.LanguageNameThai {
		segments = regexp.MustCompile(`.`).FindAllString(text, -1)
		sep = ""
	} else {
		segments = strings.Split(text, " ")
		sep = " "
	}

	totalWidth := len(segments)

	// 直接返回原句子
	if totalWidth <= maxWordOneLine {
		return []string{text}
	}

	// 确定拆分点，按2/5和3/5的比例拆分
	line1MaxWidth := int(float64(totalWidth) * 2 / 5)
	currentWidth := 0
	splitIndex := 0

	for i := range segments {
		currentWidth++

		// 当达到 2/5 宽度时，设置拆分点
		if currentWidth >= line1MaxWidth {
			splitIndex = i + 1
			break
		}
	}

	// 分割文本，保留原有句子格式

	line1 := util.CleanPunction(strings.Join(segments[:splitIndex], sep))
	line2 := util.CleanPunction(strings.Join(segments[splitIndex:], sep))

	return []string{line1, line2}
}

func splitChineseText(text string, maxWordLine int) []string {
	text = util.CleanPunction(strings.TrimSpace(text))
	if text == "" {
		return nil
	}
	maxWidthPerLine := maxWordLine * 2
	if maxWordLine <= 0 || subtitleTextDisplayWidth(text) <= maxWidthPerLine {
		return []string{text}
	}
	if tokens := segmentChineseText(text); len(tokens) > 0 {
		return splitChineseTokens(tokens, maxWordLine)
	}
	return splitChineseTextByRune([]rune(text), maxWordLine)
}

func splitChineseTextByRune(runes []rune, maxWordLine int) []string {
	tokens := make([]string, 0, len(runes))
	iter := graphemes.FromString(string(runes))
	for iter.Next() {
		tokens = append(tokens, iter.Value())
	}
	return splitChineseSegmentsByDisplayWidth(tokens, maxWordLine)
}

func segmentChineseText(text string) []string {
	chineseSegmenterOnce.Do(func() {
		chineseSegmenter, chineseSegmenterErr = gse.NewEmbed("zh")
	})
	if chineseSegmenterErr != nil {
		log.GetLogger().Warn("中文分词器初始化失败，回退到字符断句", zap.Error(chineseSegmenterErr))
		return nil
	}
	return normalizeChineseTokens(chineseSegmenter.Cut(text, true))
}

func normalizeChineseTokens(tokens []string) []string {
	result := make([]string, 0, len(tokens))
	for _, token := range tokens {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		result = append(result, token)
	}
	return result
}

func splitChineseTokens(tokens []string, maxWordLine int) []string {
	return splitChineseSegmentsByDisplayWidth(tokens, maxWordLine)
}

func splitChineseSegmentsByDisplayWidth(segments []string, maxWordLine int) []string {
	maxWidthPerLine := maxWordLine * 2
	totalWidth := 0
	for _, segment := range segments {
		totalWidth += subtitleTextDisplayWidth(segment)
	}
	if totalWidth <= maxWidthPerLine {
		return []string{util.CleanPunction(strings.Join(segments, ""))}
	}

	numLines := int(math.Ceil(float64(totalWidth) / float64(maxWidthPerLine)))
	if numLines < 1 {
		numLines = 1
	}
	widthPerLine := totalWidth / numLines
	if widthPerLine < 1 {
		widthPerLine = maxWidthPerLine
	}

	var lines []string
	var current strings.Builder
	currentWidth := 0

	for _, segment := range segments {
		segmentWidth := subtitleTextDisplayWidth(segment)
		if !isTrailingSubtitlePunctuation(segment) &&
			currentWidth > 0 &&
			currentWidth+segmentWidth > widthPerLine &&
			len(lines) < numLines-1 {
			lines = append(lines, util.CleanPunction(current.String()))
			current.Reset()
			currentWidth = 0
		}
		current.WriteString(segment)
		currentWidth += segmentWidth
	}

	if current.Len() > 0 {
		lines = append(lines, util.CleanPunction(current.String()))
	}
	return rebalanceShortChineseTrailingLine(lines)
}

func subtitleTextDisplayWidth(text string) int {
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

type subtitleWrapConfig struct {
	maxLineWidth float64
	fontSize     float64
	scaleX       float64
	spacing      float64
}

func newSubtitleWrapConfig(style subtitlestyle.Style, stepParam *types.SubtitleTaskStepParam) subtitleWrapConfig {
	width := assDefaultPlayResX
	if stepParam != nil && stepParam.RenderWidth > 0 && stepParam.RenderHeight > 0 {
		scale := math.Min(float64(assDefaultPlayResX)/float64(stepParam.RenderWidth), float64(assDefaultPlayResY)/float64(stepParam.RenderHeight))
		width = int(math.Floor(float64(stepParam.RenderWidth) * scale))
		if width < 1 {
			width = assDefaultPlayResX
		}
	}

	fontSize := float64(styleIntValue(style.FontSize, 14))
	marginL := float64(styleIntValue(style.MarginL, 10))
	marginR := float64(styleIntValue(style.MarginR, 10))
	maxLineWidth := (float64(width) - marginL - marginR) * subtitleWrapSafetyRatio
	if maxLineWidth < fontSize {
		maxLineWidth = fontSize
	}

	return subtitleWrapConfig{
		maxLineWidth: maxLineWidth,
		fontSize:     fontSize,
		scaleX:       float64(styleIntValue(style.ScaleX, 100)) / 100,
		spacing:      styleFloatValue(style.Spacing, 0),
	}
}

func styleIntValue(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func styleFloatValue(value *float64, fallback float64) float64 {
	if value == nil {
		return fallback
	}
	return *value
}

func wrapSubtitleForASS(text string, style subtitlestyle.Style, stepParam *types.SubtitleTaskStepParam) []string {
	text = util.CleanPunction(strings.TrimSpace(text))
	if text == "" {
		return nil
	}
	// 双语每种语言只显示一行；超长内容应在翻译分段时拆成独立时间段。
	return []string{text}
}

func wrapUnicodeSubtitle(text string, config subtitleWrapConfig) []string {
	parts, err := splitSubtitleText(text, func(part string) bool { return estimateSubtitleTextWidth(part, config) <= config.maxLineWidth })
	if err != nil {
		return []string{text}
	} // Never break an oversized grapheme cluster.
	return parts
}

func wrapVerticalChineseSubtitleForASS(text string, style subtitlestyle.Style, stepParam *types.SubtitleTaskStepParam) []string {
	config := newSubtitleWrapConfig(style, stepParam)
	legacyMaxWidth := config.fontSize * float64(verticalChineseMaxRunesPerLine)
	if legacyMaxWidth > 0 && legacyMaxWidth < config.maxLineWidth {
		config.maxLineWidth = legacyMaxWidth
	}
	text = util.CleanPunction(strings.TrimSpace(text))
	if text == "" {
		return nil
	}
	if estimateSubtitleTextWidth(text, config) <= config.maxLineWidth {
		return []string{text}
	}
	return wrapCJKSubtitle(text, config)
}

func joinASSLines(lines []string) string {
	return strings.Join(lines, `\N`)
}

func wrapCJKSubtitle(text string, config subtitleWrapConfig) []string {
	tokens := []string{}
	if containsChinese(text) {
		tokens = segmentChineseText(text)
	}
	if len(tokens) > 0 && !subtitleSegmentsHaveSafeBoundaries(tokens) {
		return wrapUnicodeSubtitle(text, config)
	}
	if len(tokens) == 0 {
		iter := graphemes.FromString(text)
		for iter.Next() {
			tokens = append(tokens, iter.Value())
		}
	}

	var lines []string
	var current strings.Builder
	currentWidth := 0.0
	for _, token := range tokens {
		tokenWidth := estimateSubtitleTextWidth(token, config)
		if tokenWidth > config.maxLineWidth {
			if current.Len() > 0 {
				lines = append(lines, util.CleanPunction(current.String()))
				current.Reset()
				currentWidth = 0
			}
			chunks := wrapCJKRunesByWidth(token, config)
			if len(chunks) == 0 {
				continue
			}
			if len(chunks) > 1 {
				lines = append(lines, chunks[:len(chunks)-1]...)
			}
			lastChunk := chunks[len(chunks)-1]
			current.WriteString(lastChunk)
			currentWidth = estimateSubtitleTextWidth(lastChunk, config)
			continue
		}
		if !isTrailingSubtitlePunctuation(token) &&
			current.Len() > 0 &&
			currentWidth+tokenWidth > config.maxLineWidth {
			lines = append(lines, util.CleanPunction(current.String()))
			current.Reset()
			currentWidth = 0
		}
		current.WriteString(token)
		currentWidth += tokenWidth
	}
	if current.Len() > 0 {
		lines = append(lines, util.CleanPunction(current.String()))
	}
	return balanceChineseSubtitleLines(lines, tokens)
}

func balanceChineseSubtitleLines(lines []string, tokens []string) []string {
	lines = rebalanceShortChineseTrailingLine(lines)
	if len(lines) != 2 {
		return lines
	}
	if subtitleTextDisplayWidth(lines[0]) < subtitleTextDisplayWidth(lines[1]) {
		return lines
	}
	if len(tokens) < 2 {
		return lines
	}
	targetFirstWidth := subtitleTextDisplayWidth(lines[0]+lines[1]) * 2 / 5
	if targetFirstWidth < 1 {
		targetFirstWidth = 1
	}
	splitAt := bestChineseTokenSplitByDisplayWidth(tokens, targetFirstWidth)
	if splitAt <= 0 || splitAt >= len(tokens) {
		return lines
	}
	balanced := []string{
		util.CleanPunction(strings.Join(tokens[:splitAt], "")),
		util.CleanPunction(strings.Join(tokens[splitAt:], "")),
	}
	if balanced[0] == "" || balanced[1] == "" {
		return lines
	}
	if subtitleTextDisplayWidth(balanced[0]) >= subtitleTextDisplayWidth(balanced[1]) {
		return lines
	}
	return balanced
}

func bestChineseTokenSplitByDisplayWidth(tokens []string, targetWidth int) int {
	best := 1
	bestDiff := math.MaxInt
	currentWidth := 0
	for i, token := range tokens[:len(tokens)-1] {
		currentWidth += subtitleTextDisplayWidth(token)
		diff := int(math.Abs(float64(currentWidth - targetWidth)))
		if isPreferredChineseTokenBreak(token, tokens[i+1]) {
			diff -= 2
		}
		if diff < bestDiff {
			bestDiff = diff
			best = i + 1
		}
	}
	return best
}

func isPreferredChineseTokenBreak(prev, next string) bool {
	prevRunes := []rune(prev)
	nextRunes := []rune(next)
	if len(prevRunes) == 0 || len(nextRunes) == 0 {
		return false
	}
	prevLast := prevRunes[len(prevRunes)-1]
	nextFirst := nextRunes[0]
	if strings.ContainsRune("，。！？；：、,.!?;:", prevLast) {
		return true
	}
	if strings.ContainsRune("的了着过呢吗吧啊呀和与或但而就都也", prevLast) {
		return true
	}
	if strings.ContainsRune("，。！？；：、,.!?;:", nextFirst) {
		return false
	}
	return false
}

func wrapCJKRunesByWidth(text string, config subtitleWrapConfig) []string {
	var lines []string
	var current strings.Builder
	currentWidth := 0.0
	iter := graphemes.FromString(text)
	for iter.Next() {
		part := iter.Value()
		partWidth := estimateSubtitleTextWidth(part, config)
		if current.Len() > 0 && currentWidth+partWidth > config.maxLineWidth {
			lines = append(lines, util.CleanPunction(current.String()))
			current.Reset()
			currentWidth = 0
		}
		current.WriteString(part)
		currentWidth += partWidth
	}
	if current.Len() > 0 {
		lines = append(lines, util.CleanPunction(current.String()))
	}
	if len(lines) == 0 {
		return []string{util.CleanPunction(text)}
	}
	return lines
}

func estimateSubtitleTextWidth(text string, config subtitleWrapConfig) float64 {
	width := 0.0
	runeCount := 0
	for _, r := range text {
		width += subtitleRuneWidth(r, config.fontSize)
		runeCount++
	}
	if runeCount > 1 {
		width += float64(runeCount-1) * config.spacing
	}
	return width * config.scaleX
}

func subtitleRuneWidth(r rune, fontSize float64) float64 {
	switch {
	case unicode.IsSpace(r):
		return fontSize * 0.33
	case isCJKRune(r):
		return fontSize
	case isThaiRune(r):
		return fontSize * 0.92
	case isWideScriptRune(r):
		return fontSize * 0.95
	case r >= 'A' && r <= 'Z':
		return fontSize * 0.66
	case r >= 'a' && r <= 'z':
		return fontSize * 0.56
	case r >= '0' && r <= '9':
		return fontSize * 0.56
	case unicode.IsPunct(r):
		return fontSize * 0.38
	default:
		return fontSize * 0.62
	}
}

func containsCJKOrThai(text string) bool {
	for _, r := range text {
		if isCJKRune(r) || isThaiRune(r) {
			return true
		}
	}
	return false
}

func containsChinese(text string) bool {
	for _, r := range text {
		if r >= '\u4e00' && r <= '\u9fff' {
			return true
		}
	}
	return false
}

func isCJKRune(r rune) bool {
	return (r >= '\u4e00' && r <= '\u9fff') ||
		(r >= '\u3040' && r <= '\u30ff') ||
		(r >= '\u3400' && r <= '\u4dbf') ||
		(r >= '\uac00' && r <= '\ud7af') ||
		(r >= '\uff00' && r <= '\uffef')
}

func isThaiRune(r rune) bool {
	return r >= '\u0e00' && r <= '\u0e7f'
}

func isWideScriptRune(r rune) bool {
	return (r >= '\u0590' && r <= '\u05ff') ||
		(r >= '\u0600' && r <= '\u06ff') ||
		(r >= '\u0900' && r <= '\u097f') ||
		(r >= '\u0980' && r <= '\u09ff') ||
		(r >= '\u0b80' && r <= '\u0bff')
}

func isTrailingSubtitlePunctuation(segment string) bool {
	for _, r := range segment {
		if !strings.ContainsRune("，,.。！？”\"》", r) {
			return false
		}
	}
	return segment != ""
}

func rebalanceShortChineseTrailingLine(lines []string) []string {
	if len(lines) < 2 {
		return lines
	}

	last := []rune(lines[len(lines)-1])
	if len(last) == 0 || len(last) > 3 {
		return lines
	}

	prevIndex := len(lines) - 2
	prev := []rune(lines[prevIndex])
	totalLen := len(prev) + len(last)
	if totalLen < 6 {
		return lines
	}

	combined := append(append([]rune{}, prev...), last...)
	splitAt := bestChineseSplitIndex(combined, totalLen/2)
	lines[prevIndex] = string(combined[:splitAt])
	lines[len(lines)-1] = string(combined[splitAt:])
	return lines
}

func bestChineseSplitIndex(runes []rune, maxWordLine int) int {
	if len(runes) <= maxWordLine {
		return len(runes)
	}
	minSplit := maxWordLine * 3 / 5
	if minSplit < 1 {
		minSplit = 1
	}
	best := maxWordLine
	for i := maxWordLine; i >= minSplit; i-- {
		if isPreferredChineseBreak(runes, i) {
			return i
		}
	}
	for hasAwkwardChineseBreak(runes, best) && best > minSplit {
		best--
	}
	return best
}

func isPreferredChineseBreak(runes []rune, index int) bool {
	if index <= 0 || index >= len(runes) {
		return false
	}
	prev := runes[index-1]
	next := runes[index]
	if strings.ContainsRune("，。！？；：、,.!?;:", prev) {
		return true
	}
	if strings.ContainsRune("的了着过呢吗吧啊呀和与或但而就都也", prev) {
		return true
	}
	if strings.ContainsRune("，。！？；：、,.!?;:", next) {
		return false
	}
	return false
}

func hasAwkwardChineseBreak(runes []rune, index int) bool {
	if index <= 0 || index >= len(runes) {
		return false
	}
	pair := string([]rune{runes[index-1], runes[index]})
	if isProtectedChinesePair(pair) {
		return true
	}
	if index >= 2 {
		triple := string([]rune{runes[index-2], runes[index-1], runes[index]})
		if triple == "每一小" {
			return true
		}
	}
	return false
}

func isProtectedChinesePair(pair string) bool {
	switch pair {
	case "小时", "分钟", "秒钟", "今天", "明天", "自己", "人生", "目标", "规则", "注意", "未来", "屏幕":
		return true
	default:
		return false
	}
}

func parseSrtTime(timeStr string) (time.Duration, error) {
	timeStr = strings.Replace(timeStr, ",", ".", 1)
	parts := strings.Split(timeStr, ":")
	if len(parts) != 3 {
		return 0, fmt.Errorf("parseSrtTime invalid time format: %s", timeStr)
	}

	hours, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, err
	}
	minutes, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, err
	}
	secondsAndMilliseconds := strings.Split(parts[2], ".")
	if len(secondsAndMilliseconds) != 2 {
		return 0, fmt.Errorf("invalid time format: %s", timeStr)
	}
	seconds, err := strconv.Atoi(secondsAndMilliseconds[0])
	if err != nil {
		return 0, err
	}
	milliseconds, err := strconv.Atoi(secondsAndMilliseconds[1])
	if err != nil {
		return 0, err
	}

	duration := time.Duration(hours)*time.Hour +
		time.Duration(minutes)*time.Minute +
		time.Duration(seconds)*time.Second +
		time.Duration(milliseconds)*time.Millisecond

	return duration, nil
}

func formatTimestamp(t time.Duration) string {
	hours := int(t.Hours())
	minutes := int(t.Minutes()) % 60
	seconds := int(t.Seconds()) % 60
	milliseconds := int(t.Milliseconds()) % 1000 / 10
	return fmt.Sprintf("%02d:%02d:%02d.%02d", hours, minutes, seconds, milliseconds)
}

func srtToAss(inputSRT, outputASS string, isHorizontal bool, stepParam *types.SubtitleTaskStepParam) error {
	file, err := os.Open(inputSRT)
	if err != nil {
		log.GetLogger().Error("srtToAss Open input srt error", zap.Error(err))
		return fmt.Errorf("srtToAss Open input srt error: %w", err)
	}
	defer file.Close()

	assFile, err := os.Create(outputASS)
	if err != nil {
		log.GetLogger().Error("srtToAss Create output ass error", zap.Error(err))
		return fmt.Errorf("srtToAss Create output ass error: %w", err)
	}
	defer assFile.Close()
	fallbacks := packagedSubtitleFallbacks()
	scanner := bufio.NewScanner(file)
	styleSet := subtitlestyle.DefaultStyleSet()
	if stepParam != nil && stepParam.SubtitleStyle != nil {
		styleSet = stepParam.SubtitleStyle
		if err := subtitlestyle.Validate(styleSet); err != nil {
			return fmt.Errorf("subtitle style invalid: %w", err)
		}
	}
	screenStyle := styleSet.Vertical
	if isHorizontal {
		screenStyle = styleSet.Horizontal
	}
	majorPrefix := fmt.Sprintf("{\\rMajor}{\\an%d}%s", subtitlestyle.Alignment(screenStyle.Major), subtitlestyle.DialogueTags(screenStyle.Major))
	minorPrefix := fmt.Sprintf("{\\rMinor}{\\an%d}%s", subtitlestyle.Alignment(screenStyle.Minor), subtitlestyle.DialogueTags(screenStyle.Minor))
	firstStyle, secondStyle := screenStyle.Major, screenStyle.Minor
	firstPrefix, secondPrefix := majorPrefix, minorPrefix
	if stepParam != nil && stepParam.SubtitleResultType == types.SubtitleResultTypeBilingualTranslationOnBottom {
		firstStyle, secondStyle = screenStyle.Minor, screenStyle.Major
		firstPrefix, secondPrefix = minorPrefix, majorPrefix
	}

	_, _ = assFile.WriteString(strings.Replace(subtitlestyle.BuildAssHeader(styleSet, isHorizontal), "[Script Info]", "[Script Info]\nWrapStyle: 2", 1))
	if isHorizontal {
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}
			// 读取时间戳行
			if !scanner.Scan() {
				break
			}
			timestampLine := scanner.Text()
			parts := strings.Split(timestampLine, " --> ")
			if len(parts) != 2 {
				continue // 无效时间戳格式
			}

			startTimeStr := strings.TrimSpace(parts[0])
			endTimeStr := strings.TrimSpace(parts[1])
			startTime, err := parseSrtTime(startTimeStr)
			if err != nil {
				log.GetLogger().Error("srtToAss parseSrtTime error", zap.Error(err))
				return fmt.Errorf("srtToAss parseSrtTime error: %w", err)
			}
			endTime, err := parseSrtTime(endTimeStr)
			if err != nil {
				log.GetLogger().Error("srtToAss parseSrtTime error", zap.Error(err))
				return fmt.Errorf("srtToAss parseSrtTime error: %w", err)
			}

			var subtitleLines []string
			for scanner.Scan() {
				textLine := scanner.Text()
				if textLine == "" {
					break // 字幕块结束
				}
				subtitleLines = append(subtitleLines, textLine)
			}

			if len(subtitleLines) == 0 {
				continue
			}
			//var majorTextLanguage types.StandardLanguageCode
			//if stepParam.SubtitleResultType == types.SubtitleResultTypeBilingualTranslationOnTop { // 一定是bilingual
			//	majorTextLanguage = stepParam.TargetLanguage
			//} else {
			//	majorTextLanguage = stepParam.OriginLanguage
			//}

			//majorLine := strings.Join(splitMajorTextInHorizontal(subtitleLines[0], majorTextLanguage, stepParam.MaxWordOneLine), "      \\N")

			// ASS条目
			startFormatted := formatTimestamp(startTime)
			endFormatted := formatTimestamp(endTime)
			if len(subtitleLines) == 1 {
				majorText := joinASSLines(wrapSubtitleForASS(subtitleLines[0], screenStyle.Major, stepParam))
				combinedText := majorPrefix + subtitleFallbackFontTags(majorText, screenStyle.Major.FontName, fallbacks)
				_, _ = assFile.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", startFormatted, endFormatted, combinedText))
				continue
			}
			majorText := joinASSLines(wrapSubtitleForASS(subtitleLines[0], firstStyle, stepParam))
			minorText := joinASSLines(wrapSubtitleForASS(subtitleLines[1], secondStyle, stepParam))
			combinedText := firstPrefix + subtitleFallbackFontTags(majorText, firstStyle.FontName, fallbacks) + `\N` + secondPrefix + subtitleFallbackFontTags(minorText, secondStyle.FontName, fallbacks)
			_, _ = assFile.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", startFormatted, endFormatted, combinedText))
		}
	} else {
		// TODO 竖屏拆分调优
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}
			if !scanner.Scan() {
				break
			}
			timestampLine := scanner.Text()
			parts := strings.Split(timestampLine, " --> ")
			if len(parts) != 2 {
				continue // 无效时间戳格式
			}

			startTimeStr := strings.TrimSpace(parts[0])
			endTimeStr := strings.TrimSpace(parts[1])
			startTime, err := parseSrtTime(startTimeStr)
			if err != nil {
				return err
			}
			endTime, err := parseSrtTime(endTimeStr)
			if err != nil {
				return err
			}

			var subtitleLines []string
			for scanner.Scan() {
				textLine := scanner.Text()
				if textLine == "" {
					break
				}
				subtitleLines = append(subtitleLines, textLine)
			}
			if len(subtitleLines) == 0 {
				continue
			}
			if len(subtitleLines) > 1 {
				startFormatted := formatTimestamp(startTime)
				endFormatted := formatTimestamp(endTime)
				majorText := joinASSLines(wrapSubtitleForASS(subtitleLines[0], firstStyle, stepParam))
				minorText := joinASSLines(wrapSubtitleForASS(subtitleLines[1], secondStyle, stepParam))
				combinedText := firstPrefix + subtitleFallbackFontTags(majorText, firstStyle.FontName, fallbacks) + `\N` + secondPrefix + subtitleFallbackFontTags(minorText, secondStyle.FontName, fallbacks)
				_, _ = assFile.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", startFormatted, endFormatted, combinedText))
				continue
			}

			content := subtitleLines[0]

			if containsChinese(content) {
				// 处理中文字幕
				chineseLines := wrapVerticalChineseSubtitleForASS(content, screenStyle.Major, stepParam)
				if len(chineseLines) == 0 {
					chineseLines = splitChineseText(content, verticalChineseMaxRunesPerLine)
				}
				totalTime := endTime - startTime
				for i, line := range chineseLines {
					iStart := startTime + time.Duration(float64(i)*float64(totalTime)/float64(len(chineseLines)))
					iEnd := startTime + time.Duration(float64(i+1)*float64(totalTime)/float64(len(chineseLines)))
					if iEnd > endTime {
						iEnd = endTime
					}
					startFormatted := formatTimestamp(iStart)
					endFormatted := formatTimestamp(iEnd)
					combinedText := majorPrefix + subtitleFallbackFontTags(line, screenStyle.Major.FontName, fallbacks)
					_, _ = assFile.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", startFormatted, endFormatted, combinedText))
				}
			} else {
				// 处理英文字幕
				startFormatted := formatTimestamp(startTime)
				endFormatted := formatTimestamp(endTime)
				cleanedText := joinASSLines(wrapSubtitleForASS(content, screenStyle.Major, stepParam))
				combinedText := majorPrefix + subtitleFallbackFontTags(cleanedText, screenStyle.Major.FontName, fallbacks)
				_, _ = assFile.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", startFormatted, endFormatted, combinedText))
			}
		}
	}
	return nil
}

func embedSubtitles(stepParam *types.SubtitleTaskStepParam, isHorizontal bool, withTts bool) error {
	outputFileName := types.SubtitleTaskVerticalEmbedVideoFileName
	if isHorizontal {
		outputFileName = types.SubtitleTaskHorizontalEmbedVideoFileName
	}
	input := stepParam.InputVideoPath
	if withTts {
		input = stepParam.VideoWithTtsFilePath
	}

	_, err := renderSubtitleFile(context.Background(), RenderVideoRequest{
		Workdir:      stepParam.TaskBasePath,
		InputVideo:   input,
		SubtitleFile: stepParam.BilingualSrtFilePath,
		OutputFile:   filepath.Join(stepParam.TaskBasePath, "output", outputFileName),
		Horizontal:   isHorizontal,
		StepParam:    stepParam,
	})
	return err
}

func getFontPaths() (string, string, error) {
	return fontPathsForOS(runtime.GOOS, pathExists)
}

func fontPathsForOS(goos string, exists func(string) bool) (string, string, error) {
	if exists == nil {
		exists = pathExists
	}
	candidates, err := fontCandidatesForOS(goos)
	if err != nil {
		return "", "", err
	}
	return chooseFontPair(candidates, exists)
}

type fontPair struct {
	bold    string
	regular string
}

func fontCandidatesForOS(goos string) ([]fontPair, error) {
	switch goos {
	case "windows":
		return []fontPair{
			{bold: "C:/Windows/Fonts/msyhbd.ttc", regular: "C:/Windows/Fonts/msyh.ttc"},
			{bold: "C:/Windows/Fonts/simhei.ttf", regular: "C:/Windows/Fonts/msyh.ttc"},
			{bold: "C:/Windows/Fonts/simsun.ttc", regular: "C:/Windows/Fonts/simsun.ttc"},
		}, nil
	case "darwin":
		return []fontPair{
			{bold: "/System/Library/Fonts/Hiragino Sans GB.ttc", regular: "/System/Library/Fonts/Hiragino Sans GB.ttc"},
			{bold: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", regular: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"},
			{bold: "/System/Library/Fonts/STHeiti Medium.ttc", regular: "/System/Library/Fonts/STHeiti Light.ttc"},
			{bold: "/System/Library/Fonts/Supplemental/Songti.ttc", regular: "/System/Library/Fonts/Supplemental/Songti.ttc"},
		}, nil
	case "linux":
		return []fontPair{
			{bold: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", regular: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"},
			{bold: "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc", regular: "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"},
			{bold: "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", regular: "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"},
			{bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", regular: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported OS: %s", goos)
	}
}

func chooseFontPair(candidates []fontPair, exists func(string) bool) (string, string, error) {
	for _, candidate := range candidates {
		if exists(candidate.bold) && exists(candidate.regular) {
			return candidate.bold, candidate.regular, nil
		}
	}
	if len(candidates) == 0 {
		return "", "", errors.New("no font candidates configured")
	}
	// Fall back to the first candidate so containerized builds can still run when
	// font discovery is unavailable, while normal hosts use existing fonts.
	return candidates[0].bold, candidates[0].regular, nil
}

func pathExists(path string) bool {
	_, err := os.Stat(filepath.FromSlash(path))
	return err == nil
}

func getResolution(inputVideo string) (int, int, error) {
	// 获取视频信息
	cmdArgs := []string{
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=s=x:p=0",
		inputVideo,
	}
	cmd := exec.Command(storage.FfprobePath, cmdArgs...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	if err := cmd.Run(); err != nil {
		log.GetLogger().Error("获取视频分辨率失败", zap.String("output", out.String()), zap.Error(err))
		return 0, 0, err
	}

	output := strings.TrimSpace(out.String())
	output = strings.TrimSuffix(output, "x") // 去除尾部可能存在的x,例如1920x1080x

	re := regexp.MustCompile(`^(\d+)x(\d+)$`)
	dimensions := re.FindStringSubmatch(output)
	if len(dimensions) != 3 {
		log.GetLogger().Error("获取视频分辨率失败", zap.String("output", output))
		return 0, 0, fmt.Errorf("invalid resolution format: %s", output)
	}

	width, _ := strconv.Atoi(dimensions[1])
	height, _ := strconv.Atoi(dimensions[2])
	return width, height, nil
}

func convertToVertical(inputVideo, outputVideo, majorTitle, minorTitle string) error {
	return convertToVerticalProgress(context.Background(), inputVideo, outputVideo, majorTitle, minorTitle, nil)
}

func convertToVerticalProgress(ctx context.Context, inputVideo, outputVideo, majorTitle, minorTitle string, task *types.SubtitleTask) error {
	if _, err := os.Stat(outputVideo); err == nil {
		log.GetLogger().Info("竖屏视频已存在", zap.String("outputVideo", outputVideo))
		return nil
	}

	fontBold, fontRegular, err := getFontPaths()
	if err != nil {
		log.GetLogger().Error("获取字体路径失败", zap.Error(err))
		return err
	}

	cmdArgs := []string{
		"-i", inputVideo,
		"-vf", buildVerticalFilter(majorTitle, minorTitle, fontBold, fontRegular),
		"-r", "30",
		"-b:v", "7587k",
		"-c:a", "aac",
		"-b:a", "192k",
		"-c:v", "libx264",
		"-preset", "fast",
		"-y",
		outputVideo,
	}
	output, err := runFFmpegProgress(ctx, cmdArgs, inputVideo, "preparing_render", "正在转换竖屏画面", task, 5, 28)
	if err != nil {
		log.GetLogger().Error("视频转竖屏失败", zap.String("output", string(output)), zap.Error(err))
		return err
	}

	fmt.Printf("竖屏视频已保存到: %s\n", outputVideo)
	return nil
}

func buildVerticalFilter(majorTitle, minorTitle, fontBold, fontRegular string) string {
	return fmt.Sprintf(
		"scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:250,drawbox=y=0:h=250:c=black@1:t=fill,drawtext=text='%s':x=(w-text_w)/2:y=120:fontsize=44:fontcolor=yellow:box=0:fontfile='%s',drawtext=text='%s':x=(w-text_w)/2:y=178:fontsize=30:fontcolor=yellow:box=0:fontfile='%s'",
		escapeDrawtextText(majorTitle),
		escapeFilterPath(fontBold),
		escapeDrawtextText(minorTitle),
		escapeFilterPath(fontRegular),
	)
}

func escapeDrawtextText(text string) string {
	replacer := strings.NewReplacer(
		`\\`, `\\\\`,
		`'`, `\\'`,
		`:`, `\:`,
		`,`, `\,`,
		`[`, `\[`,
		`]`, `\]`,
	)
	return replacer.Replace(text)
}

func escapeFilterPath(path string) string {
	normalized := strings.ReplaceAll(path, `\:/`, `:/`)
	normalized = strings.ReplaceAll(normalized, `\`, `/`)
	return strings.ReplaceAll(normalized, ":", `\:`)
}
