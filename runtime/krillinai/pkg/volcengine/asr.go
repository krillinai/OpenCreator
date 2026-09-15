package volcengine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

var processAudioFile = util.ProcessAudio

const (
	DefaultAsrBaseURL    = "https://openspeech.bytedance.com"
	DefaultAsrResourceID = "volc.seedasr.auc"
	submitPath           = "/api/v3/auc/bigmodel/submit"
	queryPath            = "/api/v3/auc/bigmodel/query"
	statusSuccess        = "20000000"
	statusProcessing     = "20000001"
	statusQueued         = "20000002"
)

type AsrClient struct {
	baseURL      string
	appID        string
	accessToken  string
	resourceID   string
	httpClient   *http.Client
	pollInterval time.Duration
	maxPollTime  time.Duration
}

func NewAsrClient(baseURL, appID, accessToken, resourceID, proxy string) *AsrClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultAsrBaseURL
	}
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		resourceID = DefaultAsrResourceID
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyURL, err := url.Parse(strings.TrimSpace(proxy)); err == nil && proxyURL.Scheme != "" {
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &AsrClient{
		baseURL:     baseURL,
		appID:       strings.TrimSpace(appID),
		accessToken: strings.TrimSpace(accessToken),
		resourceID:  resourceID,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   60 * time.Second,
		},
		pollInterval: 3 * time.Second,
		maxPollTime:  10 * time.Minute,
	}
}

type asrSubmitRequest struct {
	User    asrUser    `json:"user"`
	Audio   asrAudio   `json:"audio"`
	Request asrOptions `json:"request"`
}

type asrUser struct {
	UID string `json:"uid"`
}

type asrAudio struct {
	Data   string `json:"data"`
	Format string `json:"format"`
}

type asrOptions struct {
	ModelName      string `json:"model_name"`
	EnableITN      bool   `json:"enable_itn"`
	EnablePunc     bool   `json:"enable_punc"`
	ShowUtterances bool   `json:"show_utterances"`
}

type asrQueryResponse struct {
	Result *asrResult `json:"result"`
}

type asrResult struct {
	Text       string         `json:"text"`
	Utterances []asrUtterance `json:"utterances"`
}

type asrUtterance struct {
	Text      string    `json:"text"`
	StartTime int64     `json:"start_time"`
	EndTime   int64     `json:"end_time"`
	Words     []asrWord `json:"words"`
}

type asrWord struct {
	Text      string `json:"text"`
	StartTime int64  `json:"start_time"`
	EndTime   int64  `json:"end_time"`
}

func (c *AsrClient) Transcription(audioFile, language, workDir string) (*types.TranscriptionData, error) {
	_ = workDir
	if c.appID == "" || c.accessToken == "" {
		return nil, fmt.Errorf("volcengine asr app id or access token is empty")
	}
	processed, err := processAudioFile(audioFile)
	if err != nil {
		return nil, err
	}
	audio, err := os.ReadFile(processed)
	if err != nil {
		return nil, fmt.Errorf("volcengine asr read audio: %w", err)
	}
	if len(audio) == 0 {
		return nil, fmt.Errorf("volcengine asr audio is empty")
	}
	requestID := uuid.NewString()
	body, err := json.Marshal(asrSubmitRequest{
		User: asrUser{UID: "opencreator"},
		Audio: asrAudio{
			Data:   base64.StdEncoding.EncodeToString(audio),
			Format: audioFormat(processed),
		},
		Request: asrOptions{
			ModelName:      "bigmodel",
			EnableITN:      true,
			EnablePunc:     true,
			ShowUtterances: true,
		},
	})
	if err != nil {
		return nil, err
	}
	submitStatus, _, err := c.post(c.baseURL+submitPath, requestID, body)
	if err != nil {
		return nil, err
	}
	if submitStatus != "" && submitStatus != statusSuccess && submitStatus != statusQueued && submitStatus != statusProcessing {
		return nil, fmt.Errorf("volcengine asr submit failed: status %s", submitStatus)
	}
	deadline := time.Now().Add(c.maxPollTime)
	for {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("volcengine asr polling timeout after %s", c.maxPollTime)
		}
		time.Sleep(c.pollInterval)
		status, payload, err := c.post(c.baseURL+queryPath, requestID, []byte("{}"))
		if err != nil {
			return nil, err
		}
		switch status {
		case "", statusQueued, statusProcessing:
			if result := parseAsrResult(payload); result != nil && result.Text != "" {
				return transcriptionFromAsr(result, language), nil
			}
			continue
		case statusSuccess:
			result := parseAsrResult(payload)
			if result == nil || strings.TrimSpace(result.Text) == "" {
				return nil, fmt.Errorf("volcengine asr returned an empty transcript")
			}
			log.GetLogger().Info("volcengine asr transcription succeeded", zap.String("request_id", requestID))
			return transcriptionFromAsr(result, language), nil
		default:
			return nil, fmt.Errorf("volcengine asr query failed: status %s", status)
		}
	}
}

func (c *AsrClient) post(endpoint, requestID string, body []byte) (string, []byte, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-App-Key", c.appID)
	req.Header.Set("X-Api-Access-Key", c.accessToken)
	req.Header.Set("X-Api-Resource-Id", c.resourceID)
	req.Header.Set("X-Api-Request-Id", requestID)
	req.Header.Set("X-Api-Sequence", "-1")
	response, err := c.httpClient.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("volcengine asr request failed: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return "", nil, err
	}
	if response.StatusCode != http.StatusOK {
		return "", payload, fmt.Errorf("volcengine asr returned HTTP %d: %s", response.StatusCode, boundedMessage(payload))
	}
	return response.Header.Get("X-Api-Status-Code"), payload, nil
}

func parseAsrResult(payload []byte) *asrResult {
	var decoded asrQueryResponse
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil
	}
	return decoded.Result
}

func transcriptionFromAsr(result *asrResult, language string) *types.TranscriptionData {
	data := &types.TranscriptionData{
		Language: language,
		Text:     strings.TrimSpace(result.Text),
	}
	var words []types.Word
	index := 0
	for _, utterance := range result.Utterances {
		if len(utterance.Words) > 0 {
			for _, word := range utterance.Words {
				text := strings.TrimSpace(word.Text)
				if text == "" {
					continue
				}
				words = append(words, types.Word{
					Num:   index,
					Text:  text,
					Start: float64(word.StartTime) / 1000,
					End:   float64(word.EndTime) / 1000,
				})
				index++
			}
			continue
		}
		text := strings.TrimSpace(utterance.Text)
		if text == "" {
			continue
		}
		words = append(words, types.Word{
			Num:   index,
			Text:  text,
			Start: float64(utterance.StartTime) / 1000,
			End:   float64(utterance.EndTime) / 1000,
		})
		index++
	}
	data.Words = words
	return data
}

func audioFormat(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".wav":
		return "wav"
	case ".ogg":
		return "ogg"
	case ".m4a":
		return "m4a"
	default:
		return "mp3"
	}
}

func boundedMessage(value []byte) string {
	const limit = 300
	message := strings.TrimSpace(string(value))
	if len(message) <= limit {
		return message
	}
	return message[:limit]
}
