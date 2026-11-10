package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"krillin-ai/config"
	"krillin-ai/internal/types"
)

const (
	DefaultTTSBaseURL = "https://api.openai.com/v1"
	DefaultTTSModel   = "gpt-4o-mini-tts"
	DefaultTTSVoice   = "marin"
	// Gateway receipts can remain pending while a speech segment is generated.
	ttsTimeout = 10 * time.Minute
)

type TtsClient struct {
	BaseURL    string
	APIKey     string
	Model      string
	httpClient *http.Client
}

type SpeechHTTPError struct {
	StatusCode   int
	UpstreamCode string
	RequestID    string
	Message      string
}

func (e *SpeechHTTPError) Error() string { return e.Message }

var speechDiagnosticCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)
var speechGatewayRequestID = regexp.MustCompile(`^ocreq_[0-9a-f]{48}$`)

func NewTtsClient(baseURL, apiKey, model, proxy string) *TtsClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultTTSBaseURL
	}
	if strings.TrimSpace(model) == "" {
		model = DefaultTTSModel
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyURL, err := url.Parse(strings.TrimSpace(config.ProxyForBaseURL(baseURL, proxy))); err == nil && proxyURL.Scheme != "" {
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &TtsClient{
		BaseURL: baseURL,
		APIKey:  strings.TrimSpace(apiKey),
		Model:   strings.TrimSpace(model),
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   ttsTimeout,
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
		return fmt.Errorf("openai tts api key is empty")
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
	requestBody := map[string]any{
		"model":           c.Model,
		"input":           options.Text,
		"voice":           voice,
		"response_format": format,
		"speed":           speed,
	}
	if strings.TrimSpace(options.Instructions) != "" && strings.Contains(strings.ToLower(c.Model), "gpt-4o") {
		requestBody["instructions"] = strings.TrimSpace(options.Instructions)
	}
	body, err := json.Marshal(requestBody)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, ttsTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/audio/speech", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		var payload struct {
			Error struct {
				Code string `json:"code"`
				Type string `json:"type"`
			} `json:"error"`
		}
		_ = json.Unmarshal(message, &payload)
		upstreamCode := payload.Error.Code
		if !speechDiagnosticCode.MatchString(upstreamCode) {
			upstreamCode = ""
		}
		if upstreamCode == "" && speechDiagnosticCode.MatchString(payload.Error.Type) {
			upstreamCode = payload.Error.Type
		}
		requestID := response.Header.Get("X-Request-ID")
		if !speechGatewayRequestID.MatchString(requestID) {
			requestID = ""
		}
		return &SpeechHTTPError{StatusCode: response.StatusCode, UpstreamCode: upstreamCode, RequestID: requestID,
			Message: fmt.Sprintf("openai tts returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))}
	}
	if err := os.MkdirAll(filepath.Dir(options.OutputFile), 0755); err != nil {
		return err
	}
	file, err := os.Create(options.OutputFile)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, io.LimitReader(response.Body, 100<<20))
	return err
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

func (c *TtsClient) ListVoices(context.Context) ([]types.TTSVoice, error) {
	return append([]types.TTSVoice(nil), openAIBuiltinVoices...), nil
}

var openAIBuiltinVoices = []types.TTSVoice{
	{Code: "alloy", Name: "Alloy", Language: "multi", Provider: "openai", Scenario: "均衡", Kind: "builtin"},
	{Code: "ash", Name: "Ash", Language: "multi", Provider: "openai", Scenario: "沉稳", Kind: "builtin"},
	{Code: "ballad", Name: "Ballad", Language: "multi", Provider: "openai", Scenario: "表现力", Kind: "builtin"},
	{Code: "cedar", Name: "Cedar", Language: "multi", Provider: "openai", Scenario: "自然", Kind: "builtin", Recommended: true},
	{Code: "coral", Name: "Coral", Language: "multi", Provider: "openai", Scenario: "温暖", Kind: "builtin"},
	{Code: "echo", Name: "Echo", Language: "multi", Provider: "openai", Scenario: "清晰", Kind: "builtin"},
	{Code: "fable", Name: "Fable", Language: "multi", Provider: "openai", Scenario: "叙事", Kind: "builtin"},
	{Code: "marin", Name: "Marin", Language: "multi", Provider: "openai", Scenario: "自然", Kind: "builtin", Recommended: true},
	{Code: "nova", Name: "Nova", Language: "multi", Provider: "openai", Scenario: "明快", Kind: "builtin"},
	{Code: "onyx", Name: "Onyx", Language: "multi", Provider: "openai", Scenario: "低沉", Kind: "builtin"},
	{Code: "sage", Name: "Sage", Language: "multi", Provider: "openai", Scenario: "中性", Kind: "builtin"},
	{Code: "shimmer", Name: "Shimmer", Language: "multi", Provider: "openai", Scenario: "柔和", Kind: "builtin"},
	{Code: "verse", Name: "Verse", Language: "multi", Provider: "openai", Scenario: "表达", Kind: "builtin"},
}
