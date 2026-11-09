package util

import (
	"bufio"
	"fmt"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// 处理每一个字幕块
func ProcessBlock(block []string, targetLanguageFile, targetLanguageTextFile, originLanguageFile, originLanguageTextFile *os.File, isTargetOnTop bool) {
	var targetLines, originLines []string
	var targetText, originText string

	// 匹配时间戳的正则表达式
	timePattern := regexp.MustCompile(`\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}`)
	for _, line := range block {
		if timePattern.MatchString(line) || IsNumber(line) {
			// 时间戳和编号行保留在两个文件中
			targetLines = append(targetLines, line)
			originLines = append(originLines, line)
			continue
		}
		if len(targetLines) == 2 && len(originLines) == 2 { // 刚写完编号和时间戳，到了上方的文字行
			if isTargetOnTop {
				targetLines = append(targetLines, line)
				targetText = line
			} else {
				originLines = append(originLines, line)
				originText = line
			}
			continue
		}
		// 到了下方的文字行
		if isTargetOnTop {
			originLines = append(originLines, line)
			originText = line
		} else {
			targetLines = append(targetLines, line)
			targetText = line
		}
	}

	// 写入文本文件，每个block一行，带换行符（如果文件不为nil）
	if targetText != "" && targetLanguageTextFile != nil {
		targetLanguageTextFile.WriteString(targetText + "\n")
	}
	if originText != "" && originLanguageTextFile != nil {
		originLanguageTextFile.WriteString(originText + "\n")
	}

	if len(targetLines) > 2 {
		// 写入目标语言文件
		for _, line := range targetLines {
			targetLanguageFile.WriteString(line + "\n")
		}
		targetLanguageFile.WriteString("\n")
	}

	if len(originLines) > 2 {
		// 写入源语言文件
		for _, line := range originLines {
			originLanguageFile.WriteString(line + "\n")
		}
		originLanguageFile.WriteString("\n")
	}
}

// IsSubtitleText 是否是字幕文件中的字幕文字行
func IsSubtitleText(line string) bool {
	if line == "" {
		return false
	}
	if IsNumber(line) {
		return false
	}
	timelinePattern := regexp.MustCompile(`\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}`)
	return !timelinePattern.MatchString(line)
}

type Format struct {
	Duration string `json:"duration"`
}

type ProbeData struct {
	Format Format `json:"format"`
}

type SrtBlock struct {
	Index                  int
	Timestamp              string
	TargetLanguageSentence string
	OriginLanguageSentence string
}

func TrimString(s string) string {
	s = strings.Replace(s, "[中文翻译]", "", -1)
	s = strings.Replace(s, "[英文句子]", "", -1)
	// 去除开头的空格和 '['
	s = strings.TrimLeft(s, " [")

	// 去除结尾的空格和 ']'
	s = strings.TrimRight(s, " ]")

	//替换中文单引号
	s = strings.ReplaceAll(s, "’", "'")

	return s
}

func SplitSentence(sentence string) []string {
	// 使用正则表达式移除标点符号和特殊字符（保留各语言字母、数字和空格）
	re := regexp.MustCompile(`[^\p{L}\p{N}\s']+`)
	cleanedSentence := re.ReplaceAllString(sentence, " ")

	// 使用 strings.Fields 按空格拆分成单词
	words := strings.Fields(cleanedSentence)

	return words
}

func MergeFile(finalFile string, files ...string) error {
	// 创建最终文件
	final, err := os.Create(finalFile)
	if err != nil {
		return err
	}

	// 逐个读取文件并写入最终文件
	for _, file := range files {
		f, err := os.Open(file)
		if err != nil {
			return err
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			final.WriteString(line + "\n")
		}
	}

	return nil
}

func MergeSrtFiles(finalFile string, files ...string) error {
	output, err := os.Create(finalFile)
	if err != nil {
		return err
	}
	defer output.Close()
	writer := bufio.NewWriter(output)
	lineNumber := 0
	for _, file := range files {
		// 不存在某一个file就跳过
		if _, err = os.Stat(file); os.IsNotExist(err) {
			continue
		}
		// 打开当前字幕文件
		f, err := os.Open(file)
		if err != nil {
			return err
		}
		defer f.Close()
		// 处理当前字幕文件
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()

			if strings.Contains(line, "```") {
				continue
			}

			if IsNumber(line) {
				lineNumber++
				line = strconv.Itoa(lineNumber)
			}

			writer.WriteString(line + "\n")
		}
	}
	writer.Flush()

	return nil
}

