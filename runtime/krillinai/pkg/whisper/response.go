package whisper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/sashabaranov/go-openai"
)

type TranscriptionError struct {
	Code    string
	Message string
	Cause   error
}

func (e *TranscriptionError) Error() string { return e.Message }
func (e *TranscriptionError) Unwrap() error { return e.Cause }

func (e *TranscriptionError) Retryable() bool {
	return e.Code == "audio_transcription_api_failed"
}

type audioResponseClient struct {
	next interface {
		Do(*http.Request) (*http.Response, error)
	}
}

func (c *audioResponseClient) Do(request *http.Request) (*http.Response, error) {
	response, err := c.next.Do(request)
	if err != nil || !strings.HasSuffix(request.URL.Path, "/audio/transcriptions") || response.StatusCode < 200 || response.StatusCode >= 300 {
		return response, err
	}
	defer response.Body.Close()
	const maxResponseSize = 8 * 1024 * 1024
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil {
		return nil, err
	}
	invalid := func(reason string) (*http.Response, error) {
		return nil, &TranscriptionError{Code: "audio_transcription_invalid_response", Message: fmt.Sprintf("transcription service returned HTTP %d but %s", response.StatusCode, reason)}
	}
	if len(body) > maxResponseSize {
		return invalid("the response exceeded the size limit")
	}
	var payload struct {
		Text  *string         `json:"text"`
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return invalid("the response was not valid transcription JSON")
	}
	if len(payload.Error) > 0 && string(payload.Error) != "null" {
		return invalid("the response contained an error instead of a transcription")
	}
	if payload.Text == nil {
		return invalid("the required text field was missing")
	}
	var transcript openai.AudioResponse
	if err := json.Unmarshal(body, &transcript); err != nil {
		return invalid("the transcription fields had invalid types")
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	return response, nil
}
