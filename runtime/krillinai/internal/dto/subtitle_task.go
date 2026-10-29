package dto

type StartVideoSubtitleTaskReq struct {
	AppId                     uint32   `json:"app_id"`
	Url                       string   `json:"url"`
	OriginLanguage            string   `json:"origin_lang"`
	TargetLang                string   `json:"target_lang"`
	Bilingual                 uint8    `json:"bilingual"`
	TranslationSubtitlePos    uint8    `json:"translation_subtitle_pos"`
	ModalFilter               uint8    `json:"modal_filter"`
	Tts                       uint8    `json:"tts"`
	TtsVoiceCode              string   `json:"tts_voice_code"`
	TtsVoiceCloneSrcFileUrl   string   `json:"tts_voice_clone_src_file_url"`
	Replace                   []string `json:"replace"`
	Language                  string   `json:"language"`
	EmbedSubtitleVideoType    string   `json:"embed_subtitle_video_type"`
	VerticalMajorTitle        string   `json:"vertical_major_title"`
	VerticalMinorTitle        string   `json:"vertical_minor_title"`
	OriginLanguageWordOneLine int      `json:"origin_language_word_one_line"`
	VttSwitch                 bool     `json:"vtt_switch"` // 是否使用VTT格式字幕文件
}

type StartVideoSubtitleTaskResData struct {
	TaskId string `json:"task_id"`
}

type StartVideoSubtitleTaskRes struct {
	Error int32                          `json:"error"`
	Msg   string                         `json:"msg"`
	Data  *StartVideoSubtitleTaskResData `json:"data"`
}

type GetVideoSubtitleTaskReq struct {
	TaskId string `form:"taskId"`
}

type VideoInfo struct {
	Title                 string `json:"title"`
	Description           string `json:"description"`
	TranslatedTitle       string `json:"translated_title"`
	TranslatedDescription string `json:"translated_description"`
	Language              string `json:"language"`
}

type SubtitleInfo struct {
	Name        string `json:"name"`
	DownloadUrl string `json:"download_url"`
}

type GetVideoSubtitleTaskResData struct {
	TaskId            string          `json:"task_id"`
	ProcessPercent    uint8           `json:"process_percent"`
	VideoInfo         *VideoInfo      `json:"video_info"`
	SubtitleInfo      []*SubtitleInfo `json:"subtitle_info"`
	TargetLanguage    string          `json:"target_language"`
	SpeechDownloadUrl string          `json:"speech_download_url"`
}

type GetVideoSubtitleTaskRes struct {
	Error int32                        `json:"error"`
	Msg   string                       `json:"msg"`
	Data  *GetVideoSubtitleTaskResData `json:"data"`
}
