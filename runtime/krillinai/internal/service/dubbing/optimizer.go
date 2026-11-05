package dubbing

import (
	"context"
	"encoding/json"
	"fmt"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/util"
	"strings"
	"unicode/utf8"
)

type LLMOptimizer struct {
	chat types.ChatCompleter
}

func NewLLMOptimizer(chat types.ChatCompleter) *LLMOptimizer {
	return &LLMOptimizer{chat: chat}
}

type mergeCueInput struct {
	ID       int     `json:"cue_id"`
	Start    float64 `json:"start"`
	End      float64 `json:"end"`
	Text     string  `json:"text"`
	Eligible bool    `json:"merge_eligible"`
}

type mergeCueOutput struct {
	Groups [][]int `json:"groups"`
}

// Merge asks the model only for semantic boundaries. Timing and adjacency
// constraints are checked again by Planner before any audio is generated.
func (o *LLMOptimizer) Merge(ctx context.Context, cues []Cue, language types.StandardLanguageCode, minDuration, gapTolerance float64, maxGroupSize int) ([][]int, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
	}
	groups := make([][]int, len(cues))
	for i := range cues {
		groups[i] = []int{i}
	}
	if o == nil || o.chat == nil || len(cues) < 2 {
		return groups, nil
	}
	input := make([]mergeCueInput, 0, len(cues))
	mergePossible := false
	for _, cue := range cues {
		input = append(input, mergeCueInput{
			ID: cue.Index, Start: cue.Start, End: cue.End, Text: CleanTextForSpeech(cue.Text),
			Eligible: cue.Duration() <= minDuration,
		})
	}
	for i := 1; i < len(input); i++ {
		if input[i-1].Eligible && input[i].Eligible && cues[i].Start-cues[i-1].End <= gapTolerance {
			mergePossible = true
			break
		}
	}
	if !mergePossible {
		return groups, nil
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	prompt := fmt.Sprintf(`判断相邻字幕是否属于同一个连续语义意群，并决定是否合并成一个配音单元。
要求：
1. 只合并 merge_eligible=true 的相邻字幕；相邻字幕必须语义连续、属于同一句或同一意群，合并后口播要更自然。
2. 不要因为字幕很短就强行合并。遇到句号、问号、明显转折、说话停顿、换说话人或独立回答时保持分开。
3. 每组最多 %d 条，组内 cue_id 必须连续。gap 超过 %.2f 秒的字幕不得合并。
4. 输出所有字幕，未合并的字幕也要作为单元素数组返回，顺序不能改变。
5. 只输出 JSON，不要解释：{"groups":[[cue_id,...], ...]}
目标语言：%s
字幕数据：
%s`, maxGroupSize, gapTolerance, types.GetStandardLanguageName(language), payload)
	response, err := o.chat.ChatCompletion(prompt)
	if err != nil {
		return nil, err
	}
	var output mergeCueOutput
	if err := json.Unmarshal([]byte(util.ExtractJSONObject(response, "groups")), &output); err != nil {
		return nil, err
	}
	if len(output.Groups) == 0 {
		return nil, fmt.Errorf("semantic merge returned no groups")
	}
	indexByID := make(map[int]int, len(cues))
	for i, cue := range cues {
		indexByID[cue.Index] = i
	}
	for i := range output.Groups {
		for j, id := range output.Groups[i] {
			index, ok := indexByID[id]
			if !ok {
				return nil, fmt.Errorf("semantic merge returned unknown cue %d", id)
			}
			output.Groups[i][j] = index
		}
	}
	return output.Groups, nil
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
	prompt := fmt.Sprintf(`请把下面字幕改写成更自然、更短、 更适合口播的一句话。
要求：
1. 保留核心含义，不添加新事实。
2. 输出目标语言文本，不要解释。
3. 输出单行纯文本。
4. 适合 %.1f 秒内自然朗读，必须明显短于当前文本。
触发原因：%s

字幕：
%s`, availableSeconds, reason, text)
	resp, err := o.chat.ChatCompletion(prompt)
	if err != nil {
		return "", err
	}
	resp = normalizeOptimizerResponse(resp)
	if resp == "" {
		return text, nil
	}
	return resp, nil
}

// OptimizeWithSource keeps the original source-aware optimizer contract for
// callers that do not have a measured TTS duration yet. The measured runner
// uses OptimizeWithSourceMeasured below.
func (o *LLMOptimizer) OptimizeWithSource(ctx context.Context, sourceText, targetText string, availableSeconds float64, reason string) (string, error) {
	return o.optimizeWithSource(ctx, sourceText, targetText, availableSeconds, availableSeconds, reason, false)
}

// OptimizeWithSourceMeasured uses the immutable source transcript as semantic
// context while rewriting only the target-language speech text. actualSeconds
// is the measured duration of the current target TTS, not the subtitle window.
func (o *LLMOptimizer) OptimizeWithSourceMeasured(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string) (string, error) {
	return o.optimizeWithSource(ctx, sourceText, targetText, availableSeconds, actualSeconds, reason, true)
}

func (o *LLMOptimizer) optimizeWithSource(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string, requireShorter bool) (string, error) {
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
	if availableSeconds <= 0 {
		return "", fmt.Errorf("source-aware rewrite has invalid time slot %.3fs", availableSeconds)
	}
	if actualSeconds <= 0 {
		return "", fmt.Errorf("source-aware rewrite has invalid measured duration %.3fs", actualSeconds)
	}
	overrun := actualSeconds - availableSeconds
	overrunRatio := actualSeconds / availableSeconds
	prompt := fmt.Sprintf(`你是视频配音字幕压缩器。当前目标语言 TTS 已经实测超出时间槽，请只把目标语言改写成更短、更自然、能在时间槽内正常语速说完的口播文案。

硬约束：
1. 源语言转录是只读事实依据。禁止改写、纠正、翻译、删减或输出源语言；只允许修改“目标语言配音字幕”。
2. 保留源语言中的核心含义、事实、数字、单位、专有名词、否定、条件、因果和语气，不得添加信息。
3. 目标语言必须是自然的口语表达，单行输出；不得使用变速、加速朗读、停顿标记、SSML、解释文字或括号说明来规避时长。
4. 时间槽是硬上限：目标文本必须按正常语速在 %.3f 秒内说完。当前 TTS 实测 %.3f 秒，超出 %.3f 秒（%.1fx），所以返回的目标文本必须比当前文本明显更短；不能原样返回，也不能只换同义词维持相近长度。
5. 压缩顺序：删除非语义填充词和重复修饰；改用更短的本地化口语句式；合并不影响事实的重复表达。不要删掉任何事实或逻辑关系。即使时间很紧，也要返回最短的自然、完整目标语句。
6. 只输出 JSON，不要 Markdown 或任何解释：{"target_text":"..."}

触发原因：%s
当前目标文本字符数：%d

源语言转录（只读）：
%s

当前目标语言配音字幕（仅可改写这一段）：
%s`, availableSeconds, actualSeconds, overrun, overrunRatio, reason, utf8.RuneCountInString(targetText), sourceText, targetText)
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
	if requireShorter && !optimizerTextIsShorter(output.Target, targetText) {
		return "", fmt.Errorf("target subtitle rewrite did not shorten text")
	}
	return output.Target, nil
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
