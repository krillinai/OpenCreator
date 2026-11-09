package dubbing

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/internal/types"
	"os"
	"path/filepath"
	"strings"
)

func GenerateRawSegments(ctx context.Context, tts types.Ttser, plan []PlanItem, voice, dir string, run CommandRunner, duration DurationProbe) ([]PlanItem, error) {
	return GenerateRawSegmentsWithProgress(ctx, tts, plan, voice, dir, run, duration, nil)
}

// GenerateRawSegmentsWithProgress creates one natural-speed audio file per cue
// and measures each waveform immediately after synthesis.
func GenerateRawSegmentsWithProgress(ctx context.Context, tts types.Ttser, plan []PlanItem, voice, dir string, run CommandRunner, duration DurationProbe, reportProgress func(completed, total int)) ([]PlanItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if run == nil {
		run = defaultFFmpegRunner
	}
	if duration == nil {
		return nil, errors.New("duration probe is required")
	}

	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		return nil, err
	}
	if reportProgress != nil {
		reportProgress(0, len(plan))
	}

	for i := range plan {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		if err := generateRawSegment(ctx, tts, &plan[i], voice, dir, run, duration); err != nil {
			return nil, err
		}
		if reportProgress != nil {
			reportProgress(i+1, len(plan))
		}
	}

	return plan, nil
}

func generateRawSegment(ctx context.Context, tts types.Ttser, item *PlanItem, voice, dir string, run CommandRunner, duration DurationProbe) error {
	if item == nil {
		return errors.New("plan item is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if run == nil {
		run = defaultFFmpegRunner
	}
	if duration == nil {
		return errors.New("duration probe is required")
	}

	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		return err
	}
	output := filepath.Join(rawDir, fmt.Sprintf("%d.wav", item.Index))
	if IsSilenceOnlyText(item.SpokenText) {
		if err := WriteTinySilence(output, run); err != nil {
			return fmt.Errorf("write silence segment %d failed: %w", item.Index, err)
		}
	} else {
		if tts == nil {
			return errors.New("tts is required for non-silence text")
		}
		if err := retryTTS(tts, item.SpokenText, voice, output, 3); err != nil {
			return fmt.Errorf("tts segment %d failed: %w", item.Index, err)
		}
	}

	dur, err := duration(output)
	if err != nil {
		return fmt.Errorf("measure segment %d duration failed for %s: %w", item.Index, output, err)
	}
	item.ActualDuration = dur
	return nil
}

func regenerateRawSegment(ctx context.Context, tts types.Ttser, item *PlanItem, voice, dir string, run CommandRunner, duration DurationProbe) error {
	return generateRawSegment(ctx, tts, item, voice, dir, run, duration)
}

func GenerateRawChunkSegments(
	ctx context.Context,
	tts types.Ttser,
	plan []PlanItem,
	chunks []Chunk,
	voice,
	dir string,
	run CommandRunner,
	duration DurationProbe,
	reportProgress func(completed, total int),
) ([]PlanItem, []Chunk, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if run == nil {
		run = defaultFFmpegRunner
	}
	if duration == nil {
		return nil, nil, errors.New("duration probe is required")
	}

	rawDir := filepath.Join(dir, "raw")
	if err := os.MkdirAll(rawDir, 0755); err != nil {
		return nil, nil, err
	}

	outPlan := append([]PlanItem(nil), plan...)
	outChunks := append([]Chunk(nil), chunks...)
	if reportProgress != nil {
		reportProgress(0, len(outChunks))
	}
	for i := range outChunks {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		text, err := chunkSpeechText(outPlan, outChunks[i])
		if err != nil {
			return nil, nil, err
		}

		output := filepath.Join(rawDir, fmt.Sprintf("chunk_%d.wav", outChunks[i].ID))
		if IsSilenceOnlyText(text) {
			if err := WriteTinySilence(output, run); err != nil {
				return nil, nil, err
			}
		} else {
			if tts == nil {
				return nil, nil, errors.New("tts is required for non-silence text")
			}
			if err := retryTTS(tts, text, voice, output, 3); err != nil {
				return nil, nil, fmt.Errorf("tts chunk %d failed: %w", outChunks[i].ID, err)
			}
		}

		dur, err := duration(output)
		if err != nil {
			return nil, nil, fmt.Errorf("measure chunk %d duration failed for %s: %w", outChunks[i].ID, output, err)
		}
		outChunks[i].ActualDuration = dur
		if reportProgress != nil {
			reportProgress(i+1, len(outChunks))
		}
	}

	return outPlan, outChunks, nil
}

func chunkSpeechText(plan []PlanItem, chunk Chunk) (string, error) {
	parts := make([]string, 0, len(chunk.Items))
	for itemIndex, idx := range chunk.Items {
		if idx < 0 || idx >= len(plan) {
			return "", fmt.Errorf("chunk %d references plan item %d out of range", chunk.ID, itemIndex)
		}
		text := strings.Join(strings.Fields(plan[idx].SpokenText), " ")
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, " "), nil
}

func retryTTS(tts types.Ttser, text, voice, output string, attempts int) error {
	if attempts <= 0 {
		return fmt.Errorf("attempts must be > 0: %d", attempts)
	}

	var last error
	for i := 0; i < attempts; i++ {
		if err := os.Remove(output); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove stale output %s: %w", output, err)
		}
		last = tts.Text2Speech(text, voice, output)
		if last == nil {
			if _, err := os.Stat(output); err == nil {
				return nil
			}
			last = fmt.Errorf("output file missing: %s", output)
		}
	}
	return last
}
