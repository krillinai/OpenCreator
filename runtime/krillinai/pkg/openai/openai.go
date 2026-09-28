package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	openai "github.com/sashabaranov/go-openai"
	"go.uber.org/zap"
	"io"
	"krillin-ai/config"
	"krillin-ai/log"
	"strings"
)

func (c *Client) ChatCompletion(query string) (string, error) {
	return c.ChatCompletionContext(context.Background(), query)
}

func (c *Client) ChatCompletionContext(ctx context.Context, query string) (string, error) {
	if c.requestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.requestTimeout)
		defer cancel()
	}
	var responseFormat *openai.ChatCompletionResponseFormat

	messages := []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: query}}
	isHyMT2 := config.Conf.Llm.Provider == "hy-mt2" || strings.Contains(strings.ToLower(config.Conf.Llm.Model), "hy-mt2")
	if !isHyMT2 {
		messages = append([]openai.ChatCompletionMessage{{
			Role:    openai.ChatMessageRoleSystem,
			Content: "You are an assistant that helps with subtitle translation.",
		}}, messages...)
	}
	req := openai.ChatCompletionRequest{
		Model:          config.Conf.Llm.Model,
		Messages:       messages,
		Temperature:    0.9,
		Stream:         true,
		MaxTokens:      8192,
		ResponseFormat: responseFormat,
	}
	if isHyMT2 {
		req.Temperature = 0.7
		req.MaxTokens = 4096
		if strings.Contains(strings.ToLower(config.Conf.Llm.Model), "30b-a3b") {
			req.TopP = 1.0
		} else {
			req.TopP = 0.6
		}
	}

	stream, err := c.client.CreateChatCompletionStream(ctx, req)
	if err != nil {
		log.GetLogger().Error("openai create chat completion stream failed", zap.Error(err))
		return "", normalizeChatCompletionError(err)
	}
	defer stream.Close()

	var resContent string
	for {
		response, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.GetLogger().Error("openai stream receive failed", zap.Error(err))
			return "", normalizeChatCompletionError(err)
		}
		if len(response.Choices) == 0 {
			log.GetLogger().Info("openai stream receive no choices", zap.Any("response", response))
			continue
		}

		resContent += response.Choices[0].Delta.Content
	}

	return resContent, nil
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
