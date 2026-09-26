package service

import (
	"encoding/json"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/openai"
	"krillin-ai/pkg/util"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

type Translator struct {
	chatCompleter types.ChatCompleter
}

func NewTranslator() *Translator {
	return &Translator{
		chatCompleter: openai.NewClient(config.Conf.Llm.BaseUrl, config.Conf.Llm.ApiKey, config.Conf.App.Proxy),
	}
}

func (t *Translator) SplitTextAndTranslate(inputText string, originLang, targetLang types.StandardLanguageCode) ([]*TranslatedItem, error) {
	sentences := util.SplitTextSentences(inputText, config.Conf.App.MaxSentenceLength)
	if len(sentences) == 0 {
		return []*TranslatedItem{}, nil
	}

	// 补丁：whisper转录中文的时候很多句子后面不输出符号，导致上面基于符号的切分失效
	if IsSplitUseSpace(originLang) {
		newSentences := make([]string, 0)
		for _, sentence := range sentences {
			newSentences = append(newSentences, strings.Split(sentence, " ")...)
		}
		sentences = newSentences
	}

	shortSentences := make([]string, 0)
	// 使用递归拆句确保所有句子都满足长度要求
	for _, sentence := range sentences {
		if sentence == "" {
			continue
		}
		recursiveSplitItems := t.recursiveSplitSentence(sentence, 0)
		shortSentences = append(shortSentences, recursiveSplitItems...)
	}

	sentences = shortSentences

	var (
		signal  = make(chan struct{}, config.Conf.App.TranslateParallelNum) // 控制最大并发数
		wg      sync.WaitGroup
		results = make([]*TranslatedItem, len(sentences))
		// errChan = make(chan error, 1)
		// mutex   sync.Mutex
	)

	for i, sentence := range sentences {
		wg.Add(1)
		signal <- struct{}{}

		go func(index int, originText string) {
			defer wg.Done()
			defer func() { <-signal }()

			contextSentenceNum := 3

			// 生成前面3个句子的string
			var previousSentences string
			if index > 0 {
				start := 0
				if index-contextSentenceNum > 0 {
					start = index - contextSentenceNum
				}
				for i := start; i < index; i++ {
					previousSentences += sentences[i] + "\n"
				}
			}

			// 生成后面3个句子的string
			var nextSentences string
			if index < len(sentences)-1 {
				end := len(sentences) - 1
				if index+contextSentenceNum < end {
					end = index + contextSentenceNum
				}
				for i := index + 1; i <= end; i++ {
					if i > index+1 {
						nextSentences += "\n"
					}
					nextSentences += sentences[i]
				}
			}

			prompt := fmt.Sprintf(types.SplitTextWithContextPrompt, types.GetStandardLanguageName(targetLang), previousSentences, originText, nextSentences)

			translatedText, err := t.translateWithRetry(prompt, originText, originLang, targetLang)
			if err != nil {
				log.GetLogger().Error("splitTextAndTranslate llm translate error after retries", zap.Error(err), zap.Any("original text", originText))
				results[index] = &TranslatedItem{
					OriginText:     originText,
					TranslatedText: originText,
				}
			} else {
				results[index] = &TranslatedItem{
					OriginText:     originText,
					TranslatedText: translatedText,
				}
			}
		}(i, sentence)
	}

	wg.Wait()

	return results, nil
}

func (t *Translator) splitOriginLongSentence(sentence string) ([]string, error) {
	prompt := fmt.Sprintf(types.SplitOriginLongSentencePrompt, sentence)

	var response string
	var err error
	shortSentences := make([]string, 0)
	// 尝试调用3次
	for i := range 3 {
		response, err = t.chatCompleter.ChatCompletion(prompt)
		if err != nil {
			log.GetLogger().Error("splitOriginLongSentence chat completion error", zap.Error(err), zap.String("sentence", sentence), zap.Any("time", i))
			continue
		}
		var splitResult struct {
			ShortSentences []struct {
				Text string `json:"text"`
			} `json:"short_sentences"`
		}

		cleanResponse := util.ExtractJSONObject(response, "short_sentences")
		if err = json.Unmarshal([]byte(cleanResponse), &splitResult); err != nil {
			log.GetLogger().Error("splitOriginLongSentence parse split result error", zap.Error(err), zap.Any("response", response))
			continue
		}

		for _, shortSentence := range splitResult.ShortSentences {
			// 清理文本，移除多余的引号
			cleanText := strings.TrimSpace(shortSentence.Text)
			cleanText = strings.Trim(cleanText, `"'`)
			if cleanText != "" {
				shortSentences = append(shortSentences, cleanText)
			}
		}
		break
	}

	if err != nil {
		return nil, fmt.Errorf("parse split result error: %w", err)
	}

	return shortSentences, nil
}

// RecursiveSplitSentence 递归拆分句子直到满足长度要求（公开方法）
func (t *Translator) RecursiveSplitSentence(sentence string, depth int) []string {
	return t.recursiveSplitSentence(sentence, depth)
}

// recursiveSplitSentence 递归拆分句子直到满足长度要求
func (t *Translator) recursiveSplitSentence(sentence string, depth int) []string {
	const maxDepth = 5 // 防止无限递归，最多拆分5层

	// 如果句子已经满足长度要求，直接返回
	if util.CountEffectiveChars(sentence) <= config.Conf.App.MaxSentenceLength {
		return []string{sentence}
	}

	// 如果递归深度过深，强制返回原句子（避免无限递归）
	if depth >= maxDepth {
		log.GetLogger().Warn("recursive split reached max depth, returning original sentence",
			zap.String("sentence", sentence),
			zap.Int("depth", depth),
			zap.Int("charCount", util.CountEffectiveChars(sentence)))
		return []string{sentence}
	}

	// 使用大模型拆分句子
	log.GetLogger().Info("recursive split long sentence",
		zap.String("sentence", sentence),
		zap.Int("depth", depth),
		zap.Int("charCount", util.CountEffectiveChars(sentence)))

	splitItems, err := t.splitOriginLongSentence(sentence)
	if err != nil {
		log.GetLogger().Error("recursive split error, returning original sentence",
			zap.Error(err),
			zap.String("sentence", sentence),
			zap.Int("depth", depth))
		return []string{sentence}
	}

	// 如果拆分失败（返回空或只有一个与原句相同的项），返回原句子
	if len(splitItems) == 0 || (len(splitItems) == 1 && strings.TrimSpace(splitItems[0]) == strings.TrimSpace(sentence)) {
		log.GetLogger().Warn("llm split returned same sentence, stopping recursion",
			zap.String("sentence", sentence),
			zap.Int("depth", depth))
		return []string{sentence}
	}

	// 递归处理拆分后的每个子句
	result := make([]string, 0)
	for _, item := range splitItems {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		// 递归拆分子句
		subItems := t.recursiveSplitSentence(item, depth+1)
		result = append(result, subItems...)
	}

	return result
}

// translateWithRetry 带重试和翻译质量检查的翻译方法
func (t *Translator) translateWithRetry(prompt, originText string, originLang, targetLang types.StandardLanguageCode) (string, error) {
	const maxRetries = 3
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		translatedText, err := t.chatCompleter.ChatCompletion(prompt)
		if err != nil {
			lastErr = err
			log.GetLogger().Warn("translate attempt failed",
				zap.Error(err),
				zap.Int("attempt", attempt+1),
				zap.String("originText", originText))
			continue
		}

		// 清理翻译结果
		translatedText = strings.TrimSpace(translatedText)
		translatedText = strings.Trim(translatedText, `"'`)

		// 检查翻译质量
		if t.isTranslationValid(originText, translatedText, originLang, targetLang) {
			log.GetLogger().Debug("translation successful",
				zap.Int("attempt", attempt+1),
				zap.String("originText", originText),
				zap.String("translatedText", translatedText))
			return translatedText, nil
		}

		log.GetLogger().Warn("translation quality check failed, retrying",
			zap.Int("attempt", attempt+1),
			zap.String("originText", originText),
			zap.String("translatedText", translatedText))

		// 为下一次重试修改提示词，增加强调
		if attempt < maxRetries-1 {
			prompt = t.enhanceTranslationPrompt(prompt, originText, translatedText, targetLang)
		}
	}

	if lastErr != nil {
		return "", lastErr
	}

	return "", fmt.Errorf("translation quality check failed after %d attempts", maxRetries)
}

