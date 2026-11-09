package dubbing

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"strings"
	"unicode"
	"unicode/utf8"
)

type LLMOptimizer struct {
	chat             types.ChatCompleter
	targetLanguage   types.StandardLanguageCode
	maxSubtitleChars int
}

func NewLLMOptimizer(chat types.ChatCompleter, targetLanguage types.StandardLanguageCode, maxChars ...int) *LLMOptimizer {
	limit := DefaultMaxSubtitleChars
	if len(maxChars) > 0 && maxChars[0] > 0 {
		limit = maxChars[0]
	}
	return &LLMOptimizer{chat: chat, targetLanguage: targetLanguage, maxSubtitleChars: limit}
}

// ShouldMergeForTiming decides whether two timed captions are one unfinished
// spoken thought. The runner separately verifies measured timing and length.
func (o *LLMOptimizer) ShouldMergeForTiming(ctx context.Context, left, right PlanItem) (bool, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return false, err
		}
	}
	if o == nil || o.chat == nil {
		return false, nil
	}
	prompt := fmt.Sprintf(`判断下面相邻的两条字幕合在一个配音单元中是否更自然。
程序已根据实测配音时长确认存在时间问题；你只判断语义和自然停顿。只有两段属于同一个未完意群，或者第二段是极短的动作延续、重复指令，明确依赖前一句，即使前一句有句号，连起来口播更自然时才回答 true。两段目标语原样连读后还必须语法通顺、意思完整；若缺少必要谓语或衔接词、重复同一意思，或与源语事实冲突，回答 false。两个各自完整且独立的句子、话题相关但并无指代依赖，或两段之间有明显停顿，必须回答 false。不要因为字幕短就合并，不要改写任何文本。
只输出 JSON：{"merge":true} 或 {"merge":false}
目标语言：%s（%s）
两段间隔：%.3f 秒
第一段源语：%s
第一段目标语：%s
第二段源语：%s
第二段目标语：%s`, types.GetStandardLanguageName(o.targetLanguage), o.targetLanguage, right.OriginalStart-left.OriginalEnd, left.SourceText, left.SpokenText, right.SourceText, right.SpokenText)
	response, err := o.chat.ChatCompletion(prompt)
	if err != nil {
		return false, err
	}
	var output struct {
		Merge bool `json:"merge"`
	}
	if err := json.Unmarshal([]byte(util.ExtractJSONObject(response, "merge")), &output); err != nil {
		return false, err
	}
	return output.Merge, nil
}

func (o *LLMOptimizer) Optimize(ctx context.Context, text string, availableSeconds float64, reason string) (string, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return "", err
		}
	}
	if o == nil || o.chat == nil {
		return text, nil
	}
	prompt := fmt.Sprintf(`请尽量把下面字幕改写成更短、更适合口播的一句话。
要求：
1. 完整保留原意、句子功能和语气，不添加新事实。改写后必须仍是能独立听懂的自然表达；不要把完整动作缩成单个副词或语气词。
2. 目标语言是 %s（%s）；只用该语言改写，不要翻译成其他语言，不要解释。
3. 输出单行纯文本，且不得超过 %d 个 Unicode 字素簇。
4. 尽量适合 %.1f 秒内自然朗读；如无法在保留原意和自然表达的前提下缩短，原样返回当前字幕。不要为满足时长删掉必要词。
触发原因：%s

字幕：
%s`, types.GetStandardLanguageName(o.targetLanguage), o.targetLanguage, o.subtitleLimit(), availableSeconds, reason, text)
	resp, err := o.chat.ChatCompletion(prompt)
	if err != nil {
		return "", err
	}
	resp = normalizeOptimizerResponse(resp)
	if resp == "" {
		return text, nil
	}
	if subtitleLength(resp) > o.subtitleLimit() {
		return "", fmt.Errorf("optimized subtitle exceeds %d characters", o.subtitleLimit())
	}
	if err := o.validateRewriteLanguage(text, resp); err != nil {
		return "", err
	}
	return resp, nil
}