// 给定文件和替换map，将文件中所有的key替换成value
func ReplaceFileContent(srcFile, dstFile string, replacements map[string]string) error {
	file, err := os.Open(srcFile)
	if err != nil {
		return err
	}
	defer file.Close()

	outFile, err := os.Create(dstFile)
	if err != nil {
		return err
	}
	defer outFile.Close()

	scanner := bufio.NewScanner(file)
	writer := bufio.NewWriter(outFile) // 提高性能
	defer writer.Flush()

	for scanner.Scan() {
		line := scanner.Text()
		for before, after := range replacements {
			line = strings.ReplaceAll(line, before, after)
		}
		_, _ = writer.WriteString(line + "\n")
	}

	if err = scanner.Err(); err != nil {
		return err
	}

	return nil
}

// 获得文件名后加上后缀的新文件名，不改变扩展名，例如：/home/ubuntu/abc.srt变成/home/ubuntu/abc_tmp.srt
func AddSuffixToFileName(filePath, suffix string) string {
	dir := filepath.Dir(filePath)
	ext := filepath.Ext(filePath)
	name := strings.TrimSuffix(filepath.Base(filePath), ext)
	newName := fmt.Sprintf("%s%s%s", name, suffix, ext)
	return filepath.Join(dir, newName)
}

// 去除字符串中的标点符号等字符，确保字符中的内容都是whisper模型可以识别出来的，便于时间戳对齐
func GetRecognizableString(s string) string {
	var result []rune
	for _, v := range s {
		// 英文字母和数字
		if unicode.Is(unicode.Latin, v) || unicode.Is(unicode.Number, v) {
			result = append(result, v)
		}
		// 中文
		if unicode.Is(unicode.Han, v) {
			result = append(result, v)
		}
		// 韩文
		if unicode.Is(unicode.Hangul, v) {
			result = append(result, v)
		}
		// 日文平假片假
		if unicode.Is(unicode.Hiragana, v) || unicode.Is(unicode.Katakana, v) {
			result = append(result, v)
		}
	}
	return string(result)
}

func GetAudioDuration(inputFile string) (float64, error) {
	// 使用 ffprobe 获取精确时长
	cmd := exec.Command(storage.FfprobePath, "-i", inputFile, "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0")
	cmdOutput, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("GetAudioDuration failed to get audio duration: %w", err)
	}

	// 解析时长
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(cmdOutput)), 64)
	if err != nil {
		return 0, fmt.Errorf("GetAudioDuration failed to parse audio duration: %w", err)
	}

	return duration, nil
}

var (
	silenceStartPattern = regexp.MustCompile(`silence_start:\s*([0-9]+(?:\.[0-9]+)?)`)
	silenceEndPattern   = regexp.MustCompile(`silence_end:\s*([0-9]+(?:\.[0-9]+)?)`)
)

// GetSpeechDuration returns the duration between the first and last audible
// samples. TTS providers commonly add padding silence to WAV files; counting
// that padding as speech makes short subtitle windows look overlong.
// All-silence files keep their container duration so explicit silence cues
// remain valid audio placeholders.
func GetSpeechDuration(inputFile string) (float64, error) {
	start, end, err := GetSpeechBounds(inputFile)
	if err != nil {
		return 0, err
	}
	return end - start, nil
}

