package volcengine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"krillin-ai/internal/types"

	"github.com/google/uuid"
)

const (
	DefaultTTSBaseURL  = "https://openspeech.bytedance.com"
	DefaultTTSCluster  = "volcano_tts"
	DefaultTTSVoice    = "BV001_streaming"
	ttsPath            = "/api/v1/tts"
	ttsV3Path          = "/api/v3/tts/unidirectional"
	ttsSuccessCode     = 3000
	ttsV3SuccessCode   = 20000000
	maxTTSTextBytes    = 1024
)

type TtsClient struct {
	BaseURL     string
	AppID       string
	AccessToken string
	Cluster     string
	httpClient  *http.Client
}

func NewTtsClient(baseURL, appID, accessToken, cluster, proxy string) *TtsClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultTTSBaseURL
	}
	cluster = strings.TrimSpace(cluster)
	if cluster == "" {
		cluster = DefaultTTSCluster
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyURL, err := url.Parse(strings.TrimSpace(proxy)); err == nil && proxyURL.Scheme != "" {
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &TtsClient{
		BaseURL:     baseURL,
		AppID:       strings.TrimSpace(appID),
		AccessToken: strings.TrimSpace(accessToken),
		Cluster:     cluster,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   90 * time.Second,
		},
	}
}

type ttsRequest struct {
	App     ttsApp     `json:"app"`
	User    ttsUser    `json:"user"`
	Audio   ttsAudio   `json:"audio"`
	Request ttsPayload `json:"request"`
}

type ttsApp struct {
	AppID   string `json:"appid"`
	Token   string `json:"token"`
	Cluster string `json:"cluster"`
}

type ttsUser struct {
	UID string `json:"uid"`
}

type ttsAudio struct {
	VoiceType  string  `json:"voice_type"`
	Encoding   string  `json:"encoding"`
	SpeedRatio float64 `json:"speed_ratio"`
}

type ttsPayload struct {
	ReqID     string `json:"reqid"`
	Text      string `json:"text"`
	TextType  string `json:"text_type"`
	Operation string `json:"operation"`
}

type ttsResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func (c *TtsClient) Text2Speech(text, voice, outputFile string) error {
	return c.Synthesize(context.Background(), types.TTSSpeechOptions{
		Text:       text,
		Voice:      voice,
		OutputFile: outputFile,
	})
}

func (c *TtsClient) Synthesize(ctx context.Context, options types.TTSSpeechOptions) error {
	if c.AppID == "" || c.AccessToken == "" {
		return fmt.Errorf("volcengine tts app id or access token is empty")
	}
	text := strings.TrimSpace(options.Text)
	if text == "" {
		return fmt.Errorf("volcengine tts text is empty")
	}
	if utf8.RuneCountInString(text) > 0 && len(text) > maxTTSTextBytes {
		return fmt.Errorf("volcengine tts text exceeds %d bytes", maxTTSTextBytes)
	}
	voice := strings.TrimSpace(options.Voice)
	if voice == "" {
		voice = DefaultTTSVoice
	}
	speed := options.Speed
	if speed <= 0 {
		speed = 1
	}
	format := speechFormat(options.Format, options.OutputFile)
	api, resource := resolveTTSRoute(c.Cluster, voice)
	if api == "v3" {
		return c.synthesizeV3(ctx, options, voice, format, resource)
	}
	body, err := json.Marshal(ttsRequest{
		App: ttsApp{
			AppID:   c.AppID,
			Token:   c.AccessToken,
			Cluster: resource,
		},
		User: ttsUser{UID: "opencreator"},
		Audio: ttsAudio{
			VoiceType:  voice,
			Encoding:   format,
			SpeedRatio: speed,
		},
		Request: ttsPayload{
			ReqID:     uuid.NewString(),
			Text:      text,
			TextType:  "plain",
			Operation: "query",
		},
	})
	if err != nil {
		return err
	}
	endpoint := c.BaseURL + ttsPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer;"+c.AccessToken)
	response, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("volcengine tts request failed: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("volcengine tts returned HTTP %d: %s", response.StatusCode, boundedMessage(payload))
	}
	var decoded ttsResponse
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return fmt.Errorf("volcengine tts decode response: %w", err)
	}
	if decoded.Code != ttsSuccessCode {
		return fmt.Errorf("volcengine tts error %d: %s", decoded.Code, decoded.Message)
	}
	if strings.TrimSpace(decoded.Data) == "" {
		return fmt.Errorf("volcengine tts response did not include audio")
	}
	audio, err := base64.StdEncoding.DecodeString(decoded.Data)
	if err != nil {
		return fmt.Errorf("volcengine tts decode audio: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(options.OutputFile), 0755); err != nil {
		return err
	}
	return os.WriteFile(options.OutputFile, audio, 0644)
}

func (c *TtsClient) ListVoices(context.Context) ([]types.TTSVoice, error) {
	return append([]types.TTSVoice(nil), volcengineBuiltinVoices...), nil
}

