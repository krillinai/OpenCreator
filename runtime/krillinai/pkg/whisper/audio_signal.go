package whisper

import (
	"context"
	"fmt"
	"krillin-ai/internal/storage"
	"math"
	"os/exec"
	"regexp"
	"strconv"
	"time"
)

type audioSignal struct {
	known  bool
	silent bool
	maxDB  float64
	meanDB float64
}

var volumePattern = regexp.MustCompile(`(?m)(mean|max)_volume:\s*(-?inf|[-+0-9.]+)\s*dB`)

func inspectAudioSignal(audioFile string) audioSignal {
	if storage.FfmpegPath == "" {
		return audioSignal{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, storage.FfmpegPath,
		"-hide_banner", "-nostdin", "-i", audioFile, "-vn", "-af", "volumedetect", "-f", "null", "-",
	).CombinedOutput()
	if err != nil {
		return audioSignal{}
	}
	return parseAudioSignal(output)
}

func parseAudioSignal(output []byte) audioSignal {
	levels := make(map[string]float64)
	for _, match := range volumePattern.FindAllSubmatch(output, -1) {
		value, err := strconv.ParseFloat(string(match[2]), 64)
		if err != nil || math.IsNaN(value) {
			return audioSignal{}
		}
		levels[string(match[1])] = value
	}
	maxDB, maxFound := levels["max"]
	meanDB, meanFound := levels["mean"]
	if !maxFound || !meanFound {
		return audioSignal{}
	}
	// Sound level can confirm near silence, but cannot distinguish speech from music.
	return audioSignal{known: true, silent: maxDB <= -60 && meanDB <= -60, maxDB: maxDB, meanDB: meanDB}
}

func emptyTranscriptionError(signal audioSignal) *TranscriptionError {
	if signal.known && signal.silent {
		return &TranscriptionError{Code: "audio_no_speech", Message: "transcription returned no words; local audio is silent or extremely quiet; check the source audio and volume"}
	}
	message := "transcription returned empty text and no usable timed words; this alone does not prove that the audio has no speech"
	if signal.known {
		message += fmt.Sprintf("; local audio contains sound (mean %.1f dB, peak %.1f dB), which may be speech, music or noise", signal.meanDB, signal.maxDB)
	} else {
		message += "; local audio analysis was unavailable"
	}
	return &TranscriptionError{Code: "audio_transcription_empty", Message: message + "; check the source audio or verify with another recognition model"}
}
