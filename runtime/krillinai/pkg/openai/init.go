package openai

import (
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/sashabaranov/go-openai"
)

const defaultRequestTimeout = 2 * time.Minute

type Client struct {
	client         *openai.Client
	requestTimeout time.Duration
}

func NewClient(baseUrl, apiKey, proxyAddr string) *Client {
	return newClient(baseUrl, apiKey, proxyAddr, defaultRequestTimeout)
}

func newClient(baseUrl, apiKey, proxyAddr string, requestTimeout time.Duration) *Client {
	cfg := openai.DefaultConfig(apiKey)
	if baseUrl != "" {
		cfg.BaseURL = baseUrl
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	// 非流式响应可能在生成完成后才发送响应头，由请求 context 统一限制总耗时。
	transport.ResponseHeaderTimeout = 0
	if proxyAddr != "" {
		if proxyURL, err := url.Parse(proxyAddr); err == nil {
			transport.Proxy = http.ProxyURL(proxyURL)
		}
	}
	cfg.HTTPClient = &http.Client{Transport: transport}

	client := openai.NewClientWithConfig(cfg)
	return &Client{client: client, requestTimeout: requestTimeout}
}
