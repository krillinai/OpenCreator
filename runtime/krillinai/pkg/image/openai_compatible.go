package image

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const defaultOpenAIImageBaseURL = "https://api.openai.com/v1"

type GenerateRequest struct {
	Prompt string
	Size   string
}

type GenerateResult struct {
	B64JSON string
	URL     string
}

type OpenAICompatibleClient struct {
	baseURL    string
	apiKey     string
	model      string
	httpClient *http.Client
}

func NewOpenAICompatibleClient(baseURL, apiKey, model string) *OpenAICompatibleClient {
	if baseURL == "" {
		baseURL = defaultOpenAIImageBaseURL
	}
	return &OpenAICompatibleClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		model:      model,
		httpClient: http.DefaultClient,
	}
}

func (c *OpenAICompatibleClient) Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error) {
	size := req.Size
	if size == "" {
		size = "1024x1024"
	}
	body := map[string]string{
		"model":  c.model,
		"prompt": req.Prompt,
		"size":   size,
	}
	if !strings.HasPrefix(c.model, "gpt-image-") {
		body["response_format"] = "b64_json"
	}
	data, err := json.Marshal(body)
	if err != nil {
		return GenerateResult{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/images/generations", bytes.NewReader(data))
	if err != nil {
		return GenerateResult{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return GenerateResult{}, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return GenerateResult{}, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return GenerateResult{}, fmt.Errorf("image generation failed: status %d: %s", resp.StatusCode, string(respBody))
	}
	var parsed struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return GenerateResult{}, err
	}
	if len(parsed.Data) == 0 || (parsed.Data[0].B64JSON == "" && parsed.Data[0].URL == "") {
		return GenerateResult{}, fmt.Errorf("image generation response missing b64_json or url")
	}
	return GenerateResult{B64JSON: parsed.Data[0].B64JSON, URL: parsed.Data[0].URL}, nil
}
