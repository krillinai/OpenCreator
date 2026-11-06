package service

import (
	"bufio"
	"context"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/service/dubbing"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func targetSRTPathForDubbing(taskBasePath string) string {
	return filepath.Join(taskBasePath, types.SubtitleTaskTargetLanguageSrtFileName)
}

func persistDubbingSubtitle(sourcePath, targetPath string) error {
	if sourcePath == "" || targetPath == "" {
		return nil
	}
	if filepath.Clean(sourcePath) == filepath.Clean(targetPath) {
		return nil
	}
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("read final dubbing subtitle: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return fmt.Errorf("create final dubbing subtitle directory: %w", err)
	}
	if err := os.WriteFile(targetPath, data, 0644); err != nil {
		return fmt.Errorf("write final dubbing subtitle: %w", err)
	}
	return nil
}

type dubbingSubtitleCue struct {
	index int
	start int64
	end   int64
	text  string
}

func readDubbingSubtitleCues(path string) ([]dubbingSubtitleCue, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open subtitle %s: %w", path, err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	var lines []string
	var cues []dubbingSubtitleCue
	flush := func() error {
		if len(lines) == 0 {
			return nil
		}
		if len(lines) < 3 {
			return fmt.Errorf("subtitle %s has an invalid cue", path)
		}
		index, err := strconv.Atoi(strings.TrimSpace(lines[0]))
		if err != nil {
			return fmt.Errorf("subtitle %s has invalid cue index %q: %w", path, lines[0], err)
		}
		start, end, err := parseSRTTimeline(strings.TrimSpace(lines[1]))
		if err != nil {
			return fmt.Errorf("subtitle %s cue %d: %w", path, index, err)
		}
		text := strings.TrimSpace(strings.Join(lines[2:], " "))
		if text == "" {
			return fmt.Errorf("subtitle %s cue %d has empty text", path, index)
		}
		cues = append(cues, dubbingSubtitleCue{index: index, start: start, end: end, text: text})
		lines = nil
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if strings.TrimSpace(line) == "" {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read subtitle %s: %w", path, err)
	}
	if err := flush(); err != nil {
		return nil, err
	}
	if len(cues) == 0 {
		return nil, fmt.Errorf("subtitle %s is empty", path)
	}
	return cues, nil
}

func buildDubbingAlignedSubtitles(sourcePath, dubbingPath string) ([]byte, []byte, []byte, error) {
	origin, err := readDubbingSubtitleCues(sourcePath)
	if err != nil {
		return nil, nil, nil, err
	}
	target, err := readDubbingSubtitleCues(dubbingPath)
	if err != nil {
		return nil, nil, nil, err
	}

	var originSRT strings.Builder
	var bilingualSRT strings.Builder
	for _, targetCue := range target {
		var sourceTexts []string
		for _, sourceCue := range origin {
			if sourceCue.start < targetCue.end && sourceCue.end > targetCue.start {
				sourceTexts = append(sourceTexts, sourceCue.text)
			}
		}
		if len(sourceTexts) == 0 {
			return nil, nil, nil, fmt.Errorf("no source subtitle overlaps dubbing cue %d", targetCue.index)
		}
		sourceText := strings.Join(sourceTexts, " ")
		fmt.Fprintf(&originSRT, "%d\n%s\n%s\n\n", targetCue.index, formatSRTTimeline(targetCue.start, targetCue.end), sourceText)
		fmt.Fprintf(&bilingualSRT, "%d\n%s\n%s\n%s\n\n", targetCue.index, formatSRTTimeline(targetCue.start, targetCue.end), targetCue.text, sourceText)
	}
	dubbingData, err := os.ReadFile(dubbingPath)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("read final dubbing subtitle: %w", err)
	}
	return dubbingData, []byte(originSRT.String()), []byte(bilingualSRT.String()), nil
}

