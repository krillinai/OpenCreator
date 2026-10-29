package types

import subtitlestyle "krillin-ai/internal/subtitle_style"

// var SplitTextPrompt = `你是一个英语处理专家，擅长翻译成%s和处理英文文本，根据句意和标点对句子进行拆分。

// - 不要漏掉原英文任何一个单词
// - 翻译一定要流畅，完整表达原文意思
// - 优先根据标点符号进行拆分，遇到逗号、句号、问号，一定要拆分，必须把句子拆短些。
// - 遇到定语从句、并列句等复杂句式，根据连词（如and, but, which, when）进行拆分。
// - 拆分后的单行句子英文不能超过15个单词。
// - 翻译的时候确保每个原始字幕块单独存在且编号和格式正确。
// - 不需要任何额外的话语，直接按下面格式输出结果。

// 1
// [中文翻译]
// [英文句子]

// 2
// [中文翻译]
// [英文句子]

// 内容如下:`

var SplitTextPrompt = `你是一个语言处理专家，专注于自然语言处理和翻译任务。按照以下步骤和要求，以最大程度实现字幕的准确和高质量翻译：

1. 将原句翻译为%s，确保译文流畅、自然，达到专业翻译水平，保持意思相同。**如果目标语言是中文，必须使用简体中文，不能使用繁体中文。**
2. 严格依据标点符号（逗号: ，,、句号:。.、问号:？?等）将内容拆分成单独的句子，并依据以下规则确保拆分长度较短：
   - 每个句子在保证句意完整的情况下尽可能短，适中的字幕长短能提供舒适的观看体验。
   - 根据连词（例如 "and", "but", "which", "when", "so", "所以", "但是", "因此", "考虑到" 等）进一步拆分句子，得到较短的结果。
3. 对每个拆分的句子分别翻译，确保不遗漏或修改任何字词。
4. 将每对翻译后的句子与原句用独立编号表示，并分别以方括号[]包裹内容。
5. 输出的翻译与原文应保持对应，严格按照原文顺序呈现，不得有错位，与原文表达的意思保持一致，且原文尽可能使用原文。
6. 不管内容是正式还是非正式，都要翻译。

翻译输出应采用如下格式：
**正常翻译的示例（注意每块3部分，每个部分都独占一行，空格分块）**：
1
[翻译后的句子1]
[原句子1]

2
[翻译后的句子2]
[原句子2]

**无文本需要翻译的输出示例**：
[无文本]

确保高效、精确地完成上述翻译任务，输入内容如下：

`

// 带有语气词过滤的拆分Prompt
var SplitTextPromptWithModalFilter = `你是一个语言处理专家，专注于自然语言处理和翻译任务。按照以下步骤和要求，以最大程度实现字幕的准确和高质量翻译：

1. 将原句翻译为%s，确保译文流畅、自然，达到专业翻译水平，保持意思相同。**如果目标语言是中文，必须使用简体中文，不能使用繁体中文。**
2. 严格依据标点符号（逗号: ，,、句号:。.、问号:？?等）将内容拆分成单独的句子，并依据以下规则确保拆分长度较短：
   - 每个句子在保证句意完整的情况下尽可能短，适中的字幕长短能提供舒适的观看体验。
   - 根据连词（例如 "and", "but", "which", "when", "so", "所以", "但是", "因此", "考虑到" 等）进一步拆分句子，得到较短的结果。
3. 对每个拆分的句子分别翻译，确保不遗漏或修改任何字词。
4. 将每对翻译后的句子与原句用独立编号表示，并分别以方括号[]包裹内容。
5. 输出的翻译与原文应保持对应，严格按照原文顺序呈现，不得有错位，与原文表达的意思保持一致，且原文尽可能使用原文。
6. 忽略文本中的语气词，比如"Oh" "Ah" "Wow"等等。
7. 不管内容是正式还是非正式，都要翻译。

翻译输出应采用如下格式：
**正常翻译的示例（注意每块3部分，每个部分都独占一行，空格分块）**：
1
[翻译后的句子1]
[原句子1]

2
[翻译后的句子2]
[原句子2]

**无文本需要翻译的输出示例**：
[无文本]

确保高效、精确地完成上述翻译任务，输入内容如下：

`

