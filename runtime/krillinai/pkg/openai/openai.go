package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	openai "github.com/sashabaranov/go-openai"
	"go.uber.org/zap"
	"krillin-ai/config"
	"krillin-ai/log"
	"strings"
)

func (c *Client) ChatCompletion(query string) (string, error) {
	return c.ChatCompletionContext(context.Background(), query)
}

func (c *Client) ChatCompletionContext(ctx context.Context, query string) (string, error) {
	return c.ChatCompletionContextWithMaxTokens(ctx, query, 8192)
}

func (c *Client) ChatCompletionContextWithMaxTokens(ctx context.Context, query string, maxTokens int) (string, error) {
	if maxTokens < 1 || maxTokens > 8192 {
		return "", fmt.Errorf("llm_translation_invalid_budget: output token budget must be between 1 and 8192")
	}
	if c.requestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.requestTimeout)
		defer cancel()
	}
	var responseFormat *openai.ChatCompletionResponseFormat

	req := openai.ChatCompletionRequest{
		Model: config.Conf.Llm.Model,
		Messages: []openai.ChatCompletionMessage{
			{
				Role:    openai.ChatMessageRoleSystem,
				Content: "You are an assistant that helps with subtitle translation.",
			},
			{
				Role:    openai.ChatMessageRoleUser,
				Content: query,
			},
		},
		MaxTokens:      maxTokens,
		ResponseFormat: responseFormat,
	}
	// DeepSeek V4 的推理可能耗尽字幕 JSON 的输出预算。
	switch strings.ToLower(strings.TrimSpace(req.Model)) {
	case "deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro":
		req.ReasoningEffort = "none"
		req.Temperature = 0.2
	}

	response, err := c.client.CreateChatCompletion(ctx, req)
	if err != nil {
		log.GetLogger().Error("openai chat completion failed", zap.Error(err))
		return "", normalizeChatCompletionError(err)
	}
	log.GetLogger().Info("openai chat completion received", zap.String("id", response.ID), zap.String("model", response.Model), zap.Any("usage", response.Usage))
	if len(response.Choices) > 0 && response.Choices[0].FinishReason == openai.FinishReasonLength {
		return "", fmt.Errorf("llm_translation_truncated: response %s exceeded its output token budget", response.ID)
	}
	if len(response.Choices) == 0 || strings.TrimSpace(response.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("llm_translation_empty_response: response %s has no content", response.ID)
	}
	return response.Choices[0].Message.Content, nil
}

func normalizeChatCompletionError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("llm_translation_timeout: %w", err)
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("llm_translation_canceled: %w", err)
	}
	return err
}

func (c *Client) Text2Speech(text, voice string, outputFile string) error {
	return NewTtsClient(
		config.Conf.Tts.Openai.BaseUrl,
		config.Conf.Tts.Openai.ApiKey,
		config.Conf.Tts.Openai.Model,
		config.Conf.App.Proxy,
	).Text2Speech(text, voice, outputFile)
}

func parseJSONResponse(jsonStr string) (string, error) {
	var response struct {
		Translations []struct {
			Original   string `json:"original_sentence"`
			Translated string `json:"translated_sentence"`
		} `json:"translations"`
	}

	err := json.Unmarshal([]byte(jsonStr), &response)
	if err != nil {
		return "", fmt.Errorf("failed to parse JSON: %v", err)
	}

	var result strings.Builder
	for i, item := range response.Translations {
		result.WriteString(fmt.Sprintf("%d\n%s\n%s\n\n",
			i+1,
			item.Translated,
			item.Original))
	}

	return result.String(), nil
}