// GetSpeechBounds uses the same boundary detection for timing and audio assembly.
func GetSpeechBounds(inputFile string) (float64, float64, error) {
	total, err := GetAudioDuration(inputFile)
	if err != nil {
		return 0, 0, err
	}

	cmd := exec.Command(
		storage.FfmpegPath,
		"-hide_banner",
		"-i", inputFile,
		"-af", "silencedetect=noise=-35dB:d=0.05",
		"-f", "null",
		"-",
	)
	output, detectErr := cmd.CombinedOutput()
	if detectErr != nil {
		// Preserve the previous duration behavior if silence detection is not
		// available for a particular codec or installation.
		return 0, total, nil
	}

	starts := make([]float64, 0, 2)
	for _, match := range silenceStartPattern.FindAllStringSubmatch(string(output), -1) {
		if value, parseErr := strconv.ParseFloat(match[1], 64); parseErr == nil {
			starts = append(starts, value)
		}
	}
	ends := make([]float64, 0, 2)
	for _, match := range silenceEndPattern.FindAllStringSubmatch(string(output), -1) {
		if value, parseErr := strconv.ParseFloat(match[1], 64); parseErr == nil {
			ends = append(ends, value)
		}
	}

	start := 0.0
	if len(starts) > 0 && len(ends) > 0 && starts[0] <= 0.001 {
		start = ends[0]
	}
	end := total
	if len(starts) > 0 && len(ends) > 0 && ends[len(ends)-1] >= total-0.05 {
		end = starts[len(starts)-1]
	}
	effective := speechDurationFromSilence(total, start, end)
	if effective == total {
		return 0, total, nil
	}
	return start, end, nil
}

func speechDurationFromSilence(total, start, end float64) float64 {
	effective := end - start
	if effective <= 0.02 || effective > total+0.02 {
		return total
	}
	return effective
}

// todo 后续再补充
func IsAsianLanguage(code types.StandardLanguageCode) bool {
	return code == types.LanguageNameSimplifiedChinese || code == types.LanguageNameTraditionalChinese || code == types.LanguageNameJapanese || code == types.LanguageNameKorean || code == types.LanguageNameThai
}

func BeautifyAsianLanguageSentence(input string) string {
	if len(input) == 0 {
		return input
	}

	// 不处理的
	pairPunctuations := map[rune]rune{
		'「': '」', '『': '』', '“': '”', '‘': '’',
		'《': '》', '<': '>', '【': '】', '〔': '〕',
		'(': ')', '[': ']', '{': '}',
	}

	// 需要处理的单标点
	singlePunctuations := ",.;:!?~，、。！？；：…"

	// 先处理字符串末尾的标点
	runes := []rune(input)
	i := len(runes) - 1
	for i >= 0 {
		r := runes[i]
		// 如果是空格，继续检查前一个字符
		if unicode.IsSpace(r) {
			i--
			continue
		}
		// 如果是单标点，去除
		if strings.ContainsRune(singlePunctuations, r) {
			runes = runes[:i]
			i--
		} else {
			// 遇到非标点或成对标点，停止
			break
		}
	}

	// 中间的单标点替换为空格
	var inPair bool
	var expectedClose rune
	var result []rune

	for i := 0; i < len(runes); i++ {
		r := runes[i]

		// 检查是否在成对标点内
		if inPair {
			if r == expectedClose {
				inPair = false
			}
			result = append(result, r)
			continue
		}

		// 检查是否是成对标点的开始
		if close, isPair := pairPunctuations[r]; isPair {
			inPair = true
			expectedClose = close
			result = append(result, r)
			continue
		}

		// 检查是否是数字中的小数点
		if r == '.' && i > 0 && i < len(runes)-1 {
			prev := runes[i-1]
			next := runes[i+1]
			if unicode.IsDigit(prev) && unicode.IsDigit(next) {
				result = append(result, r)
				continue
			}
		}

		// 处理单标点
		if strings.ContainsRune(singlePunctuations, r) {
			// 替换为空格，但避免连续空格
			if len(result) > 0 && !unicode.IsSpace(result[len(result)-1]) {
				result = append(result, ' ')
			}
		} else {
			result = append(result, r)
		}
	}

	return strings.TrimSpace(string(result))
}

