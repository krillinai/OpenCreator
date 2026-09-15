package service

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/deps"
	"krillin-ai/internal/types"
	pkgimage "krillin-ai/pkg/image"
	"krillin-ai/pkg/util"
)

var ErrYouTubeSubtitleServiceNotInitialized = errors.New("youtube subtitle service not initialized")
var ErrImageClientNotInitialized = errors.New("image client not initialized")

func (s Service) TranslateSubtitleBlocks(ctx context.Context, blocks []*util.SrtBlock, p *types.SubtitleTaskStepParam) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.YouTubeSubtitleSrv == nil || s.YouTubeSubtitleSrv.translator == nil {
		return ErrYouTubeSubtitleServiceNotInitialized
	}
	for start := 0; start < len(blocks); start += 10 {
		if err := ctx.Err(); err != nil {
			return err
		}
		batch := blocks[start:min(start+10, len(blocks))]
		texts := make([]string, len(batch))
		for index, block := range batch {
			texts[index] = block.OriginLanguageSentence
		}
		translations, err := s.YouTubeSubtitleSrv.translator.batchTranslateTexts(texts, p.OriginLanguage, p.TargetLanguage)
		if err != nil {
			return err
		}
		if len(translations) != len(batch) {
			return fmt.Errorf("subtitle translation count mismatch")
		}
		for index, text := range translations {
			if text == "" {
				return fmt.Errorf("subtitle translation missing for cue %d", batch[index].Index)
			}
			batch[index].TargetLanguageSentence = text
		}
	}
	return nil
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
