package localtts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"krillin-ai/internal/types"
)

// OmniVoice uses the daemon-owned Python worker for every segment and job.
type OmniVoice struct{ Reference string }

func (c OmniVoice) ListVoices(context.Context) ([]types.TTSVoice, error) {
	var voices []types.TTSVoice
	for _, lang := range strings.Fields("ms id th zh en vi ja ko es fr de pt ru it") {
		voices = append(voices, types.TTSVoice{Code: "omnivoice-" + lang, Name: "OmniVoice · " + lang,
			Provider: "omnivoice", Language: lang, Kind: "builtin", SupportedModels: []string{"k2-fsa/OmniVoice"}})
	}
	return voices, nil
}

func (c OmniVoice) Text2Speech(text, voice, output string) error {
	return c.Synthesize(context.Background(), types.TTSSpeechOptions{Text: text, Voice: voice, OutputFile: output})
}

func (c OmniVoice) Synthesize(ctx context.Context, options types.TTSSpeechOptions) error {
	port, err := strconv.ParseUint(os.Getenv("OPENCREATOR_OMNIVOICE_PORT"), 10, 16)
	token := os.Getenv("OPENCREATOR_OMNIVOICE_TOKEN")
	if err != nil || port == 0 || token == "" {
		return fmt.Errorf("OmniVoice worker is unavailable")
	}
	language, ok := strings.CutPrefix(options.Voice, "omnivoice-")
	if !ok || language == "" {
		return fmt.Errorf("Select an OmniVoice speech language")
	}
	format, speed := options.Format, options.Speed
	if format == "" {
		format = "wav"
	}
	if speed == 0 {
		speed = 1
	}
	payload, err := json.Marshal(map[string]any{"text": options.Text, "language": language,
		"reference": c.Reference, "speed": speed, "format": format})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/speech", port), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		reason, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("OmniVoice HTTP %d: %s", resp.StatusCode, reason)
	}
	const limit = 100 << 20
	audio, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return err
	}
	if len(audio) == 0 || len(audio) > limit {
		return fmt.Errorf("invalid OmniVoice audio size")
	}
	return os.WriteFile(options.OutputFile, audio, 0600)
}
