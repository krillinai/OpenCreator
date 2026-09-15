package ttsprovider

import (
	"fmt"

	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/pkg/aliyun"
	"krillin-ai/pkg/minimax"
	"krillin-ai/pkg/openai"
	"krillin-ai/pkg/volcengine"
)

func New(provider string) (types.TTSProvider, error) {
	switch provider {
	case "openai":
		return openai.NewTtsClient(
			config.Conf.Tts.Openai.BaseUrl,
			config.Conf.Tts.Openai.ApiKey,
			config.Conf.Tts.Openai.Model,
			config.Conf.App.Proxy,
		), nil
	case "aliyun":
		return aliyun.NewTtsClient(
			config.Conf.Tts.Aliyun.BaseUrl,
			config.Conf.Tts.Aliyun.ApiKey,
			config.Conf.Tts.Aliyun.Model,
			config.Conf.App.Proxy,
		), nil
	case "minimax":
		return minimax.NewTtsClient(
			config.Conf.Tts.Minimax.BaseUrl,
			config.Conf.Tts.Minimax.ApiKey,
			config.Conf.Tts.Minimax.Model,
		), nil
	case "volcengine":
		return volcengine.NewTtsClient(
			config.Conf.Tts.Volcengine.BaseUrl,
			config.Conf.Tts.Volcengine.AppId,
			config.Conf.Tts.Volcengine.AccessToken,
			config.Conf.Tts.Volcengine.Cluster,
			config.Conf.App.Proxy,
		), nil
	default:
		return nil, fmt.Errorf("unsupported tts provider: %s", provider)
	}
}
