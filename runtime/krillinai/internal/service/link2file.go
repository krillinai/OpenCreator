package service

import (
	"context"
	"errors"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"go.uber.org/zap"
)

func (s Service) linkToFile(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	var (
		err    error
		output []byte
	)
	link := stepParam.Link
	source, _ := url.Parse(strings.TrimSpace(link))
	sourceHost := ""
	if source != nil {
		sourceHost = strings.ToLower(source.Hostname())
	}
	audioPath := fmt.Sprintf("%s/%s", stepParam.TaskBasePath, types.SubtitleTaskAudioFileName)
	videoPath := fmt.Sprintf("%s/%s", stepParam.TaskBasePath, types.SubtitleTaskVideoFileName)
	localVideoPath, isLocal := resolveLocalMediaInput(link)
	stepParam.TaskPtr.SetProgress(3)
	if isLocal {
		// 本地文件
		videoPath = localVideoPath
		if stepParam.SkipAudio {
			stepParam.InputVideoPath = videoPath
			return nil
		}
		args := []string{"-y", "-i", videoPath, "-vn", "-ar", "44100", "-ac", "2", "-ab", "192k", "-f", "mp3", audioPath}
		output, err = runFFmpegProgress(ctx, args, videoPath, "extracting_audio", "正在提取音频", stepParam.TaskPtr, 0, 100)
		if err != nil {
			log.GetLogger().Error("generateAudioSubtitles.linkToFile ffmpeg error", zap.Any("step param", stepParam), zap.String("output", string(output)), zap.Error(err))
			return fmt.Errorf("generateAudioSubtitles.linkToFile ffmpeg error: %w", err)
		}
	} else if sourceHost == "youtu.be" || sourceHost == "youtube.com" || strings.HasSuffix(sourceHost, ".youtube.com") {
		var videoId string
		videoId, err = util.GetYouTubeID(link)
		if err != nil {
			log.GetLogger().Error("linkToFile.GetYouTubeID error", zap.Any("step param", stepParam), zap.Error(err))
			return fmt.Errorf("linkToFile.GetYouTubeID error: %w", err)
		}
		stepParam.Link = "https://www.youtube.com/watch?v=" + videoId
		if !stepParam.VttSwitch && !stepParam.SkipAudio {
			// 使用更灵活的音频格式选择器，避免 HTTP 403 错误。
			cmdArgs := []string{
				"--no-playlist",
				"-f", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/worst",
				"--extract-audio",
				"--audio-format", "mp3",
				"--audio-quality", "192K",
				"-o", audioPath,
				stepParam.Link,
			}
			if config.Conf.App.Proxy != "" {
				cmdArgs = append(cmdArgs, "--proxy", config.Conf.App.Proxy)
			}
			cmdArgs = appendCookiesArgs(cmdArgs, youtubeCookiesPath)
			if storage.FfmpegPath != "ffmpeg" {
				cmdArgs = append(cmdArgs, "--ffmpeg-location", storage.FfmpegPath)
			}
			output, err = downloadYouTubeMedia(ctx, cmdArgs, downloadProgressReporter(stepParam.TaskPtr, true, 0, 45))
			if err != nil {
				log.GetLogger().Error("linkToFile download audio yt-dlp error", zap.Any("step param", stepParam), zap.String("output", string(output)), zap.Error(err))
				return fmt.Errorf("linkToFile download audio yt-dlp error: %w: %s", err, compactCommandOutput(output))
			}
		}
	} else if sourceHost == "bilibili.com" || strings.HasSuffix(sourceHost, ".bilibili.com") {
		normalizedLink, normalizeErr := util.NormalizeBilibiliVideoURL(link)
		if normalizeErr != nil {
			return fmt.Errorf("linkToFile error: %w", normalizeErr)
		}
		stepParam.Link = normalizedLink
		if !stepParam.SkipAudio {
			cmdArgs := []string{"--no-playlist", "-f", "bestaudio[ext=m4a]", "-x", "--audio-format", "mp3", "-o", audioPath, stepParam.Link}
			if config.Conf.App.Proxy != "" {
				cmdArgs = append(cmdArgs, "--proxy", config.Conf.App.Proxy)
			}
			if storage.FfmpegPath != "ffmpeg" {
				cmdArgs = append(cmdArgs, "--ffmpeg-location", storage.FfmpegPath)
			}
			output, err = downloadBilibiliMedia(ctx, cmdArgs, downloadProgressReporter(stepParam.TaskPtr, true, 0, 45))
			if err != nil {
				log.GetLogger().Error("linkToFile download audio yt-dlp error", zap.Any("step param", stepParam), zap.String("output", string(output)), zap.Error(err))
				return fmt.Errorf("linkToFile download audio yt-dlp error: %w: %s", err, compactCommandOutput(output))
			}
		}
	} else if isAdditionalVideoSource(link) {
		if !stepParam.SkipAudio {
			cmdArgs := []string{"--no-playlist", "-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "192K", "-o", audioPath, stepParam.Link}
			if config.Conf.App.Proxy != "" {
				cmdArgs = append(cmdArgs, "--proxy", config.Conf.App.Proxy)
			}
			cmdArgs = appendCookiesArgs(cmdArgs, youtubeCookiesPath)
			if storage.FfmpegPath != "ffmpeg" {
				cmdArgs = append(cmdArgs, "--ffmpeg-location", storage.FfmpegPath)
			}
			output, err = runMediaDownload(ctx, cmdArgs, downloadProgressReporter(stepParam.TaskPtr, true, 0, 45))
			if err != nil {
				return fmt.Errorf("linkToFile download audio yt-dlp error: %w: %s", err, compactCommandOutput(output))
			}
		}
	} else {
		log.GetLogger().Info("linkToFile.unsupported link type", zap.Any("step param", stepParam))
		return errors.New("linkToFile error: unsupported public video source")
	}
	stepParam.TaskPtr.SetProgress(6)
	if !stepParam.SkipAudio {
		stepParam.AudioFilePath = audioPath
	}

	if !isLocal && stepParam.EmbedSubtitleVideoType != "none" {
		// 需要下载原视频
		cmdArgs := []string{"--no-playlist", "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]", "-o", videoPath, stepParam.Link}
		if isAdditionalVideoSource(stepParam.Link) {
			cmdArgs = []string{"--no-playlist", "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best", "--merge-output-format", "mp4", "--recode-video", "mp4", "-o", videoPath, stepParam.Link}
		}
		cmdArgs = appendCookiesArgs(cmdArgs, youtubeCookiesPath)
		if config.Conf.App.Proxy != "" {
			cmdArgs = append(cmdArgs, "--proxy", config.Conf.App.Proxy)
		}
		if storage.FfmpegPath != "ffmpeg" {
			cmdArgs = append(cmdArgs, "--ffmpeg-location", storage.FfmpegPath)
		}
		if util.IsYouTubeURL(stepParam.Link) {
			output, err = downloadYouTubeMedia(ctx, cmdArgs, downloadProgressReporter(stepParam.TaskPtr, false, 45, 95))
		} else if sourceHost == "bilibili.com" || strings.HasSuffix(sourceHost, ".bilibili.com") {
			output, err = downloadBilibiliMedia(ctx, cmdArgs, downloadProgressReporter(stepParam.TaskPtr, false, 45, 95))
		} else {
			output, err = runMediaDownload(ctx, cmdArgs, downloadProgressReporter(stepParam.TaskPtr, false, 45, 95))
		}
		if err != nil {
			log.GetLogger().Error("linkToFile download video yt-dlp error", zap.Any("step param", stepParam), zap.String("output", string(output)), zap.Error(err))
			return fmt.Errorf("linkToFile download video yt-dlp error: %w: %s", err, compactCommandOutput(output))
		}
	}
	stepParam.InputVideoPath = videoPath

	// 更新字幕任务信息
	stepParam.TaskPtr.ReportProgress(types.TaskProgress{Phase: "preparing_source", Percent: 100, Message: "媒体文件准备完成"})
	return nil
}

func isAdditionalVideoSource(value string) bool {
	source, err := url.Parse(strings.TrimSpace(value))
	if err != nil || source.Scheme != "https" {
		return false
	}
	host := strings.ToLower(source.Hostname())
	path := source.Path
	match := func(pattern string) bool { return regexp.MustCompile(pattern).MatchString(path) }
	switch {
	case host == "x.com" || strings.HasSuffix(host, ".x.com") || host == "twitter.com" || strings.HasSuffix(host, ".twitter.com"):
		return true
	case host == "vm.tiktok.com" || host == "vt.tiktok.com" || host == "v.douyin.com" || host == "fb.watch":
		return match(`^/[\w-]+/?$`)
	case host == "tiktok.com" || strings.HasSuffix(host, ".tiktok.com"):
		return match(`^/@[^/]+/video/\d+/?$`)
	case host == "instagram.com" || host == "www.instagram.com":
		return match(`^/(?:reel|p|tv)/[\w-]+/?$`)
	case host == "douyin.com" || host == "www.douyin.com":
		return match(`^/video/\d+/?$`)
	case host == "facebook.com" || host == "www.facebook.com" || host == "m.facebook.com":
		if match(`^/watch/?$`) {
			return regexp.MustCompile(`^\d+$`).MatchString(source.Query().Get("v"))
		}
		return match(`^/(?:reel/\d+|videos/\d+|[^/]+/videos/\d+)/?$`)
	case host == "xiaohongshu.com" || host == "www.xiaohongshu.com":
		return match(`(?i)^/explore/[0-9a-f]{24}/?$`)
	case host == "pinterest.com" || host == "www.pinterest.com":
		return match(`^/pin/\d+/?$`)
	case host == "b23.tv":
		return match(`^/[\w-]+/?$`)
	default:
		return false
	}
}

func resolveLocalMediaInput(input string) (string, bool) {
	value := strings.TrimSpace(input)
	if strings.HasPrefix(value, "local:") {
		return strings.TrimPrefix(value, "local:"), true
	}
	info, err := os.Stat(value)
	if err != nil || !info.Mode().IsRegular() {
		return "", false
	}
	return value, true
}

func compactCommandOutput(output []byte) string {
	const maximum = 1200
	value := strings.TrimSpace(string(output))
	var fatalLines []string
	for _, line := range strings.Split(value, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "ERROR:") {
			fatalLines = append(fatalLines, strings.TrimSpace(line))
		}
	}
	if len(fatalLines) > 0 {
		value = strings.Join(fatalLines, "\n") + "\n" + value
		return value[:min(len(value), maximum)]
	}
	if len(value) <= maximum {
		return value
	}
	return value[len(value)-maximum:]
}

