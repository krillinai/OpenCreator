package service

import (
	"context"
	"errors"
	"krillin-ai/config"
	"krillin-ai/internal/deps"
	"krillin-ai/internal/types"
	pkgimage "krillin-ai/pkg/image"
	"krillin-ai/pkg/util"
)

var ErrYouTubeSubtitleServiceNotInitialized = errors.New("youtube subtitle service not initialized")
var ErrImageClientNotInitialized = errors.New("image client not initialized")

func (s Service) TranslateSubtitleBlocks(ctx context.Context, blocks []*util.SrtBlock, p *types.SubtitleTaskStepParam) ([]*util.SrtBlock, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.YouTubeSubtitleSrv == nil || s.YouTubeSubtitleSrv.translator == nil {
		return nil, ErrYouTubeSubtitleServiceNotInitialized
	}
	return s.YouTubeSubtitleSrv.translator.withTranslationRecovery(p.TaskBasePath, p.TaskPtr).BatchTranslateSrtBlocks(ctx, blocks, string(p.OriginLanguage), string(p.TargetLanguage), p.TaskPtr)
}

type DownloadMediaResult struct {
	VideoPath string
	AudioPath string
}

func (s Service) DownloadMedia(ctx context.Context, input, workdir, taskID string) (DownloadMediaResult, error) {
	step := &types.SubtitleTaskStepParam{
		TaskId:                 taskID,
		TaskPtr:                &types.SubtitleTask{TaskId: taskID, Status: types.SubtitleTaskStatusProcessing},
		TaskBasePath:           workdir,
		Link:                   input,
		VttSwitch:              false,
		EmbedSubtitleVideoType: "all",
	}
	if err := s.PrepareMedia(ctx, step); err != nil {
		return DownloadMediaResult{}, err
	}
	return DownloadMediaResult{VideoPath: step.InputVideoPath, AudioPath: step.AudioFilePath}, nil
}

func (s Service) PrepareMedia(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	return s.linkToFile(ctx, stepParam)
}

func (s Service) GenerateSubtitlesFromAudio(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	if validator, ok := s.Transcriber.(interface{ ValidateLanguage(string) error }); ok && stepParam != nil {
		if err := validator.ValidateLanguage(string(stepParam.OriginLanguage)); err != nil {
			return err
		}
	}
	if err := config.ValidateTranscriptionConfig(); err != nil {
		return err
	}
	if err := deps.CheckTranscriptionDependency(); err != nil {
		return err
	}
	return s.audioToSubtitle(ctx, stepParam)
}

func (s Service) GenerateSpeechFromSRT(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	return s.srtFileToSpeech(ctx, stepParam)
}

func (s Service) FinalizeSubtitleResults(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	return s.uploadSubtitles(ctx, stepParam)
}

func (s Service) DownloadYouTubeSubtitle(ctx context.Context, req *YoutubeSubtitleReq) (string, error) {
	if s.YouTubeSubtitleSrv == nil {
		return "", ErrYouTubeSubtitleServiceNotInitialized
	}
	return s.YouTubeSubtitleSrv.downloadYouTubeSubtitle(ctx, req)
}

func (s Service) ProcessYouTubeSubtitle(ctx context.Context, req *YoutubeSubtitleReq) (string, error) {
	if s.YouTubeSubtitleSrv == nil {
		return "", ErrYouTubeSubtitleServiceNotInitialized
	}
	return s.YouTubeSubtitleSrv.processYouTubeSubtitle(ctx, req)
}

func (s Service) GenerateCoverImage(ctx context.Context, req pkgimage.GenerateRequest) (pkgimage.GenerateResult, error) {
	if s.ImageClient == nil {
		return pkgimage.GenerateResult{}, ErrImageClientNotInitialized
	}
	return s.ImageClient.Generate(ctx, req)
}