// isTranslationValid 检查翻译是否有效
func (t *Translator) isTranslationValid(originText, translatedText string, originLang, targetLang types.StandardLanguageCode) bool {
	// 1. 翻译不能为空
	if strings.TrimSpace(translatedText) == "" {
		return false
	}

	// 2. 翻译不能与原文完全相同（除非是特殊情况）
	if strings.TrimSpace(originText) == strings.TrimSpace(translatedText) {
		// 检查是否是专有名词、数字或特殊符号
		if t.isSpecialContent(originText) {
			return true // 专有名词等可以保持原文
		}
		return false
	}

	// 3. 检查语言特征（简单的启发式检查）
	if !t.hasTargetLanguageCharacteristics(translatedText, targetLang) {
		return false
	}

	// 4. 长度合理性检查（翻译结果不应该过长或过短）
	originLen := len(strings.TrimSpace(originText))
	translatedLen := len(strings.TrimSpace(translatedText))

	// 翻译结果长度应该在原文的0.3-3倍之间（考虑语言特性）
	if float64(translatedLen) < float64(originLen)*0.3 || float64(translatedLen) > float64(originLen)*3 {
		// 但对于很短的文本，允许更大的变化范围
		if originLen < 10 {
			return true
		}
		return false
	}

	return true
}

