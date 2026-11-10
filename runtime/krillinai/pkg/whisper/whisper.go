package whisper

import (
	"context"
	"errors"
	"fmt"
	"github.com/sashabaranov/go-openai"
	"go.uber.org/zap"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"net"
	"strings"
)

func (c *Client) Transcription(audioFile, language, workDir string) (*types.TranscriptionData, error) {
	language = types.WhisperLanguageCode(language)
	granularity := openai.TranscriptionTimestampGranularityWord
	if c.official {
		granularity = openai.TranscriptionTimestampGranularitySegment
	}
	requestID := &responseRequestID{}
	resp, err := c.client.CreateTranscription(
		context.WithValue(context.Background(), responseRequestIDKey{}, requestID),
		openai.AudioRequest{
			Model:    c.model,
			FilePath: audioFile,
			Format:   openai.AudioResponseFormatVerboseJSON,
			TimestampGranularities: []openai.TranscriptionTimestampGranularity{
				granularity,
			},
			Language: language,
		},
	)
	if err != nil {
		var classified *TranscriptionError
		if errors.As(err, &classified) {
			return nil, err
		}
		log.GetLogger().Error("openai create transcription failed", zap.Error(err))
		classified = &TranscriptionError{Code: "audio_transcription_api_failed", Message: fmt.Sprintf("transcription service request failed: %v", err), Cause: err, RequestID: requestID.value}
		var apiError *openai.APIError
		if errors.As(err, &apiError) {
			classified.HTTPStatus = apiError.HTTPStatusCode
			if code, ok := apiError.Code.(string); ok {
				classified.UpstreamCode = safeDiagnosticCode(code)
			}
			if classified.UpstreamCode == "" {
				classified.UpstreamCode = safeDiagnosticCode(apiError.Type)
			}
		} else {
			var networkError net.Error
			if errors.As(err, &networkError) && networkError.Timeout() {
				classified.UpstreamCode = "network_timeout"
			} else {
				classified.UpstreamCode = "network_error"
			}
		}
		return nil, classified
	}

	transcriptionData := &types.TranscriptionData{
		Language: types.RecognitionLanguageCode(resp.Language),
		Text:     resp.Text,
		Words:    make([]types.Word, 0),
	}
	num := 0
	for _, word := range resp.Words {
		if strings.TrimSpace(word.Word) == "" || word.Start < 0 || word.End <= word.Start {
			continue
		}
		transcriptionData.Words = append(transcriptionData.Words, types.Word{Num: num, Text: word.Word, Start: word.Start, End: word.End})
		num++
	}

	if c.official && len(transcriptionData.Words) == 0 {
		for _, segment := range resp.Segments {
			if strings.TrimSpace(segment.Text) != "" && segment.End > segment.Start && segment.Start >= 0 {
				transcriptionData.Words = append(transcriptionData.Words, types.Word{Num: len(transcriptionData.Words), Text: segment.Text, Start: segment.Start, End: segment.End})
			}
		}
	}
	if strings.TrimSpace(transcriptionData.Text) == "" {
		parts := make([]string, len(transcriptionData.Words))
		for i, word := range transcriptionData.Words {
			parts[i] = word.Text
		}
		// Recognized text without valid timing is distinct from an empty result.
		if len(parts) == 0 {
			for _, word := range resp.Words {
				if text := strings.TrimSpace(word.Word); text != "" {
					parts = append(parts, text)
				}
			}
			if len(parts) == 0 {
				for _, segment := range resp.Segments {
					if text := strings.TrimSpace(segment.Text); text != "" {
						parts = append(parts, text)
					}
				}
			}
		}
		if len(parts) == 0 {
			return nil, emptyTranscriptionError(inspectAudioSignal(audioFile))
		}
		transcriptionData.Text = strings.Join(parts, " ")
	}
	if c.official && len(transcriptionData.Words) == 0 {
		return nil, &TranscriptionError{Code: "audio_transcription_timestamps_missing", Message: "transcription returned text but no valid subtitle timestamps; choose a timestamp-capable model"}
	}
	return transcriptionData, nil
}
