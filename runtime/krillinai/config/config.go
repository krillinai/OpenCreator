package config

import (
	"errors"
	"fmt"
	"krillin-ai/log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"

	"github.com/BurntSushi/toml"
	"go.uber.org/zap"
)

var ConfigBackup Config // 用于在开始任务之前，检测配置是否更新，更新后要重启服务端

type App struct {
	SegmentDuration       int      `toml:"segment_duration"`
	TranscribeParallelNum int      `toml:"transcribe_parallel_num"`
	TranslateParallelNum  int      `toml:"translate_parallel_num"`
	TranscribeMaxAttempts int      `toml:"transcribe_max_attempts"`
	TranslateMaxAttempts  int      `toml:"translate_max_attempts"`
	MaxSentenceLength     int      `toml:"max_sentence_length"`
	EnableBlockVttBatch   bool     `toml:"enable_block_vtt_batch"`
	VttBatchSize          int      `toml:"vtt_batch_size"`
	TargetLanguageFirst   bool     `toml:"target_language_first"`    // 双语字幕中目标语言是否在上
	ShortSubtitleMaxChars int      `toml:"short_subtitle_max_chars"` // 短字幕英文每行最大字符数
	Proxy                 string   `toml:"proxy"`
	ParsedProxy           *url.URL `toml:"-"`
}

type Server struct {
	Host string `toml:"host"`
	Port int    `toml:"port"`
}

type OpenaiCompatibleConfig struct {
	BaseUrl string `toml:"base_url"`
	ApiKey  string `toml:"api_key"`
	Model   string `toml:"model"`
}

type LocalModelConfig struct {
	Model string `toml:"model"`
}

type AliyunSpeechConfig struct {
	AccessKeyId     string `toml:"access_key_id"`
	AccessKeySecret string `toml:"access_key_secret"`
	AppKey          string `toml:"app_key"`
}

type AliyunOssConfig struct {
	AccessKeyId     string `toml:"access_key_id"`
	AccessKeySecret string `toml:"access_key_secret"`
	Bucket          string `toml:"bucket"`
}

type AliyunTranscribeConfig struct {
	Oss    AliyunOssConfig    `toml:"oss"`
	Speech AliyunSpeechConfig `toml:"speech"`
}

// VolcengineAsrConfig holds Doubao Voice / OpenSpeech console credentials.
// AppId and AccessToken are shared with TTS; ASR sends the token as X-Api-Access-Key.
type VolcengineAsrConfig struct {
	AppId       string `toml:"app_id"`
	AccessToken string `toml:"access_token"`
	ResourceId  string `toml:"resource_id"`
	BaseUrl     string `toml:"base_url"`
}

// VolcengineTtsConfig uses the same console Access Token as ASR.
// V1 sends it as Authorization: Bearer;<token> and JSON app.token.
// V3 sends it as X-Api-Access-Key.
type VolcengineTtsConfig struct {
	AppId          string `toml:"app_id"`
	AccessToken    string `toml:"access_token"`
	Cluster        string `toml:"cluster"`
	DefaultVoiceId string `toml:"default_voice_id"`
	BaseUrl        string `toml:"base_url"`
}

type Transcribe struct {
	Provider              string                 `toml:"provider"`
	EnableGpuAcceleration bool                   `toml:"enable_gpu_acceleration"`
	Openai                OpenaiCompatibleConfig `toml:"openai"`
	Fasterwhisper         LocalModelConfig       `toml:"fasterwhisper"`
	Whisperkit            LocalModelConfig       `toml:"whisperkit"`
	Whispercpp            LocalModelConfig       `toml:"whispercpp"`
	Aliyun                AliyunTranscribeConfig `toml:"aliyun"`
	Volcengine            VolcengineAsrConfig    `toml:"volcengine"`
}

type AliyunTtsConfig struct {
	BaseUrl string             `toml:"base_url"`
	ApiKey  string             `toml:"api_key"`
	Model   string             `toml:"model"`
	Oss     AliyunOssConfig    `toml:"oss"`
	Speech  AliyunSpeechConfig `toml:"speech"`
}

type Tts struct {
	Provider   string                 `toml:"provider"`
	Openai     OpenaiCompatibleConfig `toml:"openai"`
	Aliyun     AliyunTtsConfig        `toml:"aliyun"`
	Minimax    OpenaiCompatibleConfig `toml:"minimax"`
	Volcengine VolcengineTtsConfig    `toml:"volcengine"`
}