// SplitTextSentences 将文本按常见的半全角分隔符号切分成句子，会考虑一些特殊的不用切分的情况
// maxChars: 最小字符数，完整句子小于此字符数时不切割，否则连逗号也要切割
// 使用示例:
//
//	SplitTextSentences("你好,世界!", 5)  // 返回: ["你好,世界!"] (不切割，因为总字符数<5)
//	SplitTextSentences("这是一个很长的句子,包含很多内容。", 10) // 返回: ["这是一个很长的句子", "包含很多内容。"] (切割逗号)
func SplitTextSentences(text string, maxChars int) []string {
	if strings.TrimSpace(text) == "" {
		return []string{}
	}

	// 第一步：保护特殊模式（数字、时间、缩写等）
	text = protectSpecialNumbers(text)

	// 第二步：智能切割 - 首先按完整句子分割
	completeSentences := splitByCompleteSentences(text)

	var result []string
	for _, sentence := range completeSentences {
		sentence = strings.TrimSpace(sentence)
		if sentence == "" {
			continue
		}

		// 统计有效字符数（排除标点和空格）
		effectiveChars := CountEffectiveChars(sentence)

		// 如果完整句子小于最小字符数，不切割
		if effectiveChars < maxChars {
			cleaned := restoreProtectedPatterns(sentence)
			result = append(result, strings.TrimSpace(cleaned))
		} else {
			// 完整句子过长，需要进一步按逗号等标点切割
			subSentences := splitByAllPunctuation(sentence)
			merged := mergeShortSentences(subSentences, 20, maxChars)

			for _, subSentence := range merged {
				cleaned := restoreProtectedPatterns(subSentence)
				cleaned = strings.TrimSpace(cleaned)
				if cleaned != "" {
					result = append(result, cleaned)
				}
			}
		}
	}

	// 最后一步：过滤并合并单独的标点符号
	finalResult := make([]string, 0)
	for _, sentence := range result {
		trimmed := strings.TrimSpace(sentence)

		// 检查是否是单独的标点符号（主要是引号）
		if isStandalonePunctuation(trimmed) {
			// 如果是单独的标点符号，尝试合并到前一个句子
			if len(finalResult) > 0 {
				// 将标点符号合并到前一个句子的末尾
				lastIdx := len(finalResult) - 1
				finalResult[lastIdx] = finalResult[lastIdx] + trimmed
			}
			// 如果没有前一个句子，则跳过这个单独的标点符号
		} else {
			finalResult = append(finalResult, sentence)
		}
	}

	return finalResult
}

// protectedPatterns 存储被保护的模式
var protectedPatterns map[string]string

