package util

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDownloadFileRejectsNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "<html>not found</html>", http.StatusNotFound)
	}))
	defer srv.Close()

	dst := filepath.Join(t.TempDir(), "ggml-base.bin")
	if err := DownloadFile(srv.URL, dst, ""); err == nil {
		t.Fatal("expected an error for a 404 response, got nil")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("expected no file left behind after a failed download, stat err = %v", err)
	}
}

func TestDownloadFileRemovesPartialOnCopyError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
	}))
	defer srv.Close()

	dst := filepath.Join(t.TempDir(), "model.zip")
	if err := DownloadFile(srv.URL, dst, ""); err == nil {
		t.Fatal("expected an error for a truncated body, got nil")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("expected the partial file to be removed, stat err = %v", err)
	}
}

func TestDownloadFileOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("hello"))
	}))
	defer srv.Close()

	dst := filepath.Join(t.TempDir(), "ok.bin")
	if err := DownloadFile(srv.URL, dst, ""); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	b, err := os.ReadFile(dst)
	if err != nil || string(b) != "hello" {
		t.Fatalf("got %q, %v", b, err)
	}
}
