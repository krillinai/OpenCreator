package pipeline

import (
	"context"
	"errors"
	"krillin-ai/internal/types"
	"os"
	"path/filepath"
)

const ttsInputFileName = "tts_input.srt"

type TTSRequest struct {
	Workdir          string
	TaskID           string
	InputSRT         string
	LineMode         LineMode
	Video            string
	SourceURL        string
	MediaWorkdir     string
	AudioOnly        bool
	Voice            string
	VoiceCloneSource string
	ReportProgress   ProgressReporter
}

func GenerateTTS(ctx context.Context, svc StageService, req TTSRequest) (Response, error) {
	req.ReportProgress = monotonicProgress(req.ReportProgress)
	if req.LineMode == "" {
		req.LineMode = LineModeTargetOnly
	}
	reportTTSProgress(req, "preparing_voice", 10, "正在准备配音")
	manifest, err := ttsManifest(req)
	if err != nil {
		return ttsFailureResponse(req, nil, ErrorKindInternal, "load_manifest_failed", err), err
	}
	manifest.TaskID = req.TaskID
	manifest.Workdir = req.Workdir
	existingOutputs := manifest.Outputs
	if err := manifest.ApplyDefaultOutputs(); err != nil {
		return ttsFailureResponse(req, manifest, ErrorKindInternal, "apply_outputs_failed", err), err
	}
	restoreOutputs(manifest, existingOutputs)
	prepareTTSOutputs(manifest)

	inputSRT := req.InputSRT
	if inputSRT == "" {
		inputSRT = manifest.Outputs.TargetSRT
	}
	ttsSource := inputSRT
	if req.LineMode != LineModeTargetOnly {
		ttsSource = filepath.Join(req.Workdir, ttsInputFileName)
		if err := ExtractTargetSRT(inputSRT, ttsSource, req.LineMode); err != nil {
			return failTTSStage(req, manifest, "extract_tts_input_failed", err)
		}
	}

	inputVideo := req.Video
	if inputVideo == "" {
		inputVideo = manifest.Outputs.OriginVideo
	}
	if req.AudioOnly {
		inputVideo = ""
		manifest.Outputs.VideoWithTTS = ""
	} else if req.Video == "" && req.SourceURL != "" {
		inputVideo, err = ensureSourceVideo(ctx, svc, manifest, req.SourceURL, req.MediaWorkdir, req.ReportProgress)
		if err != nil {
			return failTTSStage(req, manifest, "prepare_media_for_render_failed", err)
		}
	}
	stepParam := &types.SubtitleTaskStepParam{
		TaskId:                  req.TaskID,
		TaskPtr:                 &types.SubtitleTask{TaskId: req.TaskID, Status: types.SubtitleTaskStatusProcessing},
		TaskBasePath:            req.Workdir,
		EnableTts:               true,
		TtsAudioOnly:            req.AudioOnly,
		TtsSourceFilePath:       ttsSource,
		TtsOriginSrtFilePath:    manifest.Outputs.OriginSRT,
		TtsResultFilePath:       manifest.Outputs.TTSAudio,
		TtsBilingualSrtFilePath: manifest.Outputs.BilingualSRT,
		InputVideoPath:          inputVideo,
		TtsVoiceCode:            req.Voice,
		VoiceCloneAudioUrl:      req.VoiceCloneSource,
		VideoWithTtsFilePath:    manifest.Outputs.VideoWithTTS,
		TargetLanguage:          types.StandardLanguageCode(manifest.TargetLanguage),
		TtsResultSrtFilePath:    manifest.Outputs.TargetSRT,
	}
	stepParam.TaskPtr.SetProgressReporter(func(percent uint8) {
		if percent >= 95 {
			reportTTSProgress(req, "collecting_outputs", int(percent), "正在整理配音产物")
			return
		}
		reportTTSProgress(req, "generating_voice", int(percent), "正在生成配音")
	})
	forwardTaskProgress(stepParam.TaskPtr, req.ReportProgress, nil)
	reportTTSProgress(req, "generating_voice", 20, "正在生成配音")
	if err := svc.GenerateSpeechFromSRT(ctx, stepParam); err != nil {
		return failTTSStage(req, manifest, "generate_speech_failed", err)
	}
	if stepParam.TtsResultFilePath != "" {
		manifest.Outputs.TTSAudio = stepParam.TtsResultFilePath
	}
	if !req.AudioOnly && stepParam.VideoWithTtsFilePath != "" {
		manifest.Outputs.VideoWithTTS = stepParam.VideoWithTtsFilePath
	}
	manifest.MarkStage(StageTTS, true, "")
	if err := manifest.Save(); err != nil {
		return ttsFailureResponse(req, manifest, ErrorKindInternal, "save_manifest_failed", err), err
	}
	reportTTSProgress(req, "collecting_outputs", 99, "正在整理配音产物")
	return ttsResponse(true, req, manifest, nil), nil
}

