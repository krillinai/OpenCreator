package pipeline

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/internal/service"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"net/url"
	"os"
	"strings"
)

const defaultSubtitleMaxWordOneLine = 12

type SubtitleRequest struct {
	Input          string
	Workdir        string
	TaskID         string
	OriginLang     string
	TargetLang     string
	UserLang       string
	CaptionSource  CaptionSource
	BilingualTop   bool
	MaxWordOneLine int
	SubtitleStyle  *subtitlestyle.StyleSet
	PrepareVideo   bool
	SourceOnly     bool
	InputSRT       string
	SRTTranslated  bool
	ReportProgress func(phase string, percent int, message string)
}

func GenerateSubtitles(ctx context.Context, svc StageService, req SubtitleRequest) (Response, error) {
	if req.CaptionSource == "" {
		req.CaptionSource = CaptionSourceAny
	}

	manifest, err := subtitleManifest(req)
	if err != nil {
		return subtitleFailureResponse(req, nil, ErrorKindInternal, "load_manifest_failed", err), err
	}
	manifest.TaskID = req.TaskID
	manifest.Workdir = req.Workdir
	manifest.InputURL = req.Input
	manifest.OriginLanguage = req.OriginLang
	manifest.TargetLanguage = req.TargetLang
	manifest.CaptionSource = string(req.CaptionSource)
	if err := manifest.ApplyDefaultOutputs(); err != nil {
		return subtitleFailureResponse(req, manifest, ErrorKindInternal, "apply_outputs_failed", err), err
	}

	reportSubtitleProgress(req, "preparing_source", 10, "正在准备视频来源")
	stepParam := subtitleStepParam(req)
	stepParam.TaskPtr.SetProgressReporter(func(percent uint8) {
		reportSubtitleProgress(req, "preparing_source", 10+minInt(int(percent), 10), "正在准备视频来源")
	})
	if err := svc.PrepareMedia(ctx, stepParam); err != nil {
		return failSubtitleStage(req, manifest, ErrorKindRetryable, "prepare_media_failed", err)
	}
	syncPreparedMediaOutputs(manifest, stepParam)
	if req.InputSRT != "" {
		reportSubtitleProgress(req, "importing_subtitles", 30, "正在使用本地字幕")
		if err := importSubtitleFile(ctx, svc, req, stepParam, manifest); err != nil {
			return failSubtitleStage(req, manifest, ErrorKindRetryable, "subtitle_import_failed", err)
		}
		if req.SRTTranslated {
			manifest.Outputs.OriginSRT = ""
			manifest.Outputs.BilingualSRT = ""
		}
		return saveSubtitleSuccess(manifest, req, CaptionSource("local_srt"))
	}

	var platformCaptionErr error
	if IsYouTubeInput(req.Input) && req.CaptionSource != CaptionSourceWhisper {
		reportSubtitleProgress(req, "reading_platform_captions", 20, "正在获取平台字幕")
		stepParam.TaskPtr.SetProgressReporter(func(percent uint8) {
			phase, message, overall := platformSubtitleProgress(percent)
			reportSubtitleProgress(req, phase, overall, message)
		})
		youtubeReq := subtitleYouTubeReq(req, stepParam.TaskPtr)
		vttFile, err := svc.DownloadYouTubeSubtitle(ctx, youtubeReq)
		if err == nil {
			reportSubtitleProgress(req, "processing_platform_captions", 25, "正在解析平台字幕")
			youtubeReq.VttFile = vttFile
			_, err = svc.ProcessYouTubeSubtitle(ctx, youtubeReq)
		}
		if err == nil {
			manifest.CaptionSource = "youtube_vtt"
			if !req.SourceOnly || req.PrepareVideo {
				reportSubtitleProgress(req, "preparing_original_media", 76, "正在补齐原始视频")
				stepParam.TaskPtr.SetProgressReporter(func(percent uint8) {
					overall := 76 + minInt(int(percent), 10)*14/10
					reportSubtitleProgress(req, "preparing_original_media", overall, "正在补齐原始视频")
				})
				if err := prepareOriginalMediaForRendering(ctx, svc, stepParam); err != nil {
					return failSubtitleStage(req, manifest, ErrorKindRetryable, "prepare_media_for_render_failed", err)
				}
				syncPreparedMediaOutputs(manifest, stepParam)
			}
			reportSubtitleProgress(req, "collecting_outputs", 95, "正在整理字幕和视频产物")
			return saveSubtitleSuccess(manifest, req, CaptionSource("youtube_vtt"))
		}
		if req.CaptionSource != CaptionSourceAny {
			return failSubtitleStage(req, manifest, ErrorKindRetryable, "platform_caption_failed", err)
		}
		platformCaptionErr = err
		manifest.Warnings = append(manifest.Warnings, "平台字幕不可用，回退到转录")
		stepParam.VttSwitch = false
		if req.PrepareVideo {
			stepParam.EmbedSubtitleVideoType = "all"
		}
		reportSubtitleProgress(req, "preparing_audio", 25, "平台字幕不可用，正在准备音频转录")
		stepParam.TaskPtr.SetProgressReporter(audioSubtitleProgressReporter(req))
		if err := svc.PrepareMedia(ctx, stepParam); err != nil {
			return failSubtitleStage(req, manifest, ErrorKindRetryable, "prepare_audio_fallback_failed", fmt.Errorf(
				"platform caption attempt failed: %v; audio fallback preparation failed: %w",
				platformCaptionErr,
				err,
			))
		}
		syncPreparedMediaOutputs(manifest, stepParam)
	}

	stepParam.TaskPtr.SetProgressReporter(audioSubtitleProgressReporter(req))
	reportSubtitleProgress(req, "transcribing_audio", 30, "正在转录并翻译音频字幕")
	if err := svc.GenerateSubtitlesFromAudio(ctx, stepParam); err != nil {
		return failSubtitleStage(req, manifest, ErrorKindRetryable, "audio_transcription_failed", err)
	}
	manifest.CaptionSource = string(CaptionSourceWhisper)
	reportSubtitleProgress(req, "collecting_outputs", 95, "正在整理字幕产物")
	return saveSubtitleSuccess(manifest, req, CaptionSourceWhisper)
}

