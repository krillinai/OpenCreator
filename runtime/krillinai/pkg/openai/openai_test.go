package openai

import (
	"context"
	"encoding/json"
	"errors"
	"krillin-ai/config"
	"krillin-ai/log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestChatCompletionParsesSelfHostedStream(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		var body struct {
			Model  string `json:"model"`
			Stream bool   `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "test-model" || !body.Stream {
			t.Errorf("request = %+v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()
	client := newClient(server.URL+"/v1", "", "", time.Second)
	got, err := client.ChatCompletion("Translate Hello")
	if err != nil || got != "你好" {
		t.Fatalf("completion = %q, %v", got, err)
	}
}

func TestHyMT2UsesUserPromptWithoutSystemMessage(t *testing.T) {
	setTestModel(t)
	previousProvider := config.Conf.Llm.Provider
	config.Conf.Llm.Provider = "hy-mt2"
	config.Conf.Llm.Model = "local-translation-model"
	t.Cleanup(func() { config.Conf.Llm.Provider = previousProvider })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Messages) != 1 || body.Messages[0].Role != "user" {
			t.Errorf("messages = %+v", body.Messages)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()
	_, err := newClient(server.URL+"/v1", "", "", time.Second).ChatCompletion("Translate Hello")
	if err != nil {
		t.Fatal(err)
	}
}

func TestChatCompletionPropagatesSelfHostedError(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"model unavailable","type":"server_error"}}`, http.StatusServiceUnavailable)
	}))
	defer server.Close()
	_, err := newClient(server.URL+"/v1", "", "", time.Second).ChatCompletion("Translate Hello")
	if err == nil {
		t.Fatal("expected provider error")
	}
}

func TestChatCompletionTimesOut(t *testing.T) {
	setTestModel(t)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() {
		close(release)
		server.Close()
	})

	client := newClient(server.URL, "test-key", "", 40*time.Millisecond)
	_, err := client.ChatCompletion("translate")
	if err == nil || !strings.Contains(err.Error(), "llm_translation_timeout") {
		t.Fatalf("ChatCompletion() error = %v, want llm_translation_timeout", err)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ChatCompletion() error = %v, want context deadline", err)
	}
}

func TestNewClientUsesConfiguredTimeout(t *testing.T) {
	previous := config.Conf.Llm.TimeoutSeconds
	config.Conf.Llm.TimeoutSeconds = 7
	t.Cleanup(func() { config.Conf.Llm.TimeoutSeconds = previous })
	if got := NewClient("http://127.0.0.1:8000/v1", "", "").requestTimeout; got != 7*time.Second {
		t.Fatalf("request timeout = %v, want 7s", got)
	}
}

func TestChatCompletionHonorsParentCancellation(t *testing.T) {
	setTestModel(t)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() {
		close(release)
		server.Close()
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := newClient(server.URL, "test-key", "", time.Second)
	_, err := client.ChatCompletionContext(ctx, "translate")
	if err == nil || !strings.Contains(err.Error(), "llm_translation_canceled") {
		t.Fatalf("ChatCompletionContext() error = %v, want llm_translation_canceled", err)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ChatCompletionContext() error = %v, want context canceled", err)
	}
}

func TestNewClientUsesConfiguredProxy(t *testing.T) {
	setTestModel(t)
	var requests atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "proxy reached", http.StatusBadGateway)
	}))
	defer proxy.Close()

	client := newClient("http://upstream.invalid/v1", "test-key", proxy.URL, time.Second)
	_, _ = client.ChatCompletion("translate")
	if requests.Load() != 1 {
		t.Fatalf("proxy requests = %d, want 1", requests.Load())
	}
}

func setTestModel(t *testing.T) {
	t.Helper()
	log.InitLogger()
	previous := config.Conf.Llm.Model
	config.Conf.Llm.Model = "test-model"
	t.Cleanup(func() { config.Conf.Llm.Model = previous })
}