// OptimizeWithSource keeps the original source-aware optimizer contract for
// callers that do not have a measured TTS duration yet. The measured runner
// uses OptimizeWithSourceMeasured below.
func (o *LLMOptimizer) OptimizeWithSource(ctx context.Context, sourceText, targetText string, availableSeconds float64, reason string) (string, error) {
	return o.optimizeWithSource(ctx, sourceText, targetText, availableSeconds, availableSeconds, reason, false, RewriteContext{})
}

// OptimizeWithSourceMeasured uses the immutable source transcript as semantic
// context while rewriting only the target-language speech text. actualSeconds
// is the measured duration of the current target TTS, not the subtitle window.
func (o *LLMOptimizer) OptimizeWithSourceMeasured(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string) (string, error) {
	return o.optimizeWithSource(ctx, sourceText, targetText, availableSeconds, actualSeconds, reason, true, RewriteContext{})
}

func (o *LLMOptimizer) OptimizeWithSourceMeasuredContext(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string, surrounding RewriteContext) (string, error) {
	return o.optimizeWithSource(ctx, sourceText, targetText, availableSeconds, actualSeconds, reason, true, surrounding)
}

func (o *LLMOptimizer) optimizeWithSource(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string, requireShorter bool, surrounding RewriteContext) (string, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return "", err
		}
	}
	if o == nil || o.chat == nil {
		return targetText, nil
	}
	targetText = normalizeOptimizerText(targetText)
	sourceText = normalizeOptimizerText(sourceText)
	originalTarget := normalizeOptimizerText(surrounding.OriginalTarget)
	if originalTarget == "" {
		originalTarget = targetText
	}
	if availableSeconds <= 0 {
		return "", fmt.Errorf("source-aware rewrite has invalid time slot %.3fs", availableSeconds)
	}
	if actualSeconds <= 0 {
		return "", fmt.Errorf("source-aware rewrite has invalid measured duration %.3fs", actualSeconds)
	}
	overrun := actualSeconds - availableSeconds
	overrunRatio := actualSeconds / availableSeconds
	prompt := fmt.Sprintf(`你是视频配音字幕改写助手。当前目标语言 TTS 已经实测超出时间槽，请尝试把目标语言改写得更简洁、更自然。

硬约束：
1. 源语言转录是只读事实依据。禁止改写、纠正、翻译、删减或输出源语言；只允许修改“目标语言配音字幕”。
2. 先连读前后文，理解当前字幕在整句中的作用。完整保留源语言中的意思、动作及其次数和顺序、事实、数字、单位、专有名词、否定、条件、因果和语气，不得添加信息；惯用语按上下文含义表达，不能逐词直译。特别注意重复动作必须明确保留首次和再次，例如“test yourself, then test again”必须表达“先自测，再测一次”，不能只写“再自测一次”。也要区分将要做的事与已经做过的事：如果前文说“只被告知将要教”，本段不能改成“教过”，即使下一段还会说他们其实没教过。当前字幕若是未完句，应与相邻字幕衔接自然，不要强行把它改成独立句；不能把完整指令缩成单个副词，例如不能把“重复。”改成“再”。
3. 目标语言是 %s（%s）；只用该语言改写为自然的口语表达，不要翻译成其他语言。单行输出，且不得超过 %d 个 Unicode 字素簇；不得使用变速、加速朗读、停顿标记、SSML、解释文字或括号说明来规避时长。
4. 时间槽 %.3f 秒是尽量接近的目标；当前 TTS 实测 %.3f 秒，超出 %.3f 秒（%.1fx）。原始目标译文是每次重试的固定参照，但若它与源语言冲突，以源语言和上下文为准。先保证意思准确和表达完整，再尝试缩短。若无法在不损失意思和自然度的前提下缩短，必须原样返回当前目标文本；程序会处理剩余的时长差。
5. 压缩时优先删除不影响意思的填充词和重复修饰，或换用更简洁的本地化口语句式。不要删掉必要的谓语、宾语、动作和逻辑关系；例如“巩固记忆”不能缩成缺宾语的“然后巩固”。不要为了凑时长把句子改成不完整的片段。
6. 只输出 JSON，不要 Markdown 或任何解释：{"target_text":"..."}

触发原因：%s
当前目标文本字符数：%d（硬上限：%d）

源语言转录（只读）：
%s

上一条（只读语境，不能合并或改写）：
源语：%s
目标语：%s

原始目标译文（只读参照）：
%s

当前目标语言配音字幕（仅可改写这一段）：
%s

下一条（只读语境，不能合并或改写）：
源语：%s
目标语：%s`, types.GetStandardLanguageName(o.targetLanguage), o.targetLanguage, o.subtitleLimit(), availableSeconds, actualSeconds, overrun, overrunRatio, reason, subtitleLength(targetText), o.subtitleLimit(), sourceText, normalizeOptimizerText(surrounding.PreviousSource), normalizeOptimizerText(surrounding.PreviousTarget), originalTarget, targetText, normalizeOptimizerText(surrounding.NextSource), normalizeOptimizerText(surrounding.NextTarget))
	resp, err := o.chat.ChatCompletion(prompt)
	if err != nil {
		return "", err
	}
	var output struct {
		Target string `json:"target_text"`
	}
	if err := json.Unmarshal([]byte(util.ExtractJSONObject(resp, "target_text")), &output); err != nil {
		return "", fmt.Errorf("parse target subtitle rewrite with source context: %w", err)
	}
	output.Target = normalizeOptimizerText(output.Target)
	if output.Target == "" {
		return "", fmt.Errorf("target subtitle rewrite returned empty text")
	}
	if subtitleLength(output.Target) > o.subtitleLimit() {
		return "", fmt.Errorf("target subtitle rewrite exceeds %d characters", o.subtitleLimit())
	}
	if err := o.validateRewriteLanguage(targetText, output.Target); err != nil {
		return "", err
	}
	if requireShorter && !optimizerTextIsShorter(output.Target, targetText) {
		return "", fmt.Errorf("target subtitle rewrite did not shorten text")
	}
	return output.Target, nil
}