// isSpecialContent 检查是否是专有名词、数字等特殊内容
func (t *Translator) isSpecialContent(text string) bool {
	text = strings.TrimSpace(text)
	if len(text) == 0 {
		return false
	}

	// 检查是否主要包含数字、符号、英文名词等
	nonAlphaCount := 0
	for _, r := range text {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')) {
			nonAlphaCount++
		}
	}

	// 如果超过一半的字符不是字母，可能是特殊内容
	if float64(nonAlphaCount) > float64(len(text))*0.5 {
		return true
	}

	// 检查常见的专有名词模式
	commonProperNouns := []string{
		"Dr.", "Mr.", "Mrs.", "Ms.", "Prof.",
		"Andrew", "Huberman", "OpenAI", "ChatGPT", "YouTube",
	}

	textLower := strings.ToLower(text)
	for _, noun := range commonProperNouns {
		if strings.Contains(textLower, strings.ToLower(noun)) {
			return true
		}
	}

	return false
}

// hasTargetLanguageCharacteristics 检查文本是否具有目标语言特征
func (t *Translator) hasTargetLanguageCharacteristics(text string, targetLang types.StandardLanguageCode) bool {
	switch targetLang {
	case types.LanguageNameSimplifiedChinese, types.LanguageNameTraditionalChinese: // 中文
		// 检查是否包含中文字符
		for _, r := range text {
			if r >= '\u4e00' && r <= '\u9fff' { // 基本汉字范围
				return true
			}
		}
		return false

	case types.LanguageNameEnglish: // 英文
		// 检查是否主要包含拉丁字母
		letterCount := 0
		for _, r := range text {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
				letterCount++
			}
		}
		// 至少50%的字符应该是字母
		return float64(letterCount) >= float64(len(strings.ReplaceAll(text, " ", "")))*0.5

	case types.LanguageNameJapanese: // 日文
		// 检查是否包含平假名、片假名或汉字
		for _, r := range text {
			if (r >= '\u3040' && r <= '\u309f') || // 平假名
				(r >= '\u30a0' && r <= '\u30ff') || // 片假名
				(r >= '\u4e00' && r <= '\u9fff') { // 汉字
				return true
			}
		}
		return false

	default:
		// 对于其他语言，暂时返回true
		return true
	}
}

// enhanceTranslationPrompt 增强翻译提示词
func (t *Translator) enhanceTranslationPrompt(originalPrompt, originText, failedTranslation string, targetLang types.StandardLanguageCode) string {
	enhancement := fmt.Sprintf(`

IMPORTANT: The previous translation was inadequate. Please ensure:
1. Translate "%s" into %s (NOT the same as original text)
2. Previous failed attempt: "%s"
3. Provide a natural, accurate %s translation
4. Do NOT return the original text unchanged
5. Do NOT translate proper nouns like names, unless culturally appropriate

`, originText, types.GetStandardLanguageName(targetLang), failedTranslation, types.GetStandardLanguageName(targetLang))

	return originalPrompt + enhancement
}

// isSentenceEnding 判断文本是否以句子结束符号结尾
func isSentenceEnding(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}

	// 检查常见的句子结束符号
	sentenceEndings := []string{
		".", "?", "!", // 英文
		"。", "？", "！", // 中文
		"…", ".", "?", "!", // 日文
		"..", "...", // 省略号
	}

	for _, ending := range sentenceEndings {
		if strings.HasSuffix(text, ending) {
			return true
		}
	}

	return false
}