var SplitTextPromptJson = `你是一个语言处理专家，专注于自然语言处理和翻译任务。按照以下步骤和要求，以最大程度实现字幕的准确和高质量翻译：

1. 将原句翻译为%s，确保译文流畅、自然，达到专业翻译水平，保持意思相同。
2. 严格依据标点符号（逗号: ，,、句号:。.、问号:？?等）将内容拆分成单独的句子，并依据以下规则确保拆分长度较短：
   - 每个句子在保证句意完整的情况下尽可能短，适中的字幕长短能提供舒适的观看体验。
   - 根据连词（例如 "and", "but", "which", "when", "so", "所以", "但是", "因此", "考虑到" 等）进一步拆分句子，得到较短的结果。
3. 对每个拆分的句子分别翻译，确保不遗漏或修改任何字词。
4. 输出的翻译与原文确保相对应，严格按照原文顺序呈现。
5. 输出格式必须是一个 JSON 数组，每个元素包含 'original_sentence' 和 'translated_sentence' 字段。
6. 结果中的原句子要和原文中完全一致，包括首字母是否大小写，标点符号也要保留不修改，英文原文请使用英文标点符号，务必不要纠正任何语病和拼写错误。
7. 每个拆分的句子只能有一个完整的语句。

确保高效、精确地完成上述字幕翻译任务，输入内容如下：

`

var SplitTextPromptWithModalFilterJson = `你是一个语言处理专家，专注于自然语言处理和翻译任务。按照以下步骤和要求，以最大程度实现字幕的准确和高质量翻译：

1. 将原句翻译为%s，确保译文流畅、自然，达到专业翻译水平，保持意思相同。
2. 严格依据标点符号（逗号: ，,、句号:。.、问号:？?等）将内容拆分成单独的句子，并依据以下规则确保拆分长度较短：
   - 每个句子在保证句意完整的情况下尽可能短，适中的字幕长短能提供舒适的观看体验。
   - 根据连词（例如 "and", "but", "which", "when", "so", "所以", "但是", "因此", "考虑到" 等）进一步拆分句子，得到较短的结果。
3. 忽略文本中的语气词，比如"Oh" "Ah" "Wow"等等。
4. 对每个拆分的句子分别翻译，确保不遗漏或修改任何字词。
5. 输出的翻译与原文确保相对应，严格按照原文顺序呈现。
6. 输出格式必须是一个 JSON 数组，每个元素包含 'original_sentence' 和 'translated_sentence' 字段。
7. 结果中的原句子要和原文中完全一致，包括首字母是否大小写，标点符号也要保留不修改，英文原文请使用英文标点符号，务必不要纠正任何语病和拼写错误。
8. 每个拆分的句子只能有一个完整的语句。

确保高效、精确地完成上述字幕翻译任务，输入内容如下：

`

var TranslateVideoTitleAndDescriptionPrompt = `你是一个专业的翻译专家，请翻译下面给出的标题和描述信息（两者用####来分隔），要求如下：
 - 将内容翻译成 %s
 - 翻译后的内容仍然用####来分隔标题和描述两部分
 以下全部是源内容，请完整按要求翻译：
%s
`

var SplitLongSentencePrompt = `请将以下原文和译文分割成多个部分，确保每个部分都尽可能短：
原文：%s
译文：%s

要求：
1. 分割后的原文与原文不能有偏差
2. 分割后的每个翻译句都需要符合语法规范，可进行添加连词、去除助词等操作等保证每句读起来都是自然的
3. 译文如果有遗漏，请在分割的同时补全
4. 务必返回JSON格式，包含origin_part和translated_part数组，例如：
{"align":[{"origin_part":"原文部分1","translated_part":"译文部分1"},{"origin_part":"原文部分2","translated_part":"译文部分2"}]}`

