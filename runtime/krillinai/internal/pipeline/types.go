package pipeline

import "encoding/json"

type Stage string

const (
	StageDownload         Stage = "download"
	StageSubtitle         Stage = "subtitle"
	StageTTS              Stage = "tts"
	StageSpeech           Stage = "speech"
	StageRenderHorizontal Stage = "render-horizontal"
	StageRenderVertical   Stage = "render-vertical"
	StageCover            Stage = "cover"
	StagePipeline         Stage = "pipeline"
	StageVoices           Stage = "voices"
)

type CaptionSource string

const (
	CaptionSourceAny      CaptionSource = "any"
	CaptionSourceManual   CaptionSource = "manual"
	CaptionSourceAuto     CaptionSource = "auto"
	CaptionSourcePlatform CaptionSource = "platform"
	CaptionSourceWhisper  CaptionSource = "whisper"
)

type LineMode string

const (
	LineModeTargetOnly            LineMode = "target-only"
	LineModeBilingualTargetTop    LineMode = "bilingual-target-top"
	LineModeBilingualTargetBottom LineMode = "bilingual-target-bottom"
)

type ErrorKind string

const (
	ErrorKindUsage      ErrorKind = "usage"
	ErrorKindRetryable  ErrorKind = "retryable"
	ErrorKindDependency ErrorKind = "dependency"
	ErrorKindInternal   ErrorKind = "internal"
)

type Error struct {
	Kind      ErrorKind `json:"kind"`
	Code      string    `json:"code"`
	Message   string    `json:"message"`
	Retryable bool      `json:"retryable"`
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func ExitCodeForError(err *Error) int {
	if err == nil {
		return 0
	}
	switch err.Kind {
	case ErrorKindUsage:
		return 1
	case ErrorKindRetryable:
		return 2
	case ErrorKindDependency:
		return 3
	default:
		return 1
	}
}

type Outputs struct {
	OriginVideo         string `json:"origin_video,omitempty"`
	OriginAudio         string `json:"origin_audio,omitempty"`
	OriginSRT           string `json:"origin_srt,omitempty"`
	TargetSRT           string `json:"target_srt,omitempty"`
	BilingualSRT        string `json:"bilingual_srt,omitempty"`
	ShortOriginSRT      string `json:"short_origin_srt,omitempty"`
	ShortOriginMixedSRT string `json:"short_origin_mixed_srt,omitempty"`
	TTSAudio            string `json:"tts_audio,omitempty"`
	VideoWithTTS        string `json:"video_with_tts,omitempty"`
	HorizontalVideo     string `json:"horizontal_video,omitempty"`
	VerticalVideo       string `json:"vertical_video,omitempty"`
	TransferredVideo    string `json:"transferred_vertical_video,omitempty"`
	OriginCover         string `json:"origin_cover,omitempty"`
	GeneratedCover      string `json:"generated_cover,omitempty"`
	FinalCoverPrompt    string `json:"cover_prompt,omitempty"`
	OriginText          string `json:"origin_text,omitempty"`
	TargetText          string `json:"target_text,omitempty"`
}

type Voice struct {
	Code            string   `json:"code"`
	Name            string   `json:"name,omitempty"`
	Language        string   `json:"language,omitempty"`
	Gender          string   `json:"gender,omitempty"`
	Provider        string   `json:"provider,omitempty"`
	Scenario        string   `json:"scenario,omitempty"`
	Kind            string   `json:"kind,omitempty"`
	SupportedModels []string `json:"supported_models,omitempty"`
	Recommended     bool     `json:"recommended,omitempty"`
}

type Response struct {
	OK            bool              `json:"ok"`
	Stage         Stage             `json:"stage"`
	Workdir       string            `json:"workdir,omitempty"`
	TaskID        string            `json:"task_id,omitempty"`
	CaptionSource CaptionSource     `json:"caption_source,omitempty"`
	Inputs        map[string]string `json:"inputs,omitempty"`
	Voices        []Voice           `json:"voices,omitempty"`
	Outputs       Outputs           `json:"outputs,omitempty"`
	Warnings      []string          `json:"warnings,omitempty"`
	FailedIndexes []int             `json:"failed_indexes,omitempty"`
	Error         *Error            `json:"error,omitempty"`
	DurationMS    int64             `json:"duration_ms,omitempty"`
}

func (r Response) MarshalJSON() ([]byte, error) {
	type response Response
	type responseWithOptionalOutputs struct {
		response
		Outputs *Outputs `json:"outputs,omitempty"`
	}

	resp := responseWithOptionalOutputs{
		response: response(r),
	}
	if r.Outputs != (Outputs{}) {
		resp.Outputs = &r.Outputs
	}
	return json.Marshal(resp)
}