// BatchTranslateSrtBlocks 批量翻译SRT字幕块（智能分组：按完整句子分组，最多10个块）
func (t *Translator) BatchTranslateSrtBlocks(blocks []*util.SrtBlock, originLang, targetLang string, taskPtr *types.SubtitleTask) error {
	if len(blocks) == 0 {
		return nil
	}

	maxBatchSize := config.Conf.App.VttBatchSize
	if maxBatchSize <= 0 {
		maxBatchSize = 10 // 默认最大批次大小
	}

	originLangCode := types.StandardLanguageCode(originLang)
	targetLangCode := types.StandardLanguageCode(targetLang)

	// 统计有内容的字幕块数量
	validBlocksCount := 0
	for _, block := range blocks {
		if block.OriginLanguageSentence != "" {
			validBlocksCount++
		}
	}

	log.GetLogger().Info("开始智能批量翻译SRT字幕块",
		zap.Int("总块数", len(blocks)),
		zap.Int("有效块数", validBlocksCount),
		zap.Int("最大批次大小", maxBatchSize),
		zap.String("源语言", originLang),
		zap.String("目标语言", targetLang))

	// 第一步：按句子分组（识别完整句子）
	var sentences [][]*util.SrtBlock
	var currentSentence []*util.SrtBlock

	for _, block := range blocks {
		// 跳过空块
		if block.OriginLanguageSentence == "" {
			continue
		}

		currentSentence = append(currentSentence, block)

		// 兜底保证：即使没有句子结束符，也不能超过最大批次大小
		if len(currentSentence) >= maxBatchSize {
			log.GetLogger().Warn("句子累积达到最大批次大小，强制结束句子",
				zap.Int("当前块数", len(currentSentence)),
				zap.Int("最大批次大小", maxBatchSize))
			sentences = append(sentences, currentSentence)
			currentSentence = make([]*util.SrtBlock, 0)
			continue
		}

		// 遇到句子结尾，结束当前句子
		if isSentenceEnding(block.OriginLanguageSentence) {
			sentences = append(sentences, currentSentence)
			currentSentence = make([]*util.SrtBlock, 0)
		}
	}

	// 处理最后一个未结束的句子
	if len(currentSentence) > 0 {
		sentences = append(sentences, currentSentence)
	}

	log.GetLogger().Info("句子识别完成",
		zap.Int("识别到的句子数", len(sentences)))

	// 第二步：智能合并句子成批次（3/2/1策略）
	var batches [][]*util.SrtBlock
	i := 0

	for i < len(sentences) {
		// 策略1: 尝试合并3个句子
		if i+2 < len(sentences) {
			combined := make([]*util.SrtBlock, 0)
			combined = append(combined, sentences[i]...)
			combined = append(combined, sentences[i+1]...)
			combined = append(combined, sentences[i+2]...)

			// 确保合并后不超过最大批次大小
			if len(combined) > 0 && len(combined) <= maxBatchSize {
				batches = append(batches, combined)
				log.GetLogger().Debug("合并3个句子",
					zap.Int("批次块数", len(combined)),
					zap.Int("句子索引", i))
				i += 3
				continue
			}
		}

		// 策略2: 尝试合并2个句子
		if i+1 < len(sentences) {
			combined := make([]*util.SrtBlock, 0)
			combined = append(combined, sentences[i]...)
			combined = append(combined, sentences[i+1]...)

			// 确保合并后不超过最大批次大小
			if len(combined) > 0 && len(combined) <= maxBatchSize {
				batches = append(batches, combined)
				log.GetLogger().Debug("合并2个句子",
					zap.Int("批次块数", len(combined)),
					zap.Int("句子索引", i))
				i += 2
				continue
			}
		}

		// 策略3: 单个句子
		// 确保单个句子不超过最大批次大小
		if len(sentences[i]) > 0 && len(sentences[i]) <= maxBatchSize {
			batches = append(batches, sentences[i])
			log.GetLogger().Debug("单个句子",
				zap.Int("批次块数", len(sentences[i])),
				zap.Int("句子索引", i))
			i++
		} else {
			// 如果单个句子超过最大批次大小，需要拆分
			log.GetLogger().Warn("单个句子超过最大批次大小，强制拆分",
				zap.Int("句子块数", len(sentences[i])),
				zap.Int("最大批次大小", maxBatchSize))

			for j := 0; j < len(sentences[i]); j += maxBatchSize {
				end := j + maxBatchSize
				if end > len(sentences[i]) {
					end = len(sentences[i])
				}
				batches = append(batches, sentences[i][j:end])
			}
			i++
		}
	}

	totalBatches := len(batches)

	// 统计合并策略使用情况
	var totalBlocks int
	for _, batch := range batches {
		totalBlocks += len(batch)
	}

	log.GetLogger().Info("智能分组完成",
		zap.Int("总句子数", len(sentences)),
		zap.Int("总批次数", totalBatches),
		zap.String("平均每批次", fmt.Sprintf("%.1f个块", float64(totalBlocks)/float64(max(totalBatches, 1)))),
		zap.String("分组策略", "3/2/1句子合并策略，最大"+fmt.Sprintf("%d", maxBatchSize)+"个块"))

	// 分批处理
	for batchIdx, batch := range batches {
		currentBatchNum := batchIdx + 1
		log.GetLogger().Info("处理批次",
			zap.Int("当前批次", currentBatchNum),
			zap.Int("总批次", totalBatches),
			zap.Int("批次块数", len(batch)),
			zap.String("进度", fmt.Sprintf("%d/%d", currentBatchNum, totalBatches)))

		// 构建批量翻译的输入文本
		var originTexts []string
		for _, block := range batch {
			if block.OriginLanguageSentence != "" {
				originTexts = append(originTexts, block.OriginLanguageSentence)
			}
		}

		if len(originTexts) == 0 {
			continue
		}

		// 调用批量翻译
		translations, err := t.batchTranslateTexts(originTexts, originLangCode, targetLangCode)
		if err != nil {
			log.GetLogger().Error("批量翻译失败，尝试单独翻译",
				zap.Error(err),
				zap.Int("当前批次", currentBatchNum),
				zap.Int("总批次", totalBatches),
				zap.Int("批次块数", len(batch)))

			// 失败时回退到单独翻译每个字幕
			for _, block := range batch {
				if block.OriginLanguageSentence == "" {
					continue
				}

				log.GetLogger().Info("单独翻译字幕",
					zap.Int("块索引", block.Index),
					zap.String("文本预览", block.OriginLanguageSentence[:min(len(block.OriginLanguageSentence), 50)]))

				translatedText, err := t.translateSingleText(
					block.OriginLanguageSentence,
					originLangCode,
					targetLangCode)

				if err != nil {
					log.GetLogger().Error("单独翻译失败，使用原文",
						zap.Error(err),
						zap.Int("块索引", block.Index))
					block.TargetLanguageSentence = block.OriginLanguageSentence
				} else {
					block.TargetLanguageSentence = translatedText
				}
			}

			// 更新任务进度
			if taskPtr != nil {
				progress := float64(currentBatchNum) / float64(totalBatches)
				taskPtr.SetProgress(40 + uint8(progress*50))
			}
			continue
		}

		log.GetLogger().Info("批量翻译成功",
			zap.Int("当前批次", currentBatchNum),
			zap.Int("翻译数量", len(translations)))

		// 将翻译结果赋值回SRT块
		for j, translation := range translations {
			if j < len(batch) {
				batch[j].TargetLanguageSentence = translation
			}
		}

		// 更新任务进度（假设翻译占总进度的50%）
		if taskPtr != nil {
			progress := float64(currentBatchNum) / float64(totalBatches)
			// 假设翻译在40%-90%之间
			taskPtr.SetProgress(40 + uint8(progress*50))
		}
	}

	log.GetLogger().Info("智能批量翻译完成",
		zap.Int("总块数", len(blocks)),
		zap.Int("处理批次", totalBatches),
		zap.String("平均每批次", fmt.Sprintf("%.1f个块", float64(validBlocksCount)/float64(max(totalBatches, 1)))))
	return nil
}

