package service

import (
	"context"
	"errors"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"testing"
)

type stageExporter interface {
	PrepareMedia(context.Context, *types.SubtitleTaskStepParam) error
	GenerateSubtitlesFromAudio(context.Context, *types.SubtitleTaskStepParam) error
	GenerateSpeechFromSRT(context.Context, *types.SubtitleTaskStepParam) error
	FinalizeSubtitleResults(context.Context, *types.SubtitleTaskStepParam) error
	DownloadYouTubeSubtitle(context.Context, *YoutubeSubtitleReq) (string, error)
	ProcessYouTubeSubtitle(context.Context, *YoutubeSubtitleReq) (string, error)
}

var _ stageExporter = Service{}

func TestImportedSubtitleTranslationDoesNotFallBackToOriginalText(t *testing.T) {
	log.InitLogger()
	completer := &scriptedCompleter{responses: []string{"not-json", "not-json", "not-json"}}
	svc := Service{YouTubeSubtitleSrv: &YouTubeSubtitleService{translator: &Translator{chatCompleter: completer}}}
	blocks := []*util.SrtBlock{{Index: 1, OriginLanguageSentence: "source"}}
	err := svc.TranslateSubtitleBlocks(context.Background(), blocks, &types.SubtitleTaskStepParam{OriginLanguage: "en", TargetLanguage: "zh_cn"})
	if err == nil || blocks[0].TargetLanguageSentence != "" {
		t.Fatalf("failed translation returned a fake result: %v, %+v", err, blocks[0])
	}
}

func TestStageExportMethodsExist(t *testing.T) {
	var _ stageExporter = Service{}
}

func TestGenerateSubtitlesFromAudioValidatesTranscriptionWhenUsed(t *testing.T) {
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.Transcribe.Provider = "openai"
	config.Conf.Transcribe.Openai.ApiKey = ""

	err := (Service{}).GenerateSubtitlesFromAudio(context.Background(), &types.SubtitleTaskStepParam{})
	if err == nil {
		t.Fatal("GenerateSubtitlesFromAudio() error = nil, want missing transcription configuration")
	}
}

func TestYouTubeStageExportsReturnErrorWhenServiceMissing(t *testing.T) {
	var svc Service

	if _, err := svc.DownloadYouTubeSubtitle(context.Background(), &YoutubeSubtitleReq{}); !errors.Is(err, ErrYouTubeSubtitleServiceNotInitialized) {
		t.Fatalf("DownloadYouTubeSubtitle error = %v, want %v", err, ErrYouTubeSubtitleServiceNotInitialized)
	}

	if _, err := svc.ProcessYouTubeSubtitle(context.Background(), &YoutubeSubtitleReq{}); !errors.Is(err, ErrYouTubeSubtitleServiceNotInitialized) {
		t.Fatalf("ProcessYouTubeSubtitle error = %v, want %v", err, ErrYouTubeSubtitleServiceNotInitialized)
	}
}