func downloadYouTubeMedia(ctx context.Context, args []string, progress ...func(mediaDownloadProgress)) ([]byte, error) {
	const maxAttempts = 3
	var output []byte
	var err error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return output, err
		}
		commandArgs := args
		if attempt == maxAttempts {
			// HLS can remain available when the direct audio format is rejected.
			commandArgs = youtubeAudioFallbackArgs(args)
		}
		output, err = runMediaDownload(ctx, commandArgs, progress...)
		if err == nil || !strings.Contains(string(output), "HTTP Error 403") || attempt == maxAttempts {
			return output, err
		}
		// Re-run extraction to replace a rejected or expired signed media URL.
		log.GetLogger().Warn("YouTube media download returned 403; refreshing media URL", zap.Int("attempt", attempt))
		timer := time.NewTimer(time.Duration(attempt) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return output, ctx.Err()
		case <-timer.C:
		}
	}
	return output, err
}

func downloadBilibiliMedia(ctx context.Context, args []string, progress ...func(mediaDownloadProgress)) ([]byte, error) {
	const maxAttempts = 3
	var output []byte
	var err error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return output, err
		}
		output, err = runMediaDownload(ctx, args, progress...)
		if ctx.Err() != nil {
			return output, ctx.Err()
		}
		if err == nil {
			return output, err
		}
		message := strings.ToLower(string(output))
		riskControl := strings.Contains(message, "bilibili risk control")
		if !strings.Contains(message, "bilibili risk control rejected the media request") && !strings.Contains(message, "no video formats found") {
			return output, err
		}
		if attempt == maxAttempts {
			if riskControl {
				return output, fmt.Errorf("Bilibili risk control blocked media extraction after %d attempts; wait and retry or use a local video file: %w", maxAttempts, err)
			}
			return output, fmt.Errorf("Bilibili returned no usable media formats after %d attempts; wait and retry or use a local video file: %w", maxAttempts, err)
		}
		log.GetLogger().Warn("Bilibili media extraction was rejected; refreshing media info", zap.Int("attempt", attempt))
		timer := time.NewTimer(time.Duration(attempt) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return output, ctx.Err()
		case <-timer.C:
		}
	}
	return output, err
}

func youtubeAudioFallbackArgs(args []string) []string {
	if !slices.Contains(args, "--extract-audio") {
		return args
	}
	fallback := append([]string{}, args...)
	for index, arg := range fallback {
		if (arg == "-f" || arg == "--format") && index+1 < len(fallback) {
			fallback[index+1] = "bestaudio[protocol^=m3u8]/" + fallback[index+1]
			return append(fallback, "--concurrent-fragments", "4")
		}
	}
	return args
}
