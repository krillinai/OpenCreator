package service

import (
	"krillin-ai/config"
	"krillin-ai/internal/ttsprovider"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/aliyun"
	"krillin-ai/pkg/fasterwhisper"
	pkgimage "krillin-ai/pkg/image"
	"krillin-ai/pkg/localtts"
	"krillin-ai/pkg/openai"
	"krillin-ai/pkg/volcengine"
	"krillin-ai/pkg/whisper"
	"krillin-ai/pkg/whispercpp"
	"krillin-ai/pkg/whisperkit"

	"go.uber.org/zap"
)

type Service struct {
	Transcriber        types.Transcriber
	ChatCompleter      types.ChatCompleter
	TtsClient          types.Ttser
	OssClient          *aliyun.OssClient
	VoiceCloneClient   *aliyun.VoiceCloneClient
	YouTubeSubtitleSrv *YouTubeSubtitleService
	ImageClient        *pkgimage.OpenAICompatibleClient
}

func NewService() *Service {
	var transcriber types.Transcriber
	var chatCompleter types.ChatCompleter
	var ttsClient types.Ttser

	switch config.Conf.Transcribe.Provider {
	case "openai":
		transcriber = whisper.NewClient(config.Conf.Transcribe.Openai.BaseUrl, config.Conf.Transcribe.Openai.ApiKey, config.Conf.App.Proxy)
	case "fasterwhisper":
		transcriber = fasterwhisper.NewFastwhisperProcessor(config.Conf.Transcribe.Fasterwhisper.Model)
	case "whispercpp":
		transcriber = whispercpp.NewWhispercppProcessor(config.Conf.Transcribe.Whispercpp.Model)
	case "whisperkit":
		transcriber = whisperkit.NewWhisperKitProcessor(config.Conf.Transcribe.Whisperkit.Model)
	case "aliyun":
		cc, err := aliyun.NewAsrClient(config.Conf.Transcribe.Aliyun.Speech.AccessKeyId, config.Conf.Transcribe.Aliyun.Speech.AccessKeySecret, config.Conf.Transcribe.Aliyun.Speech.AppKey, true)
		if err != nil {
			log.GetLogger().Error("创建阿里云语音识别客户端失败： ", zap.Error(err))
			return nil
		}
		transcriber = cc
	case "volcengine":
		transcriber = volcengine.NewAsrClient(
			config.Conf.Transcribe.Volcengine.BaseUrl,
			config.Conf.Transcribe.Volcengine.AppId,
			config.Conf.Transcribe.Volcengine.AccessToken,
			config.Conf.Transcribe.Volcengine.ResourceId,
			config.Conf.App.Proxy,
		)
	}
	log.GetLogger().Info("当前选择的转录源： ", zap.String("transcriber", config.Conf.Transcribe.Provider))

	chatCompleter = openai.NewClient(config.Conf.Llm.BaseUrl, config.Conf.Llm.ApiKey, config.Conf.App.Proxy)

	switch config.Conf.Tts.Provider {
	case "openai":
		ttsClient, _ = ttsprovider.New("openai")
	case "aliyun":
		ttsClient, _ = ttsprovider.New("aliyun")
	case "edge-tts":
		ttsClient = localtts.NewEdgeTtsClient()
	case "minimax":
		ttsClient, _ = ttsprovider.New("minimax")
	case "volcengine":
		ttsClient, _ = ttsprovider.New("volcengine")
	}

	s := &Service{
		Transcriber:      transcriber,
		ChatCompleter:    chatCompleter,
		TtsClient:        ttsClient,
		OssClient:        aliyun.NewOssClient(config.Conf.Transcribe.Aliyun.Oss),
		VoiceCloneClient: aliyun.NewVoiceCloneClient(config.Conf.Tts.Aliyun.Speech.AccessKeyId, config.Conf.Tts.Aliyun.Speech.AccessKeySecret, config.Conf.Tts.Aliyun.Speech.AppKey),
		ImageClient:      pkgimage.NewOpenAICompatibleClient(config.Conf.Image.Openai.BaseUrl, config.Conf.Image.Openai.ApiKey, config.Conf.Image.Openai.Model),
	}
	s.YouTubeSubtitleSrv = NewYouTubeSubtitleService()

	return s
}