// batchTranslateTexts 批量翻译多个文本（通过单次LLM调用）
func (t *Translator) batchTranslateTexts(texts []string, originLang, targetLang types.StandardLanguageCode) ([]string, error) {
	if len(texts) == 0 {
		return []string{}, nil
	}

	// 构建批量翻译提示词
	var textList strings.Builder
	for i, text := range texts {
		textList.WriteString(fmt.Sprintf("%d. %s\n", i+1, text))
	}

	// 构建语言说明，如果是中文特别强调简体
	targetLangName := types.GetStandardLanguageName(targetLang)
	if targetLang == "zh" || string(targetLang) == "Chinese" {
		targetLangName = "Simplified Chinese (简体中文)"
	}

	prompt := fmt.Sprintf(`You are a professional subtitle translator. Translate the following %d subtitles from %s to %s.

CRITICAL INSTRUCTIONS:
1. DO NOT modify, add, or remove any content from the original text - translate ONLY
2. Translate naturally and fluently in %s
3. If target language is Chinese, MUST use Simplified Chinese characters (简体中文), NOT Traditional Chinese (繁体中文)
4. Maintain the exact same number of subtitles (%d items)
5. Preserve punctuation and formatting exactly as they appear
6. Keep proper nouns, numbers, and special terms accurate
7. Do NOT add explanations, interpretations, or extra information
8. Output ONLY valid JSON, NO markdown code blocks, NO explanations, NO notes
9. Start directly with { and end with }

Input subtitles:
%s

Required JSON format (output ONLY this structure):
{"translations":[{"index":1,"text":"译文1"},{"index":2,"text":"译文2"}]}`,
		len(texts),
		types.GetStandardLanguageName(originLang),
		targetLangName,
		targetLangName,
		len(texts),
		textList.String())

	// 调用LLM
	maxAttempts := 3
	var lastErr error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		log.GetLogger().Info("调用LLM翻译",
			zap.Int("文本数", len(texts)),
			zap.Int("尝试次数", attempt+1))

		response, err := t.chatCompleter.ChatCompletion(prompt)
		if err != nil {
			lastErr = err
			log.GetLogger().Warn("批量翻译LLM调用失败，重试",
				zap.Error(err),
				zap.Int("尝试次数", attempt+1))
			time.Sleep(time.Second * time.Duration(attempt+1))
			continue
		}

		log.GetLogger().Info("LLM返回响应",
			zap.Int("响应长度", len(response)))

		// 解析JSON响应
		cleanResponse := util.ExtractJSONObject(response, "translations")

		var result struct {
			Translations []struct {
				Index int    `json:"index"`
				Text  string `json:"text"`
			} `json:"translations"`
		}

		if err := json.Unmarshal([]byte(cleanResponse), &result); err != nil {
			lastErr = fmt.Errorf("解析JSON失败: %w", err)
			if attempt == 0 {
				// 只在第一次失败时记录完整响应
				log.GetLogger().Warn("解析批量翻译响应失败，重试",
					zap.Error(err),
					zap.Int("尝试次数", attempt+1),
					zap.String("清理后响应", cleanResponse[:min(len(cleanResponse), 500)]))
			} else {
				log.GetLogger().Warn("解析批量翻译响应失败，重试",
					zap.Error(err),
					zap.Int("尝试次数", attempt+1))
			}
			continue
		}

		// 验证结果数量
		if len(result.Translations) != len(texts) {
			lastErr = fmt.Errorf("翻译结果数量不匹配: 期望 %d, 实际 %d", len(texts), len(result.Translations))
			log.GetLogger().Warn("翻译结果数量不匹配，重试",
				zap.Error(lastErr),
				zap.Int("尝试次数", attempt+1))
			continue
		}

		// 提取翻译结果
		translations := make([]string, len(texts))
		for _, trans := range result.Translations {
			if trans.Index > 0 && trans.Index <= len(texts) {
				translations[trans.Index-1] = strings.TrimSpace(trans.Text)
			}
		}

		return translations, nil
	}

	return nil, fmt.Errorf("批量翻译失败，已重试%d次: %w", maxAttempts, lastErr)
}

// translateSingleText 翻译单个文本（用作批量翻译失败时的回退）
func (t *Translator) translateSingleText(text string, originLang, targetLang types.StandardLanguageCode) (string, error) {
	prompt := fmt.Sprintf(types.SplitTextPrompt, types.GetStandardLanguageName(targetLang), text)

	translatedText, err := t.translateWithRetry(prompt, text, originLang, targetLang)
	if err != nil {
		return "", fmt.Errorf("单文本翻译失败: %w", err)
	}

	return translatedText, nil
}