var SplitOriginLongSentencePrompt = `Please split the following text into multiple parts, ensuring it's divided into at most 3 short sentences, preferably 2 parts,

Original text: %s

CRITICAL Requirements:
1. The split sentences must exactly match the original text, absolutely no changes to the original text are allowed
2. Split based on sentence meaning, dividing into at most 3 parts, preferably 2 parts
3. **Each split part MUST contain at least 3-5 words. NEVER create single-word or two-word fragments**
4. Split at natural break points (conjunctions, clauses) - DO NOT split phrases like "we're marking out", "you're going to", etc.
5. Try to make the split as balanced as possible while maintaining sentence integrity
6. Return in JSON format only, no other descriptions or explanations
7. Example format:
{"short_sentences":[{"text": "split sentence 1 with at least 3 words"},{"text": "split sentence 2 with at least 3 words"}]}

`

var SplitLongTextByMeaningPrompt = `Please split the following long text into shorter sentences based on semantic meaning. Do not change, add, or remove any words from the original text.

Original text: %s

Requirements:
1. Split the text into as many shorter, meaningful sentences as possible while preserving ALL original words
2. Do NOT change, modify, add, or remove any words - only split at natural breakpoints
3. Split at natural linguistic boundaries such as:
   - Punctuation marks (commas, semicolons, periods)
   - Conjunctions (and, but, or, so, because, when, while, etc.)
   - Relative pronouns (which, that, who, where, etc.)
   - Natural pause points that maintain sentence meaning
4. Each split part should be a complete, meaningful unit that can stand alone
5. Prioritize shorter segments - split as much as possible while maintaining semantic integrity
6. No limit on the number of splits - make each part as short as possible while still being meaningful
7. Maintain the original word order and exact spelling
8. Preserve all original punctuation and capitalization
9. Return in JSON format only, no other descriptions or explanations
10. Example format:
{"short_sentences":[{"text": "first short part"},{"text": "second short part"},{"text": "third short part"}]}

`

// var SplitTextWithContextPrompt = `你是一个专业翻译专家，擅长结合上下文进行准确翻译。请根据以下提供的上下文句子和目标句子，将目标句子翻译成%s，并确保翻译结果与上下文保持连贯一致：

// 上下文句子：
// %s

// 需要翻译的目标句子：%s

// 翻译要求：
// 1. 严格按照目标语言的语法和表达习惯翻译
// 2. 保持专业术语的一致性
// 3. 输出仅包含翻译后的文本，不添加任何额外解释或格式
// 4. 确保翻译结果与上下文语义连贯

// 请直接输出翻译结果：`

// var SplitTextWithContextPrompt = `You are a professional translation expert skilled in providing accurate translations based on context. Please translate the target sentence into %s according to the provided context sentences below, ensuring the translation remains coherent and consistent.

// Here's the full context:
// %s

// Target sentence to translate:
// %s

// %s

// Translation requirements:
// 1.Analyze how the target sentence connects to both the preceding and following context
// 2.Provide the most natural translation that preserves the original tone and intent
// 3.Highlight any idioms, cultural references, or nuanced phrases that require special attention
// 4.If there are multiple possible interpretations, briefly explain each option
// 5.Maintain consistent terminology with the surrounding sentences"
// 6.Output only the translated text without any additional explanations or formatting

// Please provide only the translation result:`