func (c *TtsClient) synthesizeV3(ctx context.Context, options types.TTSSpeechOptions, voice, format, resourceID string) error {
	speed := options.Speed
	if speed <= 0 {
		speed = 1
	}
	speechRate := int((speed - 1) * 100)
	if speechRate < -50 {
		speechRate = -50
	}
	if speechRate > 100 {
		speechRate = 100
	}
	body, err := json.Marshal(map[string]any{
		"user": map[string]string{"uid": "opencreator"},
		"req_params": map[string]any{
			"text":    options.Text,
			"speaker": voice,
			"audio_params": map[string]any{
				"format":      format,
				"sample_rate": 24000,
				"speech_rate": speechRate,
			},
		},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+ttsV3Path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-App-Id", c.AppID)
	req.Header.Set("X-Api-Access-Key", c.AccessToken)
	req.Header.Set("X-Api-Resource-Id", resourceID)
	req.Header.Set("X-Api-Request-Id", uuid.NewString())
	response, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("volcengine tts 2.0 request failed: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 20<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("volcengine tts 2.0 returned HTTP %d: %s", response.StatusCode, boundedMessage(payload))
	}
	var audio []byte
	for _, line := range strings.Split(string(payload), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var decoded ttsV3Chunk
		if err := json.Unmarshal([]byte(line), &decoded); err != nil {
			continue
		}
		if decoded.Code == ttsV3SuccessCode {
			break
		}
		if decoded.Code != 0 {
			return fmt.Errorf("volcengine tts 2.0 error %d: %s", decoded.Code, decoded.Message)
		}
		if decoded.Data == "" {
			continue
		}
		chunk, err := base64.StdEncoding.DecodeString(decoded.Data)
		if err != nil {
			return fmt.Errorf("volcengine tts 2.0 decode audio: %w", err)
		}
		audio = append(audio, chunk...)
	}
	if len(audio) == 0 {
		return fmt.Errorf("volcengine tts 2.0 response did not include audio")
	}
	if err := os.MkdirAll(filepath.Dir(options.OutputFile), 0755); err != nil {
		return err
	}
	return os.WriteFile(options.OutputFile, audio, 0644)
}

type ttsV3Chunk struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func resolveTTSRoute(cluster, voice string) (api, resource string) {
	cluster = strings.TrimSpace(cluster)
	voice = strings.TrimSpace(voice)
	switch {
	case strings.HasPrefix(voice, "S_"):
		if strings.HasPrefix(cluster, "volcano_icl") || strings.HasPrefix(cluster, "seed-icl") {
			if strings.HasPrefix(cluster, "seed-") {
				return "v3", cluster
			}
			return "v1", cluster
		}
		return "v3", "seed-icl-2.0"
	case strings.HasPrefix(voice, "ICL_"), strings.Contains(voice, "_uranus_bigtts"), strings.Contains(voice, "_jupiter_bigtts"), strings.HasPrefix(voice, "saturn_"):
		if strings.HasPrefix(cluster, "seed-tts-2") {
			return "v3", cluster
		}
		return "v3", "seed-tts-2.0"
	case strings.Contains(voice, "_mars_bigtts"), strings.Contains(voice, "_moon_bigtts"), strings.Contains(voice, "_wvae_bigtts"):
		if strings.HasPrefix(cluster, "seed-tts-1") {
			return "v3", cluster
		}
		return "v3", "seed-tts-1.0"
	case strings.HasPrefix(cluster, "seed-"):
		return "v3", cluster
	case cluster == "":
		return "v1", DefaultTTSCluster
	default:
		return "v1", cluster
	}
}

func speechFormat(explicit, outputFile string) string {
	format := strings.ToLower(strings.TrimSpace(explicit))
	if format == "mp3" || format == "wav" {
		return format
	}
	if strings.EqualFold(filepath.Ext(outputFile), ".wav") {
		return "wav"
	}
	if strings.EqualFold(filepath.Ext(outputFile), ".mp3") {
		return "mp3"
	}
	return "mp3"
}

var volcengineBuiltinVoices = []types.TTSVoice{
	{Code: "BV001_streaming", Name: "通用女声", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "通用场景", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}, Recommended: true},
	{Code: "BV002_streaming", Name: "通用男声", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "通用场景", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}, Recommended: true},
	{Code: "BV007_streaming", Name: "亲切女声", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "智能助手", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV009_streaming", Name: "知性女声", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "智能助手", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV019_streaming", Name: "重庆小伙", Language: "zh-sichuan", Gender: "male", Provider: "volcengine", Scenario: "方言", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV033_streaming", Name: "温柔小哥", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "教育场景", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV056_streaming", Name: "阳光男声", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "视频配音", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV102_streaming", Name: "儒雅青年", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "有声阅读", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV107_streaming", Name: "霸气青叔", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "有声阅读", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV113_streaming", Name: "甜宠少御", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "有声阅读", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV115_streaming", Name: "古风少御", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "有声阅读", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV119_streaming", Name: "通用赘婿", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "有声阅读", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}},
	{Code: "BV700_streaming", Name: "灿灿", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "通用场景", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}, Recommended: true},
	{Code: "BV701_streaming", Name: "擎苍", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "有声阅读", Kind: "builtin", SupportedModels: []string{DefaultTTSCluster}, Recommended: true},
	{Code: "zh_female_cancan_uranus_bigtts", Name: "知性灿灿 2.0", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "豆包 2.0", Kind: "builtin", SupportedModels: []string{"seed-tts-2.0"}, Recommended: true},
	{Code: "zh_female_vv_uranus_bigtts", Name: "Vivi 2.0", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "豆包 2.0", Kind: "builtin", SupportedModels: []string{"seed-tts-2.0"}, Recommended: true},
	{Code: "zh_female_gaolengyujie_uranus_bigtts", Name: "高冷御姐 2.0", Language: "zh-CN", Gender: "female", Provider: "volcengine", Scenario: "豆包 2.0", Kind: "builtin", SupportedModels: []string{"seed-tts-2.0"}, Recommended: true},
	{Code: "zh_male_m191_uranus_bigtts", Name: "云舟 2.0", Language: "zh-CN", Gender: "male", Provider: "volcengine", Scenario: "豆包 2.0", Kind: "builtin", SupportedModels: []string{"seed-tts-2.0"}, Recommended: true},
}