type Dubbing struct {
	MinSubtitleDuration float64 `toml:"min_subtitle_duration"`
	MaxChunkSize        int     `toml:"max_chunk_size"`
	GapTolerance        float64 `toml:"gap_tolerance"`
	SpeedMin            float64 `toml:"speed_min"`
	SpeedAccept         float64 `toml:"speed_accept"`
	SpeedMax            float64 `toml:"speed_max"`
	EnableTextRewrite   bool    `toml:"enable_text_rewrite"`
	RewriteMaxAttempts  int     `toml:"rewrite_max_attempts"`
	Estimator           string  `toml:"estimator"`
}

type Image struct {
	Provider string                 `toml:"provider"`
	Openai   OpenaiCompatibleConfig `toml:"openai"`
}

type OpenAiWhisper struct {
	BaseUrl string `toml:"base_url"`
	ApiKey  string `toml:"api_key"`
}

type Config struct {
	App        App                    `toml:"app"`
	Server     Server                 `toml:"server"`
	Llm        OpenaiCompatibleConfig `toml:"llm"`
	Transcribe Transcribe             `toml:"transcribe"`
	Tts        Tts                    `toml:"tts"`
	Dubbing    Dubbing                `toml:"dubbing"`
	Image      Image                  `toml:"image"`
}

var Conf = Config{
	App: App{
		SegmentDuration:       5,
		TranslateParallelNum:  3,
		TranscribeParallelNum: 1,
		TranscribeMaxAttempts: 3,
		TranslateMaxAttempts:  3,
		MaxSentenceLength:     70,
		EnableBlockVttBatch:   false,
		VttBatchSize:          10,
	},
	Server: Server{
		Host: "127.0.0.1",
		Port: 8888,
	},
	Llm: OpenaiCompatibleConfig{
		Model: "gpt-4o-mini",
	},
	Transcribe: Transcribe{
		Provider:              "openai",
		EnableGpuAcceleration: false, // 默认不开启GPU加速
		Openai: OpenaiCompatibleConfig{
			Model: "whisper-1",
		},
		Fasterwhisper: LocalModelConfig{
			Model: "large-v2",
		},
		Whisperkit: LocalModelConfig{
			Model: "large-v2",
		},
		Whispercpp: LocalModelConfig{
			Model: "large-v2",
		},
		Volcengine: VolcengineAsrConfig{
			ResourceId: "volc.seedasr.auc",
			BaseUrl:    "https://openspeech.bytedance.com",
		},
	},
	Tts: Tts{
		Provider: "openai",
		Openai: OpenaiCompatibleConfig{
			Model: "gpt-4o-mini-tts",
		},
		Aliyun: AliyunTtsConfig{
			BaseUrl: "https://dashscope.aliyuncs.com/api/v1",
			Model:   "qwen3-tts-flash",
		},
		Minimax: OpenaiCompatibleConfig{
			BaseUrl: "https://api.minimax.io",
			Model:   "speech-2.8-hd",
		},
		Volcengine: VolcengineTtsConfig{
			BaseUrl:        "https://openspeech.bytedance.com",
			Cluster:        "volcano_tts",
			DefaultVoiceId: "BV001_streaming",
		},
	},
	Dubbing: Dubbing{
		MinSubtitleDuration: 2.5,
		MaxChunkSize:        5,
		GapTolerance:        1.5,
		SpeedMin:            0.95,
		SpeedAccept:         1.15,
		SpeedMax:            1.30,
		EnableTextRewrite:   true,
		RewriteMaxAttempts:  2,
		Estimator:           "statistical",
	},
	Image: Image{
		Provider: "openai-compatible",
		Openai: OpenaiCompatibleConfig{
			Model: "gpt-image-1",
		},
	},
}