var SplitTextWithContextPrompt = `You are a professional subtitle translation expert.

[TRANSLATION TASK]
**Objective**:
Translate the "Target Sentence" below into %s with natural, fluent expression.
Use "Previous Sentences" to understand context and maintain coherence.

**Critical Rules**:
1. OUTPUT MUST BE A SINGLE LINE: only the translated text
2. If translating to Chinese, MUST use Simplified Chinese characters (简体中文), NOT Traditional Chinese (繁体中文)
3. Translate naturally and idiomatically - avoid word-for-word literal translation
4. Remove stuttering/repeated words (e.g., "I I I'm" → translate as "I'm")
5. Filter out filler words (um, uh, er, ah, oh, mm, hmm, etc.) - do NOT translate them
6. Use proper punctuation marks in the target language (for Chinese: use ，。！？ not spaces)
7. Keep the original meaning but express it smoothly and naturally in the target language
8. If sentence is incomplete/fragmentary, keep it that way but translate fluently
9. IGNORE the "Next Sentences" - they are for reference only

**Context**:
[Previous Sentences]
%s

[Target Sentence]
%s

[Next Sentences]
%s

**Provide only the natural, fluent translation on a single line:**`

type SmallAudio struct {
	AudioFile         string
	TranscriptionData *TranscriptionData
	SrtNoTsFile       string
}

type SubtitleResultType int

const (
	SubtitleResultTypeOriginOnly                   SubtitleResultType = iota + 1 // 仅返回原语言字幕
	SubtitleResultTypeTargetOnly                                                 // 仅返回翻译后语言字幕
	SubtitleResultTypeBilingualTranslationOnTop                                  // 返回双语字幕，翻译后的字幕在上
	SubtitleResultTypeBilingualTranslationOnBottom                               // 返回双语字幕，翻译后的字幕在下
)

const (
	SubtitleTaskBilingualYes uint8 = iota + 1
	SubtitleTaskBilingualNo
)

const (
	SubtitleTaskTranslationSubtitlePosTop uint8 = iota + 1
	SubtitleTaskTranslationSubtitlePosBelow
)

const (
	SubtitleTaskModalFilterYes uint8 = iota + 1
	SubtitleTaskModalFilterNo
)

const (
	SubtitleTaskTtsYes uint8 = iota + 1
	SubtitleTaskTtsNo
)

const (
	SubtitleTaskTtsVoiceCodeLongyu uint8 = iota + 1
	SubtitleTaskTtsVoiceCodeLongchen
)

const (
	SubtitleTaskStatusProcessing uint8 = iota + 1
	SubtitleTaskStatusSuccess
	SubtitleTaskStatusFailed
)

const (
	SubtitleTaskAudioFileName                                    = "origin_audio.mp3"
	SubtitleTaskVideoFileName                                    = "origin_video.mp4"
	SubtitleTaskSplitAudioFileNamePrefix                         = "split_audio"
	SubtitleTaskSplitAudioFileNamePattern                        = SubtitleTaskSplitAudioFileNamePrefix + "_%03d.mp3"
	SubtitleTaskSplitAudioTxtFileNamePattern                     = "split_audio_txt_%d.txt"
	SubtitleTaskSplitAudioWordsFileNamePattern                   = "split_audio_words_%d.txt"
	SubtitleTaskSplitSrtNoTimestampFileNamePattern               = "srt_no_ts_%d.srt"
	SubtitleTaskSrtNoTimestampFileName                           = "srt_no_ts.srt"
	SubtitleTaskSplitBilingualSrtFileNamePattern                 = "split_bilingual_srt_%d.srt"
	SubtitleTaskSplitShortOriginMixedSrtFileNamePattern          = "split_short_origin_mixed_srt_%d.srt" //长中文+短英文
	SubtitleTaskSplitShortOriginSrtFileNamePattern               = "split_short_origin_srt_%d.srt"       //短英文
	SubtitleTaskBilingualSrtFileName                             = "bilingual_srt.srt"
	SubtitleTaskShortOriginMixedSrtFileName                      = "short_origin_mixed_srt.srt" //长中文+短英文
	SubtitleTaskShortOriginSrtFileName                           = "short_origin_srt.srt"       //短英文
	SubtitleTaskOriginLanguageSrtFileName                        = "origin_language_srt.srt"
	SubtitleTaskOriginLanguageTextFileName                       = "origin_language.txt"
	SubtitleTaskTargetLanguageSrtFileName                        = "target_language_srt.srt"
	SubtitleTaskTargetLanguageTextFileName                       = "target_language.txt"
	SubtitleTaskStepParamGobPersistenceFileName                  = "step_param.gob"
	SubtitleTaskAudioTranscriptionDataPersistenceFileNamePattern = "audio_transcription_data_%d.json"
	SubtitleTaskTranslationRawDataPersistenceFileNamePattern     = "audio_translation_raw_data_%d.json"
	SubtitleTaskTranslationDataPersistenceFileNamePattern        = "translation_data_%d.json"
	SubtitleTaskTransferredVerticalVideoFileName                 = "transferred_vertical_video.mp4"
	SubtitleTaskHorizontalEmbedVideoFileName                     = "horizontal_embed.mp4"
	SubtitleTaskVerticalEmbedVideoFileName                       = "vertical_embed.mp4"
	SubtitleTaskVideoWithTtsFileName                             = "video_with_tts.mp4"
)

