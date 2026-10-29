package handler

import (
	"krillin-ai/config"
	"krillin-ai/internal/response"
	"krillin-ai/log"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// 全局变量，用于标记配置是否需要重新初始化
var configUpdated bool

// ConfigRequest 定义前端发送的配置数据结构
type ConfigRequest struct {
	App struct {
		SegmentDuration       int    `json:"segmentDuration"`
		TranscribeParallelNum int    `json:"transcribeParallelNum"`
		TranslateParallelNum  int    `json:"translateParallelNum"`
		TranscribeMaxAttempts int    `json:"transcribeMaxAttempts"`
		TranslateMaxAttempts  int    `json:"translateMaxAttempts"`
		MaxSentenceLength     int    `json:"maxSentenceLength"`
		Proxy                 string `json:"proxy"`
	} `json:"app"`
	Server struct {
		Host string `json:"host"`
		Port int    `json:"port"`
	} `json:"server"`
	Llm struct {
		BaseUrl string `json:"baseUrl"`
		ApiKey  string `json:"apiKey"`
		Model   string `json:"model"`
	} `json:"llm"`
	Transcribe struct {
		Provider              string `json:"provider"`
		EnableGpuAcceleration bool   `json:"enableGpuAcceleration"`
		Openai                struct {
			BaseUrl string `json:"baseUrl"`
			ApiKey  string `json:"apiKey"`
			Model   string `json:"model"`
		} `json:"openai"`
		Fasterwhisper struct {
			Model string `json:"model"`
		} `json:"fasterwhisper"`
		Whisperkit struct {
			Model string `json:"model"`
		} `json:"whisperkit"`
		Whispercpp struct {
			Model string `json:"model"`
		} `json:"whispercpp"`
		Aliyun struct {
			Oss struct {
				AccessKeyId     string `json:"accessKeyId"`
				AccessKeySecret string `json:"accessKeySecret"`
				Bucket          string `json:"bucket"`
			} `json:"oss"`
			Speech struct {
				AccessKeyId     string `json:"accessKeyId"`
				AccessKeySecret string `json:"accessKeySecret"`
				AppKey          string `json:"appKey"`
			} `json:"speech"`
		} `json:"aliyun"`
	} `json:"transcribe"`
	Tts struct {
		Provider string `json:"provider"`
		Openai   struct {
			BaseUrl string `json:"baseUrl"`
			ApiKey  string `json:"apiKey"`
			Model   string `json:"model"`
		} `json:"openai"`
		Aliyun struct {
			Oss struct {
				AccessKeyId     string `json:"accessKeyId"`
				AccessKeySecret string `json:"accessKeySecret"`
				Bucket          string `json:"bucket"`
			} `json:"oss"`
			Speech struct {
				AccessKeyId     string `json:"accessKeyId"`
				AccessKeySecret string `json:"accessKeySecret"`
				AppKey          string `json:"appKey"`
			} `json:"speech"`
		} `json:"aliyun"`
	} `json:"tts"`
}

// GetConfig 获取当前配置
func (h Handler) GetConfig(c *gin.Context) {
	log.GetLogger().Info("获取配置信息")

	// 转换配置为前端需要的格式
	configResponse := ConfigRequest{
		App: struct {
			SegmentDuration       int    `json:"segmentDuration"`
			TranscribeParallelNum int    `json:"transcribeParallelNum"`
			TranslateParallelNum  int    `json:"translateParallelNum"`
			TranscribeMaxAttempts int    `json:"transcribeMaxAttempts"`
			TranslateMaxAttempts  int    `json:"translateMaxAttempts"`
			MaxSentenceLength     int    `json:"maxSentenceLength"`
			Proxy                 string `json:"proxy"`
		}{
			SegmentDuration:       config.Conf.App.SegmentDuration,
			TranscribeParallelNum: config.Conf.App.TranscribeParallelNum,
			TranslateParallelNum:  config.Conf.App.TranslateParallelNum,
			TranscribeMaxAttempts: config.Conf.App.TranscribeMaxAttempts,
			TranslateMaxAttempts:  config.Conf.App.TranslateMaxAttempts,
			MaxSentenceLength:     config.Conf.App.MaxSentenceLength,
			Proxy:                 config.Conf.App.Proxy,
		},
		Server: struct {
			Host string `json:"host"`
			Port int    `json:"port"`
		}{
			Host: config.Conf.Server.Host,
			Port: config.Conf.Server.Port,
		},
		Llm: struct {
			BaseUrl string `json:"baseUrl"`
			ApiKey  string `json:"apiKey"`
			Model   string `json:"model"`
		}{
			BaseUrl: config.Conf.Llm.BaseUrl,
			ApiKey:  config.Conf.Llm.ApiKey,
			Model:   config.Conf.Llm.Model,
		},
	}

	// 转录配置
	configResponse.Transcribe.Provider = config.Conf.Transcribe.Provider
	configResponse.Transcribe.EnableGpuAcceleration = config.Conf.Transcribe.EnableGpuAcceleration
	configResponse.Transcribe.Openai.BaseUrl = config.Conf.Transcribe.Openai.BaseUrl
	configResponse.Transcribe.Openai.ApiKey = config.Conf.Transcribe.Openai.ApiKey
	configResponse.Transcribe.Openai.Model = config.Conf.Transcribe.Openai.Model
	configResponse.Transcribe.Fasterwhisper.Model = config.Conf.Transcribe.Fasterwhisper.Model
	configResponse.Transcribe.Whisperkit.Model = config.Conf.Transcribe.Whisperkit.Model
	configResponse.Transcribe.Whispercpp.Model = config.Conf.Transcribe.Whispercpp.Model
	configResponse.Transcribe.Aliyun.Oss.AccessKeyId = config.Conf.Transcribe.Aliyun.Oss.AccessKeyId
	configResponse.Transcribe.Aliyun.Oss.AccessKeySecret = config.Conf.Transcribe.Aliyun.Oss.AccessKeySecret
	configResponse.Transcribe.Aliyun.Oss.Bucket = config.Conf.Transcribe.Aliyun.Oss.Bucket
	configResponse.Transcribe.Aliyun.Speech.AccessKeyId = config.Conf.Transcribe.Aliyun.Speech.AccessKeyId
	configResponse.Transcribe.Aliyun.Speech.AccessKeySecret = config.Conf.Transcribe.Aliyun.Speech.AccessKeySecret
	configResponse.Transcribe.Aliyun.Speech.AppKey = config.Conf.Transcribe.Aliyun.Speech.AppKey

	// TTS配置
	configResponse.Tts.Provider = config.Conf.Tts.Provider
	configResponse.Tts.Openai.BaseUrl = config.Conf.Tts.Openai.BaseUrl
	configResponse.Tts.Openai.ApiKey = config.Conf.Tts.Openai.ApiKey
	configResponse.Tts.Openai.Model = config.Conf.Tts.Openai.Model
	configResponse.Tts.Aliyun.Oss.AccessKeyId = config.Conf.Tts.Aliyun.Oss.AccessKeyId
	configResponse.Tts.Aliyun.Oss.AccessKeySecret = config.Conf.Tts.Aliyun.Oss.AccessKeySecret
	configResponse.Tts.Aliyun.Oss.Bucket = config.Conf.Tts.Aliyun.Oss.Bucket
	configResponse.Tts.Aliyun.Speech.AccessKeyId = config.Conf.Tts.Aliyun.Speech.AccessKeyId
	configResponse.Tts.Aliyun.Speech.AccessKeySecret = config.Conf.Tts.Aliyun.Speech.AccessKeySecret
	configResponse.Tts.Aliyun.Speech.AppKey = config.Conf.Tts.Aliyun.Speech.AppKey

	response.R(c, response.Response{
		Error: 0,
		Msg:   "获取配置成功",
		Data:  configResponse,
	})
}

// UpdateConfig 更新配置
func (h Handler) UpdateConfig(c *gin.Context) {
	var req ConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.GetLogger().Error("UpdateConfig ShouldBindJSON err", zap.Error(err))
		response.R(c, response.Response{
			Error: -1,
			Msg:   "参数错误: " + err.Error(),
			Data:  nil,
		})
		return
	}

	log.GetLogger().Info("更新配置信息")

	// 更新配置备份，确保桌面应用能检测到配置变化
	config.ConfigBackup = config.Conf

	// 标记配置已更新，需要重新初始化服务
	configUpdated = true

	// 更新应用配置
	config.Conf.App.SegmentDuration = req.App.SegmentDuration
	config.Conf.App.TranscribeParallelNum = req.App.TranscribeParallelNum
	config.Conf.App.TranslateParallelNum = req.App.TranslateParallelNum
	config.Conf.App.TranscribeMaxAttempts = req.App.TranscribeMaxAttempts
	config.Conf.App.TranslateMaxAttempts = req.App.TranslateMaxAttempts
	config.Conf.App.MaxSentenceLength = req.App.MaxSentenceLength
	config.Conf.App.Proxy = req.App.Proxy

	// 更新服务器配置
	config.Conf.Server.Host = req.Server.Host
	config.Conf.Server.Port = req.Server.Port

	// 更新LLM配置
	config.Conf.Llm.BaseUrl = req.Llm.BaseUrl
	config.Conf.Llm.ApiKey = req.Llm.ApiKey
	config.Conf.Llm.Model = req.Llm.Model

	// 更新转录配置
	config.Conf.Transcribe.Provider = req.Transcribe.Provider
	config.Conf.Transcribe.EnableGpuAcceleration = req.Transcribe.EnableGpuAcceleration
	config.Conf.Transcribe.Openai.BaseUrl = req.Transcribe.Openai.BaseUrl
	config.Conf.Transcribe.Openai.ApiKey = req.Transcribe.Openai.ApiKey
	config.Conf.Transcribe.Openai.Model = req.Transcribe.Openai.Model
	config.Conf.Transcribe.Fasterwhisper.Model = req.Transcribe.Fasterwhisper.Model
	config.Conf.Transcribe.Whisperkit.Model = req.Transcribe.Whisperkit.Model
	config.Conf.Transcribe.Whispercpp.Model = req.Transcribe.Whispercpp.Model
	config.Conf.Transcribe.Aliyun.Oss.AccessKeyId = req.Transcribe.Aliyun.Oss.AccessKeyId
	config.Conf.Transcribe.Aliyun.Oss.AccessKeySecret = req.Transcribe.Aliyun.Oss.AccessKeySecret
	config.Conf.Transcribe.Aliyun.Oss.Bucket = req.Transcribe.Aliyun.Oss.Bucket
	config.Conf.Transcribe.Aliyun.Speech.AccessKeyId = req.Transcribe.Aliyun.Speech.AccessKeyId
	config.Conf.Transcribe.Aliyun.Speech.AccessKeySecret = req.Transcribe.Aliyun.Speech.AccessKeySecret
	config.Conf.Transcribe.Aliyun.Speech.AppKey = req.Transcribe.Aliyun.Speech.AppKey

	// 更新TTS配置
	config.Conf.Tts.Provider = req.Tts.Provider
	config.Conf.Tts.Openai.BaseUrl = req.Tts.Openai.BaseUrl
	config.Conf.Tts.Openai.ApiKey = req.Tts.Openai.ApiKey
	config.Conf.Tts.Openai.Model = req.Tts.Openai.Model
	config.Conf.Tts.Aliyun.Oss.AccessKeyId = req.Tts.Aliyun.Oss.AccessKeyId
	config.Conf.Tts.Aliyun.Oss.AccessKeySecret = req.Tts.Aliyun.Oss.AccessKeySecret
	config.Conf.Tts.Aliyun.Oss.Bucket = req.Tts.Aliyun.Oss.Bucket
	config.Conf.Tts.Aliyun.Speech.AccessKeyId = req.Tts.Aliyun.Speech.AccessKeyId
	config.Conf.Tts.Aliyun.Speech.AccessKeySecret = req.Tts.Aliyun.Speech.AccessKeySecret
	config.Conf.Tts.Aliyun.Speech.AppKey = req.Tts.Aliyun.Speech.AppKey

	// 验证配置
	if err := config.CheckConfig(); err != nil {
		log.GetLogger().Error("配置验证失败", zap.Error(err))
		// 恢复原配置
		config.Conf = config.ConfigBackup
		response.R(c, response.Response{
			Error: -1,
			Msg:   "配置验证失败: " + err.Error(),
			Data:  nil,
		})
		return
	}

	// 保存配置到文件
	if err := config.SaveConfig(); err != nil {
		log.GetLogger().Error("保存配置失败", zap.Error(err))
		response.R(c, response.Response{
			Error: -1,
			Msg:   "保存配置失败: " + err.Error(),
			Data:  nil,
		})
		return
	}

	log.GetLogger().Info("配置更新成功")
	response.R(c, response.Response{
		Error: 0,
		Msg:   "配置更新成功",
		Data:  nil,
	})
}