func (o *LLMOptimizer) validateRewriteLanguage(current, candidate string) error {
	if o.targetLanguage != types.LanguageNameSimplifiedChinese && o.targetLanguage != types.LanguageNameTraditionalChinese {
		return nil
	}
	hasHan := func(r rune) bool { return unicode.Is(unicode.Han, r) }
	if strings.IndexFunc(current, hasHan) >= 0 && strings.IndexFunc(candidate, hasHan) < 0 {
		return fmt.Errorf("target subtitle rewrite lost Chinese text")
	}
	return nil
}

func (o *LLMOptimizer) subtitleLimit() int {
	if o != nil && o.maxSubtitleChars > 0 {
		return o.maxSubtitleChars
	}
	return DefaultMaxSubtitleChars
}

func optimizerTextIsShorter(candidate, current string) bool {
	return utf8.RuneCountInString(normalizeOptimizerText(candidate)) < utf8.RuneCountInString(normalizeOptimizerText(current))
}

func normalizeOptimizerText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.ReplaceAll(text, "\r", " ")
	text = strings.ReplaceAll(text, "\n", " ")
	return strings.Join(strings.Fields(text), " ")
}

func normalizeOptimizerResponse(response string) string {
	response = strings.TrimSpace(response)
	var output struct {
		Target string `json:"target_text"`
	}
	extracted := util.ExtractJSONObject(response, "target_text")
	if err := json.Unmarshal([]byte(extracted), &output); err == nil && strings.TrimSpace(output.Target) != "" {
		response = output.Target
	}
	return normalizeOptimizerText(response)
}