func persistDubbingSubtitles(sourcePath, dubbingPath, originPath, targetPath, bilingualPath string) error {
	if sourcePath == "" {
		return persistDubbingSubtitle(dubbingPath, targetPath)
	}
	if originPath == "" {
		originPath = filepath.Join(filepath.Dir(targetPath), types.SubtitleTaskOriginLanguageSrtFileName)
	}
	if bilingualPath == "" {
		bilingualPath = filepath.Join(filepath.Dir(targetPath), types.SubtitleTaskBilingualSrtFileName)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return fmt.Errorf("create final dubbing subtitle directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(originPath), 0755); err != nil {
		return fmt.Errorf("create synchronized origin subtitle directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(bilingualPath), 0755); err != nil {
		return fmt.Errorf("create synchronized bilingual subtitle directory: %w", err)
	}
	targetData, originData, bilingualData, err := buildDubbingAlignedSubtitles(sourcePath, dubbingPath)
	if err != nil {
		return err
	}
	if err := os.WriteFile(targetPath, targetData, 0644); err != nil {
		return fmt.Errorf("write final dubbing subtitle: %w", err)
	}
	if err := os.WriteFile(originPath, originData, 0644); err != nil {
		return fmt.Errorf("write synchronized origin subtitle: %w", err)
	}
	if err := os.WriteFile(bilingualPath, bilingualData, 0644); err != nil {
		return fmt.Errorf("write synchronized bilingual subtitle: %w", err)
	}
	return nil
}

type voiceCloneFunc func(prefix, audioURL string) (string, error)

func resolveDubbingVoiceCode(baseVoice, cloneURL string, clone voiceCloneFunc) (string, error) {
	if cloneURL == "" {
		return baseVoice, nil
	}
	if clone == nil {
		return "", fmt.Errorf("srtFileToSpeech CosyVoiceClone error: voice clone client is nil")
	}
	code, err := clone("krillinai", cloneURL)
	if err != nil {
		return "", fmt.Errorf("srtFileToSpeech CosyVoiceClone error: %w", err)
	}
	return code, nil
}

// 输入目标语言字幕，生成配音
func (s Service) srtFileToSpeech(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	if stepParam == nil {
		return fmt.Errorf("srtFileToSpeech stepParam is nil")
	}
	if !stepParam.EnableTts {
		return nil
	}
	if stepParam.TtsSourceFilePath == "" {
		stepParam.TtsSourceFilePath = targetSRTPathForDubbing(stepParam.TaskBasePath)
	}
	sourceSRT := ""
	for _, candidate := range []string{
		stepParam.TtsOriginSrtFilePath,
		filepath.Join(stepParam.TaskBasePath, types.SubtitleTaskOriginLanguageSrtFileName),
	} {
		if candidate == "" {
			continue
		}
		if _, statErr := os.Stat(candidate); statErr == nil {
			sourceSRT = candidate
			break
		}
	}

	var clone voiceCloneFunc
	if s.VoiceCloneClient != nil {
		clone = s.VoiceCloneClient.CosyVoiceClone
	}
	voiceCode, err := resolveDubbingVoiceCode(stepParam.TtsVoiceCode, stepParam.VoiceCloneAudioUrl, clone)
	if err != nil {
		return err
	}

	outputAudio := stepParam.TtsResultFilePath
	if outputAudio == "" {
		outputAudio = filepath.Join(stepParam.TaskBasePath, types.TtsResultAudioFileName)
	}
	outputVideo := stepParam.VideoWithTtsFilePath
	if outputVideo == "" {
		outputVideo = filepath.Join(stepParam.TaskBasePath, types.SubtitleTaskVideoWithTtsFileName)
	}

	phase, phaseStart, phaseEnd, phaseLabel := "planning_voice", 20, 20, "正在规划配音片段"
	runner := dubbing.NewRunner(dubbing.Dependencies{
		TTS:         s.TtsClient,
		Chat:        s.ChatCompleter,
		Language:    stepParam.TargetLanguage,
		SourceSRT:   sourceSRT,
		Voice:       voiceCode,
		Workdir:     stepParam.TaskBasePath,
		InputSRT:    stepParam.TtsSourceFilePath,
		InputVideo:  stepParam.InputVideoPath,
		AudioOnly:   stepParam.TtsAudioOnly,
		OutputAudio: outputAudio,
		OutputVideo: outputVideo,
		ReportPhase: func(value string) {
			phase = value
			switch phase {
			case "planning_voice":
				phaseStart, phaseEnd, phaseLabel = 20, 20, "正在规划配音片段"
			case "generating_voice":
				phaseStart, phaseEnd, phaseLabel = 20, 90, "正在生成配音"
			case "fitting_voice":
				phaseStart, phaseEnd, phaseLabel = 91, 91, "正在对齐配音时间轴"
			case "assembling_voice":
				phaseStart, phaseEnd, phaseLabel = 92, 95, "正在拼接配音音频"
			case "muxing_voice":
				phaseStart, phaseEnd, phaseLabel = 96, 97, "正在合并配音和视频"
			}
			stepParam.TaskPtr.ReportProgress(types.TaskProgress{Phase: phase, Percent: phaseStart, Message: phaseLabel})
		},
		FFmpeg: func(args []string) error {
			var output []byte
			var err error
			if len(args) > 0 && (args[len(args)-1] == outputAudio || args[len(args)-1] == outputVideo) {
				output, err = runFFmpegProgress(ctx, args, stepParam.InputVideoPath, phase, phaseLabel, stepParam.TaskPtr, phaseStart, phaseEnd)
			} else {
				output, err = exec.CommandContext(ctx, storage.FfmpegPath, args...).CombinedOutput()
			}
			if err != nil {
				return fmt.Errorf("dubbing ffmpeg: %w: %s", err, compactCommandOutput(output))
			}
			return nil
		},
		ReportProgress: func(completed, total int) {
			if stepParam.TaskPtr == nil || total <= 0 {
				return
			}
			percent := 20 + int(float64(completed)/float64(total)*70)
			if percent > 90 {
				percent = 90
			}
			stepParam.TaskPtr.ReportProgress(types.TaskProgress{Phase: "generating_voice", Percent: percent, Message: fmt.Sprintf("已生成配音 %d/%d 段", completed, total), Completed: completed, Total: total})
		},
		Config: dubbing.Config{
			MinSubtitleDuration:   config.Conf.Dubbing.MinSubtitleDuration,
			MaxChunkSize:          config.Conf.Dubbing.MaxChunkSize,
			MaxSubtitleChars:      config.Conf.Dubbing.MaxSubtitleChars,
			GapTolerance:          config.Conf.Dubbing.GapTolerance,
			SpeedMin:              config.Conf.Dubbing.SpeedMin,
			SpeedAccept:           config.Conf.Dubbing.SpeedAccept,
			SpeedMax:              config.Conf.Dubbing.SpeedMax,
			MaxTimingOverrunRatio: config.Conf.Dubbing.MaxTimingOverrunRatio,
			EnableTextRewrite:     config.Conf.Dubbing.EnableTextRewrite,
			RewriteMaxAttempts:    config.Conf.Dubbing.RewriteMaxAttempts,
			Estimator:             config.Conf.Dubbing.Estimator,
		},
	})
	result, err := runner.Run(ctx)
	if err != nil {
		return fmt.Errorf("srtFileToSpeech dubbing runner error: %w", err)
	}
	finalTargetSRT := stepParam.TtsResultSrtFilePath
	if finalTargetSRT == "" {
		finalTargetSRT = targetSRTPathForDubbing(stepParam.TaskBasePath)
	}
	if err := persistDubbingSubtitles(sourceSRT, result.DubSRT, stepParam.TtsOriginSrtFilePath, finalTargetSRT, stepParam.TtsBilingualSrtFilePath); err != nil {
		return fmt.Errorf("srtFileToSpeech persist synchronized dubbing subtitles: %w", err)
	}
	stepParam.TtsResultFilePath = result.Audio
	stepParam.VideoWithTtsFilePath = result.Video
	if stepParam.TaskPtr != nil {
		stepParam.TaskPtr.SetProgress(98)
	}
	return nil
}
