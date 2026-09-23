package aliyun

import (
	"context"
	"io"
	"krillin-ai/config"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOssObjectURL(t *testing.T) {
	for _, tc := range []struct{ name, region, endpoint, want string }{
		{"legacy", "", "", "https://media.oss-cn-shanghai.aliyuncs.com/audio%20clip.wav"},
		{"overseas", "ap-southeast-1", "", "https://media.oss-ap-southeast-1.aliyuncs.com/audio%20clip.wav"},
		{"custom", "ap-southeast-1", "https://oss-accelerate.aliyuncs.com/", "https://media.oss-accelerate.aliyuncs.com/audio%20clip.wav"},
		{"bare host", " ap-southeast-1 ", " oss-ap-southeast-1.aliyuncs.com ", "https://media.oss-ap-southeast-1.aliyuncs.com/audio%20clip.wav"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := NewOssClient(config.AliyunOssConfig{Bucket: "media", Region: tc.region, Endpoint: tc.endpoint})
			got, err := client.ObjectURL("audio clip.wav")
			if err != nil || got != tc.want {
				t.Fatalf("ObjectURL = %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestOssRejectsInvalidEndpointBeforeUpload(t *testing.T) {
	for _, endpoint := range []string{"file:///tmp/audio", "https://user:secret@oss.example.com", "https://oss.example.com/bucket", "https://oss.example.com/?token=secret", "https://oss.example.com/#audio"} {
		t.Run(endpoint, func(t *testing.T) {
			client := NewOssClient(config.AliyunOssConfig{Endpoint: endpoint})
			if _, err := client.ObjectURL("audio.wav"); err == nil {
				t.Fatal("expected invalid endpoint error")
			}
			if err := client.UploadFile(context.Background(), "audio.wav", "missing.wav", "media"); err == nil || !strings.Contains(err.Error(), "OSS endpoint") {
				t.Fatalf("unexpected upload error: %v", err)
			}
		})
	}
}

func TestOssUploadUsesConfiguredEndpointAndSigningRegion(t *testing.T) {
	type upload struct{ url, authorization, body string }
	uploads := make(chan upload, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s", r.Method)
		}
		data, _ := io.ReadAll(r.Body)
		uploads <- upload{"http://" + r.Host + r.URL.EscapedPath(), r.Header.Get("Authorization"), string(data)}
		w.Header().Set("ETag", `"fixture"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client := NewOssClient(config.AliyunOssConfig{
		AccessKeyId: "fixture-id", AccessKeySecret: "fixture-secret", Bucket: "media",
		Region: "ap-southeast-1", Endpoint: server.URL,
	})
	file := filepath.Join(t.TempDir(), "audio.wav")
	if err := os.WriteFile(file, []byte("audio-fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := client.UploadFile(context.Background(), "audio clip.wav", file, client.Bucket); err != nil {
		t.Fatal(err)
	}
	url, err := client.ObjectURL("audio clip.wav")
	uploaded := <-uploads
	if err != nil || uploaded.url != url {
		t.Fatalf("uploaded to %q, object URL %q, error %v", uploaded.url, url, err)
	}
	if uploaded.body != "audio-fixture" {
		t.Fatalf("uploaded body = %q", uploaded.body)
	}
	if !strings.Contains(uploaded.authorization, "/ap-southeast-1/oss/aliyun_v4_request") {
		t.Fatalf("wrong signing region: %s", uploaded.authorization)
	}
}