const (
	TtsAudioDurationDetailsFileName = "audio_duration_details.txt"
	TtsResultAudioFileName          = "tts_final_audio.wav"
)

const (
	AsrMono16kAudioFileName = "mono_16k_audio.mp3"
)

type SubtitleFileInfo struct {
	Name               string
	Path               string
	LanguageIdentifier string // 在最终下载的文件里标识语言，如zh_cn，en，bilingual
}

type SubtitleTaskStepParam struct {
	TaskId                      string
	TaskPtr                     *SubtitleTask // 和storage里面对应
	TaskBasePath                string
	Link                        string
	AudioFilePath               string
	VttFile                     string // YouTube下载的原始字幕文件路径
	SubtitleResultType          SubtitleResultType
	EnableModalFilter           bool
	EnableTts                   bool
	TtsAudioOnly                bool
	SkipAudio                   bool
	TtsVoiceCode                string // 人声语音编码
	VoiceCloneAudioUrl          string // 音色克隆的源音频oss地址
	ReplaceWordsMap             map[string]string
	OriginLanguage              StandardLanguageCode // 视频源语言
	TargetLanguage              StandardLanguageCode // 用户希望的目标翻译语言
	UserUILanguage              StandardLanguageCode // 用户的使用语言
	BilingualSrtFilePath        string
	ShortOriginMixedSrtFilePath string
	SubtitleInfos               []SubtitleFileInfo
	TtsSourceFilePath           string
	TtsResultFilePath           string
	InputVideoPath              string // 源视频路径
	EmbedSubtitleVideoType      string // 合成字幕嵌入的视频类型 none不嵌入 horizontal横屏 vertical竖屏
	VerticalVideoMajorTitle     string // 合成竖屏视频的主标题
	VerticalVideoMinorTitle     string
	MaxWordOneLine              int                     // 字幕一行最多显示多少个字
	VideoWithTtsFilePath        string                  // 替换源视频的音频为tts结果后的视频路径
	VttSwitch                   bool                    // 是否使用VTT格式字幕文件
	SubtitleStyle               *subtitlestyle.StyleSet // CLI/Agent 传入的字幕样式；nil 时使用默认样式
	RenderWidth                 int                     // 当前待烧录字幕视频宽度，用于按字号估算自动换行
	RenderHeight                int                     // 当前待烧录字幕视频高度，用于按字号估算自动换行
}

type SrtSentence struct {
	Text  string
	Start float64
	End   float64
}

type SrtSentenceWithStrTime struct {
	Text  string
	Start string
	End   string
}