func reportTTSProgress(req TTSRequest, phase string, percent int, message string, counts ...ProgressCounts) {
	if req.ReportProgress == nil {
		return
	}
	req.ReportProgress(phase, percent, message, counts...)
}

func ttsManifest(req TTSRequest) (*Manifest, error) {
	manifest, err := LoadManifest(req.Workdir)
	if err == nil {
		return manifest, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return NewManifest(req.TaskID, req.Workdir), nil
	}
	return nil, err
}

func restoreOutputs(manifest *Manifest, existing Outputs) {
	if existing.OriginVideo != "" {
		manifest.Outputs.OriginVideo = existing.OriginVideo
	}
	if existing.OriginAudio != "" {
		manifest.Outputs.OriginAudio = existing.OriginAudio
	}
	if existing.OriginSRT != "" {
		manifest.Outputs.OriginSRT = existing.OriginSRT
	}
	if existing.TargetSRT != "" {
		manifest.Outputs.TargetSRT = existing.TargetSRT
	}
	if existing.BilingualSRT != "" {
		manifest.Outputs.BilingualSRT = existing.BilingualSRT
	}
	if existing.ShortOriginSRT != "" {
		manifest.Outputs.ShortOriginSRT = existing.ShortOriginSRT
	}
	if existing.ShortOriginMixedSRT != "" {
		manifest.Outputs.ShortOriginMixedSRT = existing.ShortOriginMixedSRT
	}
	if existing.TTSAudio != "" {
		manifest.Outputs.TTSAudio = existing.TTSAudio
	}
	if existing.VideoWithTTS != "" {
		manifest.Outputs.VideoWithTTS = existing.VideoWithTTS
	}
	if existing.HorizontalVideo != "" {
		manifest.Outputs.HorizontalVideo = existing.HorizontalVideo
	}
	if existing.VerticalVideo != "" {
		manifest.Outputs.VerticalVideo = existing.VerticalVideo
	}
	if existing.TransferredVideo != "" {
		manifest.Outputs.TransferredVideo = existing.TransferredVideo
	}
	if existing.OriginCover != "" {
		manifest.Outputs.OriginCover = existing.OriginCover
	}
	if existing.GeneratedCover != "" {
		manifest.Outputs.GeneratedCover = existing.GeneratedCover
	}
	if existing.FinalCoverPrompt != "" {
		manifest.Outputs.FinalCoverPrompt = existing.FinalCoverPrompt
	}
	if existing.OriginText != "" {
		manifest.Outputs.OriginText = existing.OriginText
	}
	if existing.TargetText != "" {
		manifest.Outputs.TargetText = existing.TargetText
	}
}

func failTTSStage(req TTSRequest, manifest *Manifest, code string, err error) (Response, error) {
	if manifest != nil {
		invalidateTTSOutputs(manifest)
		manifest.MarkStage(StageTTS, false, err.Error())
		_ = manifest.Save()
	}
	return ttsFailureResponse(req, manifest, ErrorKindRetryable, code, err), err
}

// prepareTTSOutputs removes artifacts from an earlier run before starting a
// new TTS attempt, so a failed attempt cannot inherit stale diagnostics.
func prepareTTSOutputs(manifest *Manifest) {
	if manifest == nil {
		return
	}
	for _, path := range []string{
		manifest.Outputs.TTSAudio,
		manifest.Outputs.VideoWithTTS,
		filepath.Join(manifest.Workdir, "dubbing", "dubbing_plan.json"),
		filepath.Join(manifest.Workdir, "dubbing", "dubbing_report.json"),
		filepath.Join(manifest.Workdir, "dubbing", "dub.srt"),
	} {
		if path != "" {
			_ = os.Remove(path)
		}
	}
}

// invalidateTTSOutputs prevents a failed run from exposing partially generated
// audio or video through the manifest.
func invalidateTTSOutputs(manifest *Manifest) {
	if manifest == nil {
		return
	}
	for _, path := range []string{
		manifest.Outputs.TTSAudio,
		manifest.Outputs.VideoWithTTS,
	} {
		if path != "" {
			_ = os.Remove(path)
		}
	}
	manifest.Outputs.TTSAudio = ""
	manifest.Outputs.VideoWithTTS = ""
}

func ttsFailureResponse(req TTSRequest, manifest *Manifest, kind ErrorKind, code string, err error) Response {
	return ttsResponse(false, req, manifest, &Error{
		Kind:      kind,
		Code:      code,
		Message:   err.Error(),
		Retryable: kind == ErrorKindRetryable,
	})
}

func ttsResponse(ok bool, req TTSRequest, manifest *Manifest, pipelineErr *Error) Response {
	resp := Response{
		OK:      ok,
		Stage:   StageTTS,
		Workdir: req.Workdir,
		TaskID:  req.TaskID,
		Error:   pipelineErr,
	}
	if manifest != nil {
		resp.Workdir = manifest.Workdir
		resp.TaskID = manifest.TaskID
		resp.Outputs = manifest.Outputs
		resp.Warnings = manifest.Warnings
		resp.FailedIndexes = manifest.FailedIndexes
	}
	return resp
}
