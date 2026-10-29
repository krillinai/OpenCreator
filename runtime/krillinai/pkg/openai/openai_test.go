package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestChatCompletionReceivesCompleteJSON(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Stream {
			t.Errorf("请求应使用非流式JSON: stream=%v error=%v", request.Stream, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"complete-json","choices":[{"message":{"role":"assistant","content":"完整译文"}}]}`))
	}))
	defer server.Close()
	text, err := newClient(server.URL, "test-key", "", time.Second).ChatCompletion("translate")
	if err != nil || text != "完整译文" {
		t.Fatalf("text=%q error=%v", text, err)
	}
}

func TestChatCompletionSendsRequestedOutputBudget(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			MaxTokens int `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.MaxTokens != 2048 {
			t.Errorf("输出预算未传给供应商: %d %v", request.MaxTokens, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"你好。"}}]}`))
	}))
	defer server.Close()
	client := newClient(server.URL, "test-key", "", time.Second)
	if text, err := client.ChatCompletionContextWithMaxTokens(context.Background(), "translate", 2048); err != nil || text != "你好。" {
		t.Fatalf("text=%q err=%v", text, err)
	}
	for _, budget := range []int{0, -1, 8193} {
		if _, err := client.ChatCompletionContextWithMaxTokens(context.Background(), "translate", budget); err == nil {
			t.Fatalf("无效预算被接受: %d", budget)
		}
	}
}

func TestChatCompletionRejectsEmptyResponse(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"empty","choices":[]}`))
	}))
	defer server.Close()
	_, err := newClient(server.URL, "test-key", "", time.Second).ChatCompletion("translate")
	if err == nil || !strings.Contains(err.Error(), "llm_translation_empty_response") {
		t.Fatalf("未明确拒绝空响应: %v", err)
	}
}

func TestChatCompletionDisablesDeepSeekV4Thinking(t *testing.T) {
	for _, model := range []string{"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "test-model"} {
		t.Run(model, func(t *testing.T) {
			setTestModel(t)
			config.Conf.Llm.Model = model
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Model           string   `json:"model"`
					ReasoningEffort string   `json:"reasoning_effort"`
					Temperature     *float32 `json:"temperature"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				want := "none"
				if model == "deepseek-chat" || model == "test-model" {
					want = ""
				}
				if request.Model != model || request.ReasoningEffort != want {
					t.Errorf("model=%q reasoning_effort=%q, want %q %q", request.Model, request.ReasoningEffort, model, want)
				}
				if want == "none" && (request.Temperature == nil || *request.Temperature != 0.2) {
					t.Errorf("DeepSeek V4 temperature = %v, want 0.2", request.Temperature)
				}
				if want == "" && request.Temperature != nil {
					t.Errorf("model %q should use default sampling", model)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"translated","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"完整译文"}}]}`))
			}))
			defer server.Close()
			if _, err := newClient(server.URL, "test-key", "", time.Second).ChatCompletion("translate"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestChatCompletionRejectsTruncatedResponse(t *testing.T) {
	for _, content := range []string{"", `{"sentences":[`} {
		t.Run(content, func(t *testing.T) {
			setTestModel(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"id":"truncated","choices":[{"finish_reason":"length","message":{"role":"assistant","content":%q}}]}`, content)
			}))
			defer server.Close()
			text, err := newClient(server.URL, "test-key", "", time.Second).ChatCompletion("translate")
			if text != "" || err == nil || !strings.Contains(err.Error(), "llm_translation_truncated") {
				t.Fatalf("截断响应不应作为译文或普通空响应返回: text=%q error=%v", text, err)
			}
		})
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

func TestChatCompletionUsesDefaultSampling(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if _, exists := request["temperature"]; exists {
			t.Error("default model should not send temperature")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"default-sampling","choices":[{"message":{"role":"assistant","content":"完整译文"}}]}`))
	}))
	defer server.Close()
	if _, err := newClient(server.URL, "test-key", "", time.Second).ChatCompletion("translate"); err != nil {
		t.Fatal(err)
	}
}

func TestChatCompletionReportsAPIError(t *testing.T) {
	setTestModel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"type":"upstream_error","code":"official_service_unavailable","message":"Official service request could not be completed"}}`))
	}))
	defer server.Close()

	client := newClient(server.URL, "test-key", "", time.Second)
	_, err := client.ChatCompletion("translate")
	if err == nil || !strings.Contains(err.Error(), "Official service request could not be completed") {
		t.Fatalf("ChatCompletion() error = %v, want the API error", err)
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
