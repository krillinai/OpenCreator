package whisper

import (
	"github.com/sashabaranov/go-openai"
	"krillin-ai/config"
	"net/http"
)

type Client struct {
	client   *openai.Client
	model    string
	official bool
}

func NewClient(baseUrl, apiKey, proxyAddr string) *Client {
	cfg := openai.DefaultConfig(apiKey)
	if baseUrl != "" {
		cfg.BaseURL = baseUrl
	}

	if proxyAddr != "" {
		transport := &http.Transport{
			Proxy: http.ProxyURL(config.Conf.App.ParsedProxy),
		}
		cfg.HTTPClient = &http.Client{
			Transport: transport,
		}
	}

	cfg.HTTPClient = &audioResponseClient{next: cfg.HTTPClient}
	client := openai.NewClientWithConfig(cfg)
	return &Client{client: client, model: openai.Whisper1}
}

func NewOfficialClient(baseUrl, apiKey, proxyAddr, model string) *Client {
	c := NewClient(baseUrl, apiKey, proxyAddr)
	c.model, c.official = model, true
	return c
}
