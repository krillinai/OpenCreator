package pipeline

import (
	"context"
	"krillin-ai/internal/service"
	"krillin-ai/internal/types"
	pkgimage "krillin-ai/pkg/image"
	"krillin-ai/pkg/util"
)

type StageService interface {
	TranslateSubtitleBlocks(context.Context, []*util.SrtBlock, *types.SubtitleTaskStepParam) error
	PrepareMedia(context.Context, *types.SubtitleTaskStepParam) error
	GenerateSubtitlesFromAudio(context.Context, *types.SubtitleTaskStepParam) error
	GenerateSpeechFromSRT(context.Context, *types.SubtitleTaskStepParam) error
	FinalizeSubtitleResults(context.Context, *types.SubtitleTaskStepParam) error
	DownloadYouTubeSubtitle(context.Context, *service.YoutubeSubtitleReq) (string, error)
	ProcessYouTubeSubtitle(context.Context, *service.YoutubeSubtitleReq) (string, error)
	RenderVideo(context.Context, service.RenderVideoRequest) (string, error)
	GenerateCoverImage(context.Context, pkgimage.GenerateRequest) (pkgimage.GenerateResult, error)
}

func (a *ServiceAdapter) TranslateSubtitleBlocks(ctx context.Context, blocks []*util.SrtBlock, p *types.SubtitleTaskStepParam) error {
	return a.svc.TranslateSubtitleBlocks(ctx, blocks, p)
}

type ServiceAdapter struct {
	svc *service.Service
}

func NewServiceAdapter(svc *service.Service) *ServiceAdapter {
	return &ServiceAdapter{svc: svc}
}

func (a *ServiceAdapter) PrepareMedia(ctx context.Context, p *types.SubtitleTaskStepParam) error {
	return a.svc.PrepareMedia(ctx, p)
}

func (a *ServiceAdapter) GenerateSubtitlesFromAudio(ctx context.Context, p *types.SubtitleTaskStepParam) error {
	return a.svc.GenerateSubtitlesFromAudio(ctx, p)
}

func (a *ServiceAdapter) GenerateSpeechFromSRT(ctx context.Context, p *types.SubtitleTaskStepParam) error {
	return a.svc.GenerateSpeechFromSRT(ctx, p)
}

func (a *ServiceAdapter) FinalizeSubtitleResults(ctx context.Context, p *types.SubtitleTaskStepParam) error {
	return a.svc.FinalizeSubtitleResults(ctx, p)
}

func (a *ServiceAdapter) DownloadYouTubeSubtitle(ctx context.Context, r *service.YoutubeSubtitleReq) (string, error) {
	return a.svc.DownloadYouTubeSubtitle(ctx, r)
}

func (a *ServiceAdapter) ProcessYouTubeSubtitle(ctx context.Context, r *service.YoutubeSubtitleReq) (string, error) {
	return a.svc.ProcessYouTubeSubtitle(ctx, r)
}

func (a *ServiceAdapter) RenderVideo(ctx context.Context, r service.RenderVideoRequest) (string, error) {
	return a.svc.RenderVideo(ctx, r)
}

func (a *ServiceAdapter) GenerateCoverImage(ctx context.Context, r pkgimage.GenerateRequest) (pkgimage.GenerateResult, error) {
	return a.svc.GenerateCoverImage(ctx, r)
}