// protectSpecialNumbers 保护数字、时间、缩写等不被误切
func protectSpecialNumbers(text string) string {
	protectedPatterns = make(map[string]string)

	// 使用更直接的方法来保护列表编号模式
	// 先处理特定的模式，如 "1.value", "2.be", "3.give" 等
	listNumberPattern := regexp.MustCompile(`\b\d+\.[a-zA-Z]`)
	text = listNumberPattern.ReplaceAllStringFunc(text, func(match string) string {
		placeholder := fmt.Sprintf("\uE000%d\uE000", len(protectedPatterns))
		protectedPatterns[placeholder] = match
		return placeholder
	})

	patterns := []struct {
		regex *regexp.Regexp
		name  string
	}{
		// 保护域名和网址（如 .com, .org, .net 等）
		{regexp.MustCompile(`\b[a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|mil|int|co|io|ai|me|tv|fm|am|pm|uk|cn|jp|de|fr|it|es|ru|in|au|ca|br|mx|ar|cl|pe|ve|ec|py|uy|bo|gf|sr|gy|fk|gs|sh|ac|ad|ae|af|ag|al|am|an|ao|aq|as|at|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|cc|cd|cf|cg|ch|ci|ck|cm|co|cr|cs|cu|cv|cx|cy|cz|dj|dk|dm|do|dz|eg|eh|er|et|eu|fi|fj|fk|fo|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|iq|ir|is|je|jm|jo|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|qa|re|ro|rs|rw|sa|sb|sc|sd|se|sg|si|sj|sk|sl|sm|sn|so|st|su|sv|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tz|ua|ug|um|us|uy|uz|va|vc|vg|vi|vn|vu|wf|ws|ye|yt|za|zm|zw)\b`), "domain"},
		// 保护 a.m., p.m., A.M., P.M. 这类缩写
		{regexp.MustCompile(`(?i)\b[ap]\.m\.`), "ampm"},
		// 时间格式
		{regexp.MustCompile(`\b\d{1,2}[:\.]\d{2}\s*(?:[ap]\.?m\.?|AM|PM)?\b`), "time"},
		// 小数（包括多位小数）
		{regexp.MustCompile(`\b\d+\.\d+\b`), "decimal"},
		// 千位分隔符
		{regexp.MustCompile(`\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b`), "thousands"},
		// 版本号（如 1.0, 2.5.1 等）
		{regexp.MustCompile(`\b\d+(?:\.\d+)+\b`), "version"},
		// 英文缩写
		{regexp.MustCompile(`\b(?:[A-Z][a-z]*\.){2,}|(?:[A-Z]\.){2,}[A-Z]?\b`), "abbrev"},
		// Mr., Mrs., Dr. 等称谓
		{regexp.MustCompile(`\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr)\.`), "title"},
		// 列表编号（如 1., 2., 3. 等）- 数字+点+空格
		{regexp.MustCompile(`\b\d+\.\s`), "list_number_with_space"},
		// 字母编号（如 a., b., c. 等）
		{regexp.MustCompile(`\b[a-zA-Z]\.\s`), "letter_number_with_space"},
	}

	for _, pattern := range patterns {
		text = pattern.regex.ReplaceAllStringFunc(text, func(match string) string {
			placeholder := fmt.Sprintf("\uE000%d\uE000", len(protectedPatterns))
			protectedPatterns[placeholder] = match
			return placeholder
		})
	}

	return text
}

// splitByCompleteSentences 按完整句子标点分割（句号、感叹号、问号等）
func splitByCompleteSentences(text string) []string {
	// 只按句末标点分割，不包含逗号
	completeSentenceMarkers := []string{
		".", "!", "?", "。", "！", "？", "；", "\n", "\r\n",
	}

	// 创建正则表达式模式
	var patterns []string
	for _, marker := range completeSentenceMarkers {
		patterns = append(patterns, regexp.QuoteMeta(marker))
	}

	// 匹配连续的句末标点符号
	regexPattern := fmt.Sprintf(`([%s]+)`, strings.Join(patterns, ""))
	regex := regexp.MustCompile(regexPattern)

	// 在标点符号后添加分隔符
	text = regex.ReplaceAllString(text, "${1}\uE001")

	// 按分隔符分割
	parts := strings.Split(text, "\uE001")

	var segments []string
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			segments = append(segments, trimmed)
		}
	}

	return segments
}

// countEffectiveChars 统计有效字符数（排除标点和空格）
func CountEffectiveChars(text string) int {
	effectiveText := regexp.MustCompile(`[^\p{L}\p{N}]`).ReplaceAllString(text, "")
	return len([]rune(effectiveText))
}