func reportSubtitleProgress(req SubtitleRequest, phase string, percent int, message string) {
	if req.ReportProgress == nil {
		return
	}
	req.ReportProgress(phase, percent, message)
}

func platformSubtitleProgress(percent uint8) (string, string, int) {
	value := int(percent)
	if value < 40 {
		return "processing_platform_captions", "正在解析平台字幕", 25 + value*15/40
	}
	if value < 90 {
		return "translating_subtitles", "正在翻译字幕", 40 + (value-40)*35/50
	}
	return "collecting_subtitles", "正在生成双语字幕", 75
}

func audioSubtitleProgressReporter(req SubtitleRequest) func(uint8) {
	return func(percent uint8) {
		value := int(percent)
		overall := 25 + value*65/100
		phase := "transcribing_audio"
		message := "正在转录并翻译音频字幕"
		if req.SourceOnly {
			message = "正在转录音频字幕"
			if value <= 10 {
				phase = "preparing_audio"
				message = "正在准备音频转录"
			} else if value >= 90 {
				phase = "collecting_subtitles"
				message = "正在生成原文字幕"
			}
			reportSubtitleProgress(req, phase, overall, message)
			return
		}
		if value <= 10 {
			phase = "preparing_audio"
			message = "正在准备音频转录"
		} else if value >= 53 && value < 90 {
			phase = "translating_subtitles"
			message = "正在翻译字幕"
		} else if value >= 90 {
			phase = "collecting_subtitles"
			message = "正在生成字幕文件"
		}
		reportSubtitleProgress(req, phase, overall, message)
	}
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func syncPreparedMediaOutputs(manifest *Manifest, stepParam *types.SubtitleTaskStepParam) {
	if stepParam.InputVideoPath != "" {
		manifest.Outputs.OriginVideo = stepParam.InputVideoPath
	}
	if stepParam.AudioFilePath != "" {
		manifest.Outputs.OriginAudio = stepParam.AudioFilePath
	}
}

func subtitleManifest(req SubtitleRequest) (*Manifest, error) {
	manifest, err := LoadManifest(req.Workdir)
	if err == nil {
		return manifest, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return NewManifest(req.TaskID, req.Workdir), nil
	}
	return nil, err
}

func subtitleStepParam(req SubtitleRequest) *types.SubtitleTaskStepParam {
	userLang := req.UserLang
	if userLang == "" {
		userLang = string(types.LanguageNameSimplifiedChinese)
	}
	resultType := types.SubtitleResultTypeBilingualTranslationOnBottom
	if req.SourceOnly {
		resultType = types.SubtitleResultTypeOriginOnly
	} else if req.BilingualTop {
		resultType = types.SubtitleResultTypeBilingualTranslationOnTop
	}
	maxWordOneLine := req.MaxWordOneLine
	if maxWordOneLine <= 0 {
		maxWordOneLine = defaultSubtitleMaxWordOneLine
	}

	taskPtr := &types.SubtitleTask{
		TaskId:   req.TaskID,
		VideoSrc: req.Input,
		Status:   types.SubtitleTaskStatusProcessing,
	}
	vttSwitch := req.InputSRT == "" && IsYouTubeInput(req.Input) && req.CaptionSource != CaptionSourceWhisper
	embedSubtitleVideoType := "none"
	if req.PrepareVideo && !vttSwitch {
		embedSubtitleVideoType = "all"
	}
	return &types.SubtitleTaskStepParam{
		TaskId:                 req.TaskID,
		TaskPtr:                taskPtr,
		TaskBasePath:           req.Workdir,
		Link:                   req.Input,
		SubtitleResultType:     resultType,
		OriginLanguage:         types.StandardLanguageCode(req.OriginLang),
		TargetLanguage:         types.StandardLanguageCode(req.TargetLang),
		UserUILanguage:         types.StandardLanguageCode(userLang),
		MaxWordOneLine:         maxWordOneLine,
		VttSwitch:              vttSwitch,
		EmbedSubtitleVideoType: embedSubtitleVideoType,
		SubtitleStyle:          req.SubtitleStyle,
	}
}

func prepareOriginalMediaForRendering(ctx context.Context, svc StageService, stepParam *types.SubtitleTaskStepParam) error {
	stepParam.VttSwitch = false
	stepParam.EmbedSubtitleVideoType = "all"
	return svc.PrepareMedia(ctx, stepParam)
}

func subtitleYouTubeReq(req SubtitleRequest, taskPtr *types.SubtitleTask) *service.YoutubeSubtitleReq {
	return &service.YoutubeSubtitleReq{
		TaskBasePath:        req.Workdir,
		TaskId:              req.TaskID,
		URL:                 req.Input,
		OriginLanguage:      req.OriginLang,
		TargetLanguage:      req.TargetLang,
		TaskPtr:             taskPtr,
		SourceOnly:          req.SourceOnly,
		TargetLanguageFirst: req.BilingualTop,
	}
}

func saveSubtitleSuccess(manifest *Manifest, req SubtitleRequest, captionSource CaptionSource) (Response, error) {
	videoInfo, videoErr := os.Stat(manifest.Outputs.OriginVideo)
	if videoErr != nil || !videoInfo.Mode().IsRegular() || videoInfo.Size() == 0 {
		manifest.Outputs.OriginVideo = ""
		if req.PrepareVideo {
			return failSubtitleStage(req, manifest, ErrorKindRetryable, "source_video_missing", errors.New("original video was requested but was not produced"))
		}
	}
	if req.SourceOnly {
		manifest.Outputs.TargetSRT = ""
		manifest.Outputs.BilingualSRT = ""
		manifest.Outputs.ShortOriginSRT = ""
		manifest.Outputs.ShortOriginMixedSRT = ""
		manifest.Outputs.TargetText = ""
	}
	if err := validateExistingSubtitleOutputs(manifest.Outputs); err != nil {
		manifest.MarkStage(StageSubtitle, false, err.Error())
		_ = manifest.Save()
		return subtitleFailureResponse(req, manifest, ErrorKindInternal, "invalid_subtitle_timeline", err), err
	}
	manifest.MarkStage(StageSubtitle, true, "")
	if err := manifest.Save(); err != nil {
		return subtitleFailureResponse(req, manifest, ErrorKindInternal, "save_manifest_failed", err), err
	}
	return subtitleResponse(true, req, manifest, captionSource, nil), nil
}

func failSubtitleStage(req SubtitleRequest, manifest *Manifest, kind ErrorKind, code string, err error) (Response, error) {
	if manifest != nil {
		manifest.MarkStage(StageSubtitle, false, err.Error())
		_ = manifest.Save()
	}
	return subtitleFailureResponse(req, manifest, kind, code, err), err
}

func subtitleFailureResponse(req SubtitleRequest, manifest *Manifest, kind ErrorKind, code string, err error) Response {
	pipelineErr := &Error{
		Kind:      kind,
		Code:      code,
		Message:   err.Error(),
		Retryable: kind == ErrorKindRetryable,
	}
	return subtitleResponse(false, req, manifest, req.CaptionSource, pipelineErr)
}

func subtitleResponse(ok bool, req SubtitleRequest, manifest *Manifest, captionSource CaptionSource, pipelineErr *Error) Response {
	resp := Response{
		OK:            ok,
		Stage:         StageSubtitle,
		Workdir:       req.Workdir,
		TaskID:        req.TaskID,
		CaptionSource: captionSource,
		Error:         pipelineErr,
	}
	if manifest != nil {
		resp.Workdir = manifest.Workdir
		resp.TaskID = manifest.TaskID
		resp.Outputs = manifest.Outputs
		resp.Warnings = manifest.Warnings
		if manifest.CaptionSource != "" {
			resp.CaptionSource = CaptionSource(manifest.CaptionSource)
		}
	}
	return resp
}

func IsYouTubeInput(input string) bool {
	parsed, err := url.Parse(strings.TrimSpace(input))
	if err != nil {
		return false
	}
	hostname := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	return hostname == "youtu.be" ||
		hostname == "youtube.com" ||
		strings.HasSuffix(hostname, ".youtube.com") ||
		hostname == "youtube-nocookie.com" ||
		strings.HasSuffix(hostname, ".youtube-nocookie.com")
}
