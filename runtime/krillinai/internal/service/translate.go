package service

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/openai"
	"krillin-ai/pkg/util"
	"strings"
	"time"
	"unicode"

	"go.uber.org/zap"
)

type Translator struct {
	chatCompleter            types.ChatCompleter
	filterNonSemanticFillers bool
	checkpointDir            string
	onRecovery               func(string)
	recoveryDelay            time.Duration
	onRateLimit              func()
}

func NewTranslator() *Translator {
	return &Translator{
		chatCompleter: openai.NewClient(config.Conf.Llm.BaseUrl, config.Conf.Llm.ApiKey, config.Conf.App.Proxy),
	}
}

func (t *Translator) SplitTextAndTranslate(inputText string, originLang, targetLang types.StandardLanguageCode) ([]*TranslatedItem, error) {
	sentences := splitTranslationSentences(inputText)
	paired, err := t.translatePairedSentences(context.Background(), sentences, originLang, targetLang, subtitleTargetLimit(), 3, nil)
	if err != nil {
		return nil, err
	}
	return flattenPairedSentences(paired), nil
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
		if len(splitResult.ShortSentences) == 0 {
			err = fmt.Errorf("splitOriginLongSentence returned no sentences")
			continue
		}

		shortSentences = shortSentences[:0]
		for _, shortSentence := range splitResult.ShortSentences {
			// 清理文本，移除多余的引号
			cleanText := strings.TrimSpace(shortSentence.Text)
			cleanText = strings.Trim(cleanText, `"'`)
			if cleanText == "" {
				err = fmt.Errorf("splitOriginLongSentence returned an empty sentence")
				break
			}
			shortSentences = append(shortSentences, cleanText)
		}
		if err != nil {
			continue
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
	originText = strings.Join(strings.Fields(originText), " ")
	translatedText = strings.Join(strings.Fields(translatedText), " ")
	if translatedText == "" {
		return false
	}
	if originLang == targetLang {
		return true
	}
	if strings.EqualFold(originText, translatedText) {
		return t.isSpecialContent(originText)
	}

	return t.hasTargetLanguageCharacteristics(translatedText, targetLang)
}

// isSpecialContent 检查是否是专有名词、数字等特殊内容
func (t *Translator) isSpecialContent(text string) bool {
	text = strings.TrimSpace(text)
	if len(text) == 0 {
		return false
	}

	letterCount := 0
	allUpper := true
	for _, r := range text {
		if unicode.IsLetter(r) {
			letterCount++
			if r < 'A' || r > 'Z' {
				allUpper = false
			}
		}
	}
	if letterCount == 0 {
		return true
	}
	if allUpper && letterCount >= 2 && letterCount <= 10 && len(strings.Fields(text)) == 1 {
		return true
	}

	// 仅允许完整的已知专名；句子包含专名不代表整句可以不翻译。
	commonProperNouns := []string{
		"Dr.", "Mr.", "Mrs.", "Ms.", "Prof.",
		"Andrew", "Huberman", "OpenAI", "ChatGPT", "YouTube",
	}
	trimPunctuation := func(r rune) bool { return unicode.IsPunct(r) || unicode.IsSpace(r) }
	for _, word := range strings.Fields(text) {
		known := false
		for _, noun := range commonProperNouns {
			if strings.EqualFold(strings.TrimFunc(word, trimPunctuation), strings.TrimFunc(noun, trimPunctuation)) {
				known = true
				break
			}
		}
		if !known {
			return false
		}
	}
	return true
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

func subtitleTranslationContext(blocks []*util.SrtBlock, start, end int) ([]string, []string) {
	var previousTexts, nextTexts []string
	for _, block := range blocks[max(0, start-2):start] {
		previousTexts = append(previousTexts, block.OriginLanguageSentence)
	}
	for _, block := range blocks[end:min(len(blocks), end+2)] {
		nextTexts = append(nextTexts, block.OriginLanguageSentence)
	}
	return previousTexts, nextTexts
}

// batchTranslateTexts 批量翻译多个文本（通过单次LLM调用）
func (t *Translator) batchTranslateTexts(texts []string, originLang, targetLang types.StandardLanguageCode) ([]string, error) {
	return t.batchTranslateTextsContext(context.Background(), texts, originLang, targetLang)
}

func (t *Translator) batchTranslateTextsContext(ctx context.Context, texts []string, originLang, targetLang types.StandardLanguageCode) ([]string, error) {
	return t.batchTranslateTextsRequest(ctx, texts, originLang, targetLang, nil, nil)
}

func (t *Translator) batchTranslateTextsWithContext(texts []string, originLang, targetLang types.StandardLanguageCode, previousTexts, nextTexts []string) ([]string, error) {
	return t.batchTranslateTextsRequest(context.Background(), texts, originLang, targetLang, previousTexts, nextTexts)
}

func (t *Translator) batchTranslateTextsRequest(ctx context.Context, texts []string, originLang, targetLang types.StandardLanguageCode, previousTexts, nextTexts []string) ([]string, error) {
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
	if targetLang == types.LanguageNameSimplifiedChinese || targetLang == "zh" || string(targetLang) == "Chinese" {
		targetLangName = "Simplified Chinese (简体中文)"
	}

	prompt := fmt.Sprintf(`You are a professional subtitle translator. Translate the following %d subtitles from %s to %s.

CRITICAL INSTRUCTIONS:
1. DO NOT modify, add, or remove any content from the original text - translate ONLY
2. Translate naturally and fluently in %s
3. For Simplified Chinese, use 简体中文; for Traditional Chinese, use 繁體中文
4. Maintain the exact same number of subtitles (%d items)
5. Preserve punctuation and formatting exactly as they appear
6. Keep proper nouns, numbers, and special terms accurate
7. Do NOT add explanations, interpretations, or extra information
8. Output ONLY valid JSON, NO markdown code blocks, NO explanations, NO notes
9. Start directly with { and end with }
10. Each input index MUST appear exactly once with non-empty translated text; never merge or move content to another index
11. Use the surrounding context to resolve references and keep terminology consistent; translate ONLY the numbered input subtitles
12. Each index has its own video timestamp. Translate each fragment at its original index, even if target-language word order differs. Never move a time phrase or other meaning to another index, and never replace spoken words with only punctuation

Previous context (reference only, do NOT include in output):
%s

Following context (reference only, do NOT include in output):
%s

Input subtitles:
%s

Required JSON format (output ONLY this structure):
{"translations":[{"index":1,"text":"译文1"},{"index":2,"text":"译文2"}]}`,
		len(texts),
		types.GetStandardLanguageName(originLang),
		targetLangName,
		targetLangName,
		len(texts),
		strings.Join(previousTexts, "\n"),
		strings.Join(nextTexts, "\n"),
		textList.String())

	// 调用LLM
	maxAttempts := 3
	var lastErr error
	requestPrompt := prompt

	for attempt := 0; attempt < maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		log.GetLogger().Info("调用LLM翻译",
			zap.Int("文本数", len(texts)),
			zap.Int("尝试次数", attempt+1))

		response, err := chatCompletionWithContext(ctx, t.chatCompleter, requestPrompt)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			lastErr = err
			log.GetLogger().Warn("批量翻译LLM调用失败，重试",
				zap.Error(err),
				zap.Int("尝试次数", attempt+1))
			if attempt < maxAttempts-1 {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(time.Second * time.Duration(attempt+1)):
				}
			}
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
		var invalidResultErr error
		for _, trans := range result.Translations {
			if trans.Index <= 0 || trans.Index > len(texts) || translations[trans.Index-1] != "" || strings.TrimSpace(trans.Text) == "" {
				invalidResultErr = fmt.Errorf("翻译结果包含无效索引或空文本: %d", trans.Index)
				break
			}
			// 空行会被 SRT 解析器当成字幕块边界，统一为单行文本。
			translation := strings.Join(strings.Fields(trans.Text), " ")
			if !t.isTranslationValid(texts[trans.Index-1], translation, originLang, targetLang) {
				invalidResultErr = fmt.Errorf("第%d条译文未通过检查（原文未翻译、仅标点或目标语言不符）: 原文=%q, 译文=%q", trans.Index, texts[trans.Index-1], translation)
				break
			}
			translations[trans.Index-1] = translation
		}
		if invalidResultErr != nil {
			lastErr = invalidResultErr
			log.GetLogger().Warn("批量翻译结果无效", zap.Error(lastErr), zap.Int("尝试次数", attempt+1))
			requestPrompt = prompt + fmt.Sprintf("\nRETRY CORRECTION: The previous response failed validation: %s. Translate the source fragment at the SAME index; do not move its meaning to a neighboring subtitle or use a blank/punctuation-only placeholder. Return the COMPLETE corrected JSON for all %d input subtitles.\n", invalidResultErr, len(texts))
			continue
		}

		return translations, nil
	}

	return nil, fmt.Errorf("批量翻译失败，已尝试%d次: %w", maxAttempts, lastErr)
}

// translateSingleText 通过结构化接口翻译单个文本。
func (t *Translator) translateSingleText(text string, originLang, targetLang types.StandardLanguageCode) (string, error) {
	return t.translateSingleTextContext(context.Background(), text, originLang, targetLang)
}

func (t *Translator) translateSingleTextContext(ctx context.Context, text string, originLang, targetLang types.StandardLanguageCode) (string, error) {
	translations, err := t.batchTranslateTextsContext(ctx, []string{text}, originLang, targetLang)
	if err != nil {
		return "", fmt.Errorf("单文本翻译失败: %w", err)
	}
	return translations[0], nil
}