// splitByAllPunctuation 按所有标点符号分割文本
func splitByAllPunctuation(text string) []string {
	// 注意：这里的text已经在SplitTextSentences中被保护过了，不需要再次保护

	// 定义分割标点符号（包括中英文标点）
	punctuationMarkers := []string{
		// 句末标点
		".", "!", "?", "；", "。", "！", "？", "；",
		// 句内标点（也要分割）
		",", "，", ";",
		// 换行符
		"\n", "\r\n",
	}

	// 创建正则表达式模式
	var patterns []string
	for _, marker := range punctuationMarkers {
		patterns = append(patterns, regexp.QuoteMeta(marker))
	}

	// 匹配连续的标点符号
	regexPattern := fmt.Sprintf(`([%s]+)`, strings.Join(patterns, ""))
	regex := regexp.MustCompile(regexPattern)

	// 在标点符号后添加分隔符
	text = regex.ReplaceAllString(text, "${1}\uE001")

	// 按分隔符分割
	parts := strings.Split(text, "\uE001")

	var segments []string
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			segments = append(segments, trimmed)
		}
	}

	return segments
}

// mergeShortSentences 合并过短的句子
// maxChars: 最小字符数，句子小于此值时考虑合并
// maxChars: 最大字符数，合并后的句子不能超过此值
func mergeShortSentences(segments []string, minChars, maxChars int) []string {
	if len(segments) == 0 {
		return segments
	}

	var result []string
	var current strings.Builder

	for i, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}

		// 添加到当前句子
		if current.Len() > 0 {
			current.WriteString(" ")
		}
		current.WriteString(segment)

		currentText := current.String()
		currentEffectiveChars := CountEffectiveChars(currentText)

		// 检查是否应该合并下一个片段
		shouldMerge := false
		if i < len(segments)-1 { // 还有下一个片段
			nextSegment := strings.TrimSpace(segments[i+1])
			if nextSegment != "" {
				// 计算合并后的长度
				potentialMerged := currentText + " " + nextSegment
				mergedEffectiveChars := CountEffectiveChars(potentialMerged)

				// 只有当前句子小于minChars，并且合并后不超过maxChars才合并
				shouldMerge = currentEffectiveChars < minChars && mergedEffectiveChars <= maxChars
			}
		}

		if !shouldMerge {
			// 不合并，输出当前句子并重置
			result = append(result, strings.TrimSpace(currentText))
			current.Reset()
		}
		// 如果shouldMerge为true，继续循环到下一个片段进行合并
	}

	// 处理最后的片段
	if current.Len() > 0 {
		result = append(result, strings.TrimSpace(current.String()))
	}

	return result
}

// isTooShort 判断句子是否过短需要合并
func isTooShort(text string, maxChars int) bool {
	text = strings.TrimSpace(text)

	// 计算有效字符数（排除标点和空格）
	effectiveChars := CountEffectiveChars(text)

	// 如果有效字符少于最小字符数，认为过短
	if effectiveChars < maxChars {
		return true
	}

	// 如果只有一个单词，也认为过短（除非已经达到最小字符数）
	words := strings.Fields(text)
	return len(words) <= 1 && effectiveChars < maxChars
}

// restoreProtectedPatterns 恢复被保护的模式
func restoreProtectedPatterns(text string) string {
	for placeholder, original := range protectedPatterns {
		text = strings.ReplaceAll(text, placeholder, original)
	}
	return text
}

// 将start和end转换为指定格式
func ConvertTimes(start, end float32) string {
	startTime := FormatTime(start)
	endTime := FormatTime(end)
	return fmt.Sprintf("%s --> %s", startTime, endTime)
}

// isStandalonePunctuation 检查是否是单独的标点符号
func isStandalonePunctuation(text string) bool {
	if text == "" {
		return false
	}

	// 定义需要过滤的单独标点符号（主要是引号）
	standalonePuncts := []string{
		"\"",     // 英文双引号
		"\u201c", // 中文左双引号 "
		"\u201d", // 中文右双引号 "
		"'",      // 英文单引号
		"\u2018", // 中文左单引号 '
		"\u2019", // 中文右单引号 '
	}

	for _, punct := range standalonePuncts {
		if text == punct {
			return true
		}
	}

	return false
}
