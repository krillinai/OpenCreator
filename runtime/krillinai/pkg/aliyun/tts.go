package aliyun

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"krillin-ai/internal/resourcepath"
	"krillin-ai/internal/types"
)

const (
	DefaultTTSBaseURL = "https://dashscope.aliyuncs.com/api/v1"
	DefaultTTSModel   = "qwen3-tts-flash"
	DefaultTTSVoice   = "Cherry"
)

type TtsClient struct {
	BaseURL    string
	APIKey     string
	Model      string
	httpClient *http.Client
}

type ttsRequest struct {
	Model string   `json:"model"`
	Input ttsInput `json:"input"`
}

type ttsInput struct {
	Text         string `json:"text"`
	Voice        string `json:"voice"`
	LanguageType string `json:"language_type"`
}

type ttsResponse struct {
	Output struct {
		Audio struct {
			URL string `json:"url"`
		} `json:"audio"`
	} `json:"output"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
}

func NewTtsClient(baseURL, apiKey, model, proxy string) *TtsClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultTTSBaseURL
	}
	if strings.TrimSpace(model) == "" {
		model = DefaultTTSModel
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyURL, err := url.Parse(strings.TrimSpace(proxy)); err == nil && proxyURL.Scheme != "" {
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &TtsClient{
		BaseURL: baseURL,
		APIKey:  strings.TrimSpace(apiKey),
		Model:   strings.TrimSpace(model),
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   90 * time.Second,
		},
	}
}

func (c *TtsClient) Text2Speech(text, voice, outputFile string) error {
	return c.Synthesize(context.Background(), types.TTSSpeechOptions{
		Text:       text,
		Voice:      voice,
		OutputFile: outputFile,
	})
}

func (c *TtsClient) Synthesize(ctx context.Context, options types.TTSSpeechOptions) error {
	if c.APIKey == "" {
		return fmt.Errorf("aliyun bailian tts api key is empty")
	}
	voice := strings.TrimSpace(options.Voice)
	if voice == "" {
		voice = DefaultTTSVoice
	}
	format := speechFormat(options.Format, options.OutputFile)
	speed := options.Speed
	if speed <= 0 {
		speed = 1
	}
	body, err := json.Marshal(ttsRequest{
		Model: c.Model,
		Input: ttsInput{
			Text:         options.Text,
			Voice:        voice,
			LanguageType: "Auto",
		},
	})
	if err != nil {
		return fmt.Errorf("aliyun bailian tts encode request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.generationEndpoint(),
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	// DashScope deployments accept the API key header. Keep Authorization for
	// older compatible gateways while sending the header required by the
	// current Qwen TTS endpoint.
	req.Header.Set("api-key", c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("aliyun bailian tts request failed: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("aliyun bailian tts returned HTTP %d: %s", response.StatusCode, boundedMessage(responseBody))
	}
	var decoded ttsResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return fmt.Errorf("aliyun bailian tts decode response: %w", err)
	}
	if decoded.Code != "" {
		return fmt.Errorf("aliyun bailian tts error %s: %s", decoded.Code, decoded.Message)
	}
	if decoded.Output.Audio.URL == "" {
		return fmt.Errorf("aliyun bailian tts response did not include an audio URL")
	}
	return c.downloadAndProcessAudio(
		ctx,
		decoded.Output.Audio.URL,
		options.OutputFile,
		format,
		speed,
	)
}

func (c *TtsClient) ListVoices(context.Context) ([]types.TTSVoice, error) {
	return append([]types.TTSVoice(nil), aliyunBuiltinVoices...), nil
}

func (c *TtsClient) generationEndpoint() string {
	if strings.HasSuffix(c.BaseURL, "/services/aigc/multimodal-generation/generation") {
		return c.BaseURL
	}
	return c.BaseURL + "/services/aigc/multimodal-generation/generation"
}

func (c *TtsClient) downloadAudio(ctx context.Context, source, outputFile string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return err
	}
	response, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("aliyun bailian tts download audio: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("aliyun bailian audio download returned HTTP %d", response.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(outputFile), 0755); err != nil {
		return err
	}
	file, err := os.Create(outputFile)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := io.Copy(file, io.LimitReader(response.Body, 100<<20)); err != nil {
		return err
	}
	return nil
}

func boundedMessage(value []byte) string {
	const limit = 300
	message := strings.TrimSpace(string(value))
	if len(message) <= limit {
		return message
	}
	return message[:limit]
}

func (c *TtsClient) downloadAndProcessAudio(
	ctx context.Context,
	source string,
	outputFile string,
	format string,
	speed float64,
) error {
	outputDir := filepath.Dir(outputFile)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return err
	}
	native, err := os.CreateTemp(outputDir, ".aliyun-tts-*.wav")
	if err != nil {
		return err
	}
	nativePath := native.Name()
	if err := native.Close(); err != nil {
		return err
	}
	defer os.Remove(nativePath)
	if err := c.downloadAudio(ctx, source, nativePath); err != nil {
		return err
	}
	if format == "wav" && speed == 1 {
		if err := os.Remove(outputFile); err != nil && !os.IsNotExist(err) {
			return err
		}
		return os.Rename(nativePath, outputFile)
	}
	return transcodeAudio(ctx, nativePath, outputFile, format, speed)
}

func transcodeAudio(ctx context.Context, input, output, format string, speed float64) error {
	ffmpeg, err := ffmpegPath()
	if err != nil {
		return err
	}
	args := []string{"-y", "-i", input}
	if speed != 1 {
		args = append(args, "-filter:a", "atempo="+strconv.FormatFloat(speed, 'f', 3, 64))
	}
	args = append(args, "-ar", "44100", "-ac", "1")
	if format == "mp3" {
		args = append(args, "-c:a", "libmp3lame", "-b:a", "192k")
	} else {
		args = append(args, "-c:a", "pcm_s16le")
	}
	args = append(args, output)
	command := exec.CommandContext(ctx, ffmpeg, args...)
	if result, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("aliyun bailian tts audio conversion failed: %w, output: %s", err, boundedMessage(result))
	}
	return nil
}

func ffmpegPath() (string, error) {
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if root, configured, err := resourcepath.Root(); err != nil {
		return "", err
	} else if configured {
		path, err := resourcepath.RequireFile("bin", name)
		if err != nil {
			return "", fmt.Errorf("aliyun bailian tts requires packaged ffmpeg under %s: %w", root, err)
		}
		return path, nil
	}
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("aliyun bailian tts requires ffmpeg for MP3 or speed conversion: %w", err)
	}
	return path, nil
}

var aliyunBuiltinVoices = []types.TTSVoice{
	{Code: "Cherry", Name: "芊悦", Language: "zh-CN", Gender: "female", Provider: "aliyun", Scenario: "阳光积极", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}, Recommended: true},
	{Code: "Serena", Name: "苏瑶", Language: "zh-CN", Gender: "female", Provider: "aliyun", Scenario: "温柔叙事", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Ethan", Name: "晨煦", Language: "zh-CN", Gender: "male", Provider: "aliyun", Scenario: "阳光男声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Chelsie", Name: "千雪", Language: "zh-CN", Gender: "female", Provider: "aliyun", Scenario: "二次元", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Momo", Name: "茉兔", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "撒娇搞怪", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Vivian", Name: "十三", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "可爱小暴躁", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Moon", Name: "月白", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "率性帅气", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Maia", Name: "四月", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "知性温柔", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Kai", Name: "凯", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "舒缓自然", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Nofish", Name: "不吃鱼", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "自然设计师", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Bella", Name: "萌宝", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "活泼萝莉", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Jennifer", Name: "詹妮弗", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "电影质感美语", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Ryan", Name: "甜茶", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "戏感张力", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Katerina", Name: "卡捷琳娜", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "成熟御姐", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Aiden", Name: "艾登", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "美语青年", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Eldric Sage", Name: "沧明子", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "沉稳睿智老者", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Mia", Name: "乖小妹", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "温顺乖巧", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Mochi", Name: "沙小弥", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "聪慧少年", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Bellona", Name: "燕铮莺", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "洪亮热血", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Vincent", Name: "田叔", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "沙哑豪迈", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Bunny", Name: "萌小姬", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "萌系萝莉", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Neil", Name: "阿闻", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "新闻主持", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Elias", Name: "墨讲师", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "知识讲解", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Arthur", Name: "徐大爷", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "乡土故事", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Nini", Name: "邻家妹妹", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "甜软亲切", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Seren", Name: "小婉", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "舒缓助眠", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Pip", Name: "顽屁小孩", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "调皮童声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Stella", Name: "少女阿月", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "甜美少女", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Bodega", Name: "博德加", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "西班牙男声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Sonrisa", Name: "索尼莎", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "拉美女声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Alek", Name: "阿列克", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "俄语男声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Dolce", Name: "多尔切", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "意大利男声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Sohee", Name: "素熙", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "韩语女声", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Ono Anna", Name: "小野杏", Language: "multi", Gender: "female", Provider: "aliyun", Scenario: "日语少女", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Lenn", Name: "莱恩", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "德语青年", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Emilien", Name: "埃米尔安", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "法语青年", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Andre", Name: "安德雷", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "磁性沉稳", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Radio Gol", Name: "拉迪奥·戈尔", Language: "multi", Gender: "male", Provider: "aliyun", Scenario: "足球解说", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Jada", Name: "上海-阿珍", Language: "zh-shanghai", Gender: "female", Provider: "aliyun", Scenario: "上海话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Dylan", Name: "北京-晓东", Language: "zh-beijing", Gender: "male", Provider: "aliyun", Scenario: "北京话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Li", Name: "南京-老李", Language: "zh-nanjing", Gender: "male", Provider: "aliyun", Scenario: "南京话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Marcus", Name: "陕西-秦川", Language: "zh-shaanxi", Gender: "male", Provider: "aliyun", Scenario: "陕西话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Roy", Name: "闽南-阿杰", Language: "zh-minnan", Gender: "male", Provider: "aliyun", Scenario: "闽南语", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Peter", Name: "天津-李彼得", Language: "zh-tianjin", Gender: "male", Provider: "aliyun", Scenario: "天津话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Sunny", Name: "四川-晴儿", Language: "zh-sichuan", Gender: "female", Provider: "aliyun", Scenario: "四川话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Eric", Name: "四川-程川", Language: "zh-sichuan", Gender: "male", Provider: "aliyun", Scenario: "四川话", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Rocky", Name: "粤语-阿强", Language: "zh-yue", Gender: "male", Provider: "aliyun", Scenario: "粤语", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
	{Code: "Kiki", Name: "粤语-阿清", Language: "zh-yue", Gender: "female", Provider: "aliyun", Scenario: "粤语", Kind: "builtin", SupportedModels: []string{"qwen3-tts-flash"}},
}

func speechFormat(explicit, outputFile string) string {
	format := strings.ToLower(strings.TrimSpace(explicit))
	if format == "mp3" || format == "wav" {
		return format
	}
	if strings.EqualFold(filepath.Ext(outputFile), ".mp3") {
		return "mp3"
	}
	return "wav"
}