// ValidateTranscriptionConfig checks the selected transcription provider only
// when a workflow is about to use speech recognition.
func ValidateTranscriptionConfig() error {
	// 检查转写服务提供商配置
	switch Conf.Transcribe.Provider {
	case "openai":
		if Conf.Transcribe.Openai.ApiKey == "" {
			return errors.New("使用OpenAI转录服务需要配置 OpenAI API Key")
		}
	case "fasterwhisper":
		if Conf.Transcribe.Fasterwhisper.Model != "tiny" && Conf.Transcribe.Fasterwhisper.Model != "medium" && Conf.Transcribe.Fasterwhisper.Model != "large-v2" {
			return errors.New("检测到开启了fasterwhisper，但模型选型配置不正确，请检查配置")
		}
	case "whisperkit":
		if runtime.GOOS != "darwin" {
			log.GetLogger().Error("whisperkit只支持macos", zap.String("当前系统", runtime.GOOS))
			return fmt.Errorf("whisperkit只支持macos")
		}
		if Conf.Transcribe.Whisperkit.Model != "large-v2" {
			return errors.New("检测到开启了whisperkit，但模型选型配置不正确，请检查配置")
		}
	case "whispercpp":
		if runtime.GOOS != "windows" { // 当前先仅支持win，模型仅支持large-v2，最小化产品
			log.GetLogger().Error("whispercpp only support windows", zap.String("current os", runtime.GOOS))
			return fmt.Errorf("whispercpp only support windows")
		}
		if Conf.Transcribe.Whispercpp.Model != "tiny" && Conf.Transcribe.Whispercpp.Model != "medium" && Conf.Transcribe.Whispercpp.Model != "large-v2" {
			return errors.New("检测到开启了whisper.cpp，但模型选型配置不正确，请检查配置")
		}
	case "aliyun":
		if Conf.Transcribe.Aliyun.Speech.AccessKeyId == "" || Conf.Transcribe.Aliyun.Speech.AccessKeySecret == "" || Conf.Transcribe.Aliyun.Speech.AppKey == "" {
			return errors.New("使用阿里云语音服务需要配置相关密钥")
		}
	case "volcengine":
		if Conf.Transcribe.Volcengine.AppId == "" || Conf.Transcribe.Volcengine.AccessToken == "" {
			return errors.New("使用火山引擎语音识别需要配置 App ID 和 Access Token")
		}
	default:
		return errors.New("不支持的转录提供商")
	}

	return nil
}

func ValidateTTSConfig() error {
	switch Conf.Tts.Provider {
	case "openai":
		if Conf.Tts.Openai.ApiKey == "" {
			return errors.New("使用 OpenAI 配音服务需要配置 API Key")
		}
	case "aliyun":
		if Conf.Tts.Aliyun.ApiKey == "" {
			return errors.New("使用阿里云百炼配音服务需要配置 API Key")
		}
	case "minimax":
		if Conf.Tts.Minimax.ApiKey == "" {
			return errors.New("使用 MiniMax 配音服务需要配置 API Key")
		}
	case "volcengine":
		if Conf.Tts.Volcengine.AppId == "" || Conf.Tts.Volcengine.AccessToken == "" {
			return errors.New("使用火山引擎配音服务需要配置 App ID 和 Access Token")
		}
	case "edge-tts":
		return nil
	default:
		return errors.New("不支持的配音提供商")
	}
	return nil
}

func LoadConfig() bool {
	var err error
	configPath := "./config/config.toml"
	if _, err = os.Stat(configPath); os.IsNotExist(err) {
		log.GetLogger().Info("未找到配置文件")
		return false
	} else {
		log.GetLogger().Info("已找到配置文件，从配置文件中加载配置")
		if _, err = toml.DecodeFile(configPath, &Conf); err != nil {
			log.GetLogger().Error("加载配置文件失败", zap.Error(err))
			return false
		}
		return true
	}
}

// 验证配置
func CheckConfig() error {
	if err := CheckBaseConfig(); err != nil {
		return err
	}
	return ValidateTranscriptionConfig()
}

// CheckBaseConfig validates configuration shared by all CLI stages. A stage
// that can finish with platform captions must not require ASR credentials up
// front.
func CheckBaseConfig() error {
	var err error
	Conf.App.ParsedProxy, err = url.Parse(Conf.App.Proxy)
	return err
}

// SaveConfig 保存配置到文件
func SaveConfig() error {
	configPath := filepath.Join("config", "config.toml")

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		err = os.MkdirAll(filepath.Dir(configPath), os.ModePerm)
		if err != nil {
			return err
		}
	}

	data, err := toml.Marshal(Conf)
	if err != nil {
		return err
	}

	err = os.WriteFile(configPath, data, 0644)
	if err != nil {
		return err
	}

	return nil
}