type SubtitleInfo struct {
	Id          uint64 `json:"id" gorm:"column:id"`                                  // 自增id
	TaskId      string `json:"task_id" gorm:"column:task_id"`                        // task_id
	Uid         uint32 `json:"uid" gorm:"column:uid"`                                // 用户id
	Name        string `json:"name" gorm:"column:name"`                              // 字幕名称
	DownloadUrl string `json:"download_url" gorm:"column:download_url"`              // 字幕地址
	CreateTime  int64  `json:"create_time" gorm:"column:create_time;autoCreateTime"` // 创建时间
}

type SubtitleTask struct {
	Id                    uint64         `json:"id" gorm:"column:id"`                                         // 自增id
	TaskId                string         `json:"task_id" gorm:"column:task_id"`                               // 任务id
	Title                 string         `json:"title" gorm:"column:title"`                                   // 标题
	Description           string         `json:"description" gorm:"column:description"`                       // 描述
	TranslatedTitle       string         `json:"translated_title" gorm:"column:translated_title"`             // 翻译后的标题
	TranslatedDescription string         `json:"translated_description" gorm:"column:translated_description"` // 翻译后的描述
	OriginLanguage        string         `json:"origin_language" gorm:"column:origin_language"`               // 视频原语言
	TargetLanguage        string         `json:"target_language" gorm:"column:target_language"`               // 翻译任务的目标语言
	VideoSrc              string         `json:"video_src" gorm:"column:video_src"`                           // 视频地址
	Status                uint8          `json:"status" gorm:"column:status"`                                 // 1-处理中,2-成功,3-失败
	LastSuccessStepNum    uint8          `json:"last_success_step_num" gorm:"column:last_success_step_num"`   // 最后成功的子任务序号，用于任务恢复
	FailReason            string         `json:"fail_reason" gorm:"column:fail_reason"`                       // 失败原因
	ProcessPct            uint8          `json:"process_percent" gorm:"column:process_percent"`               // 处理进度
	Duration              uint32         `json:"duration" gorm:"column:duration"`                             // 视频时长
	SrtNum                int            `json:"srt_num" gorm:"column:srt_num"`                               // 字幕数量
	SubtitleInfos         []SubtitleInfo `gorm:"foreignKey:TaskId;references:TaskId"`
	Cover                 string         `json:"cover" gorm:"column:cover"`                             // 封面
	SpeechDownloadUrl     string         `json:"speech_download_url" gorm:"column:speech_download_url"` // 语音文件下载地址
	CreateTime            int64          `json:"create_time" gorm:"column:create_time;autoCreateTime"`  // 创建时间
	UpdateTime            int64          `json:"update_time" gorm:"column:update_time;autoUpdateTime"`  // 更新时间

	progressReporter            func(uint8)
	translationProgressReporter func(completed, total int)
	detailedProgressReporter    func(TaskProgress)
}

func (t *SubtitleTask) SetProgressReporter(reporter func(uint8)) {
	if t == nil {
		return
	}
	t.progressReporter = reporter
}

func (t *SubtitleTask) SetTranslationProgressReporter(reporter func(completed, total int)) {
	if t != nil {
		t.translationProgressReporter = reporter
	}
}

func (t *SubtitleTask) SetTranslationProgress(completed, total int) {
	if t == nil || total <= 0 {
		return
	}
	if t.translationProgressReporter != nil {
		t.translationProgressReporter(completed, total)
		return
	}
	// Preserve the legacy video pipeline's translation range.
	if completed > 0 {
		t.SetProgress(40 + uint8(completed*50/total))
	}
}

func (t *SubtitleTask) SetProgress(percent uint8) {
	if t == nil {
		return
	}
	if percent > 100 {
		percent = 100
	}
	if t.ProcessPct == percent {
		return
	}
	t.ProcessPct = percent
	if t.progressReporter != nil {
		t.progressReporter(percent)
	}
}

type Word struct {
	Num   int
	Text  string
	Start float64
	End   float64
}

type TranscriptionData struct {
	Language string
	Text     string
	Words    []Word
}

type SrtBlock struct {
	Index                  int
	Timestamp              string
	OriginLanguageSentence string
	TargetLanguageSentence string
}
