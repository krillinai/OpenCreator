package dubbing

import (
	"fmt"
	"krillin-ai/internal/storage"
	"krillin-ai/pkg/util"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const timelineComparisonEpsilon = 1e-6

func defaultFFmpegRunner(args []string) error {
	cmd := exec.Command(storage.FfmpegPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg error: %w, output: %s", err, string(output))
	}
	return nil
}

func WriteTinySilence(output string, run CommandRunner) error {
	if run == nil {
		run = defaultFFmpegRunner
	}
	return run([]string{
		"-y",
		"-f", "lavfi",
		"-i", "anullsrc=channel_layout=mono:sample_rate=44100",
		"-t", "0.100",
		"-ar", "44100",
		"-ac", "1",
		"-c:a", "pcm_s16le",
		output,
	})
}

func buildAtempoFilter(speed float64) (string, error) {
	if speed <= 0 || math.IsNaN(speed) || math.IsInf(speed, 0) {
		return "", fmt.Errorf("speed must be finite and > 0: %v", speed)
	}

	parts := []string{}
	for speed > 2.0 {
		parts = append(parts, "atempo=2.000")
		speed /= 2.0
	}
	for speed < 0.5 {
		parts = append(parts, "atempo=0.500")
		speed /= 0.5
	}
	parts = append(parts, fmt.Sprintf("atempo=%.3f", speed))
	return strings.Join(parts, ","), nil
}

func buildMuxArgs(inputVideo, inputAudio, outputVideo string) []string {
	return []string{
		"-y",
		"-i", inputVideo,
		"-i", inputAudio,
		"-c:v", "copy",
		"-map", "0:v:0",
		"-map", "1:a:0",
		"-c:a", "aac",
		"-b:a", "192k",
		"-af", "apad",
		"-shortest",
		outputVideo,
	}
}

func BuildDubCues(plan []PlanItem) []Cue {
	cues := make([]Cue, len(plan))
	for i, item := range plan {
		index := item.Index
		if index <= 0 {
			index = i + 1
		}
		cues[i] = Cue{
			Index: index,
			Start: item.OriginalStart,
			End:   item.OriginalEnd,
			Text:  item.SpokenText,
		}
	}
	return cues
}

func fittedSegmentPath(segmentsDir string, index int) string {
	return filepath.Join(segmentsDir, "fitted", fmt.Sprintf("%d.wav", index))
}

func rawChunkPath(segmentsDir string, id int) string {
	return filepath.Join(segmentsDir, "raw", fmt.Sprintf("chunk_%d.wav", id))
}

func fittedChunkPath(segmentsDir string, id int) string {
	return filepath.Join(segmentsDir, "fitted", fmt.Sprintf("chunk_%d.wav", id))
}

func AssembleAudio(plan []PlanItem, segmentsDir, outputAudio string, run CommandRunner) error {
	return assembleAudioWithBounds(plan, segmentsDir, outputAudio, run, util.GetSpeechBounds)
}

func assembleAudioWithBounds(plan []PlanItem, segmentsDir, outputAudio string, run CommandRunner, bounds SpeechBoundsProbe) error {
	if run == nil {
		run = defaultFFmpegRunner
	}

	filters, err := validateAssemblePlan(plan, segmentsDir)
	if err != nil {
		return err
	}

	fittedDir := filepath.Join(segmentsDir, "fitted")
	if err := os.MkdirAll(fittedDir, 0755); err != nil {
		return err
	}

	concatLines := make([]string, 0, len(plan)*2)
	lastEnd := 0.0
	for i, item := range plan {
		raw := filepath.Join(segmentsDir, "raw", fmt.Sprintf("%d.wav", item.Index))
		if err := ensureNonEmptyFile(raw, "raw segment"); err != nil {
			return err
		}

		fitted := fittedSegmentPath(segmentsDir, item.Index)
		filter := filters[i]
		if bounds != nil && item.ActualDuration > 0 {
			start, end, err := bounds(raw)
			if err != nil {
				return fmt.Errorf("detect speech bounds for segment %d: %w", item.Index, err)
			}
			filter = fmt.Sprintf("atrim=start=%.6f:end=%.6f,asetpts=PTS-STARTPTS,%s", start, end, filter)
		}
		if err := run([]string{
			"-y",
			"-i", raw,
			"-filter:a", filter,
			"-ar", "44100",
			"-ac", "1",
			"-c:a", "pcm_s16le",
			fitted,
		}); err != nil {
			return fmt.Errorf("fit segment %d: %w", item.Index, err)
		}

		if item.NewStart > lastEnd {
			silence := filepath.Join(fittedDir, fmt.Sprintf("silence_%d.wav", item.Index))
			if err := run([]string{
				"-y",
				"-f", "lavfi",
				"-i", "anullsrc=channel_layout=mono:sample_rate=44100",
				"-t", fmt.Sprintf("%.3f", item.NewStart-lastEnd),
				"-ar", "44100",
				"-ac", "1",
				"-c:a", "pcm_s16le",
				silence,
			}); err != nil {
				return fmt.Errorf("write silence before segment %d: %w", item.Index, err)
			}
			concatLines = append(concatLines, fmt.Sprintf("file '%s'", filepath.Base(silence)))
		}

		concatLines = append(concatLines, fmt.Sprintf("file '%s'", filepath.Base(fitted)))
		lastEnd = item.NewEnd
	}

	concatPath := filepath.Join(fittedDir, "concat.txt")
	if err := os.WriteFile(concatPath, []byte(strings.Join(concatLines, "\n")+"\n"), 0644); err != nil {
		return err
	}

	if err := run([]string{
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", concatPath,
		"-c", "copy",
		outputAudio,
	}); err != nil {
		return fmt.Errorf("concat fitted audio: %w", err)
	}

	return nil
}

func AssembleChunkAudio(plan []PlanItem, chunks []Chunk, segmentsDir, outputAudio string, run CommandRunner) error {
	if run == nil {
		run = defaultFFmpegRunner
	}
	filters, err := validateAssembleChunkPlan(plan, chunks, segmentsDir)
	if err != nil {
		return err
	}

	fittedDir := filepath.Join(segmentsDir, "fitted")
	if err := os.MkdirAll(fittedDir, 0755); err != nil {
		return err
	}

	concatLines := make([]string, 0, len(chunks)*2)
	lastEnd := 0.0
	for i, chunk := range chunks {
		raw := rawChunkPath(segmentsDir, chunk.ID)
		fitted := fittedChunkPath(segmentsDir, chunk.ID)
		if err := run([]string{
			"-y",
			"-i", raw,
			"-filter:a", filters[i],
			"-ar", "44100",
			"-ac", "1",
			"-c:a", "pcm_s16le",
			fitted,
		}); err != nil {
			return fmt.Errorf("fit chunk %d: %w", chunk.ID, err)
		}

		if chunk.Start > lastEnd {
			silence := filepath.Join(fittedDir, fmt.Sprintf("silence_chunk_%d.wav", chunk.ID))
			if err := run([]string{
				"-y",
				"-f", "lavfi",
				"-i", "anullsrc=channel_layout=mono:sample_rate=44100",
				"-t", fmt.Sprintf("%.3f", chunk.Start-lastEnd),
				"-ar", "44100",
				"-ac", "1",
				"-c:a", "pcm_s16le",
				silence,
			}); err != nil {
				return fmt.Errorf("write silence before chunk %d: %w", chunk.ID, err)
			}
			concatLines = append(concatLines, fmt.Sprintf("file '%s'", filepath.Base(silence)))
		}

		concatLines = append(concatLines, fmt.Sprintf("file '%s'", filepath.Base(fitted)))
		lastEnd = chunkFittedEnd(plan, chunk)
	}

	concatPath := filepath.Join(fittedDir, "concat.txt")
	if err := os.WriteFile(concatPath, []byte(strings.Join(concatLines, "\n")+"\n"), 0644); err != nil {
		return err
	}

	if err := run([]string{
		"-y",
		"-f", "concat",
		"-safe", "0",
		"-i", concatPath,
		"-c", "copy",
		outputAudio,
	}); err != nil {
		return fmt.Errorf("concat fitted audio: %w", err)
	}
	return nil
}

func validateAssemblePlan(plan []PlanItem, segmentsDir string) ([]string, error) {
	if len(plan) == 0 {
		return nil, fmt.Errorf("plan is empty")
	}

	filters := make([]string, len(plan))
	lastEnd := 0.0
	for i, item := range plan {
		if item.NewEnd <= item.NewStart {
			return nil, fmt.Errorf("plan item %d new end must be greater than new start: start %.3f end %.3f", item.Index, item.NewStart, item.NewEnd)
		}
		if item.NewStart+timelineComparisonEpsilon < lastEnd {
			return nil, fmt.Errorf("plan item %d starts before previous end: start %.3f lastEnd %.3f", item.Index, item.NewStart, lastEnd)
		}

		filter, err := buildAtempoFilter(item.SpeedFactor)
		if err != nil {
			return nil, err
		}
		filters[i] = filter

		raw := filepath.Join(segmentsDir, "raw", fmt.Sprintf("%d.wav", item.Index))
		if err := ensureNonEmptyFile(raw, "raw segment"); err != nil {
			return nil, err
		}

		lastEnd = item.NewEnd
	}
	return filters, nil
}

func validateAssembleChunkPlan(plan []PlanItem, chunks []Chunk, segmentsDir string) ([]string, error) {
	if len(plan) == 0 {
		return nil, fmt.Errorf("plan is empty")
	}
	if len(chunks) == 0 {
		return nil, fmt.Errorf("chunks are empty")
	}

	filters := make([]string, len(chunks))
	lastEnd := 0.0
	for i, chunk := range chunks {
		if len(chunk.Items) == 0 {
			return nil, fmt.Errorf("chunk %d has no items", chunk.ID)
		}
		if chunk.Start+timelineComparisonEpsilon < lastEnd {
			return nil, fmt.Errorf("chunk %d starts before previous end: start %.3f lastEnd %.3f", chunk.ID, chunk.Start, lastEnd)
		}
		end := chunkFittedEnd(plan, chunk)
		if end <= chunk.Start {
			return nil, fmt.Errorf("chunk %d end must be greater than start: start %.3f end %.3f", chunk.ID, chunk.Start, end)
		}
		filter, err := buildAtempoFilter(chunkSpeedFactor(plan, chunk))
		if err != nil {
			return nil, err
		}
		filters[i] = filter

		raw := rawChunkPath(segmentsDir, chunk.ID)
		if err := ensureNonEmptyFile(raw, "raw chunk"); err != nil {
			return nil, err
		}
		lastEnd = end
	}
	return filters, nil
}

func chunkSpeedFactor(plan []PlanItem, chunk Chunk) float64 {
	if chunk.SpeedFactor > 0 {
		return chunk.SpeedFactor
	}
	for _, idx := range chunk.Items {
		if idx >= 0 && idx < len(plan) && plan[idx].SpeedFactor > 0 {
			return plan[idx].SpeedFactor
		}
	}
	return 1
}

func chunkFittedEnd(plan []PlanItem, chunk Chunk) float64 {
	end := 0.0
	for _, idx := range chunk.Items {
		if idx >= 0 && idx < len(plan) && plan[idx].NewEnd > end {
			end = plan[idx].NewEnd
		}
	}
	if end > 0 {
		return end
	}
	end = chunk.Start
	if chunk.End > end {
		end = chunk.End
	}
	return end
}
