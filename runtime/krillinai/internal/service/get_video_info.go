package service

import (
	"context"
	"fmt"
	"go.uber.org/zap"
	"krillin-ai/config"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"strings"
)

func (s Service) getVideoInfo(ctx context.Context, stepParam *types.SubtitleTaskStepParam) error {
	link := stepParam.Link
	if strings.Contains(link, "youtube.com") || strings.Contains(link, "bilibili.com") {
		var (
			err                error
			title, description string
		)
		// 获取标题
		titleCmdArgs := []string{"--no-playlist", "--skip-download", "--encoding", "utf-8", "--get-title", stepParam.Link}
		descriptionCmdArgs := []string{"--no-playlist", "--skip-download", "--encoding", "utf-8", "--get-description", stepParam.Link}
		titleCmdArgs = appendCookiesArgs(titleCmdArgs, youtubeCookiesPath)
		descriptionCmdArgs = appendCookiesArgs(descriptionCmdArgs, youtubeCookiesPath)
		if proxy := config.YouTubeProxy(); proxy != "" {
			titleCmdArgs = append(titleCmdArgs, "--proxy", proxy)
			descriptionCmdArgs = append(descriptionCmdArgs, "--proxy", proxy)
		}
		if storage.FfmpegPath != "ffmpeg" {
			titleCmdArgs = append(titleCmdArgs, "--ffmpeg-location", storage.FfmpegPath)
			descriptionCmdArgs = append(descriptionCmdArgs, "--ffmpeg-location", storage.FfmpegPath)
		}
		cmd := storage.YtdlpCommand(titleCmdArgs...)
		var output []byte
		output, err = cmd.CombinedOutput()
		if err != nil {
			log.GetLogger().Error("getVideoInfo yt-dlp error", zap.Any("stepParam", stepParam), zap.String("output", string(output)), zap.Error(err))
			output = []byte{}
			// 不需要整个流程退出
		}
		title = string(output)
		cmd = storage.YtdlpCommand(descriptionCmdArgs...)
		output, err = cmd.CombinedOutput()
		if err != nil {
			log.GetLogger().Error("getVideoInfo yt-dlp error", zap.Any("stepParam", stepParam), zap.String("output", string(output)), zap.Error(err))
			output = []byte{}
		}
		description = string(output)
		log.GetLogger().Debug("getVideoInfo title and description", zap.String("title", title), zap.String("description", description))
		// 翻译
		var result string
		result, err = s.ChatCompleter.ChatCompletion(fmt.Sprintf(types.TranslateVideoTitleAndDescriptionPrompt, types.GetStandardLanguageName(stepParam.TargetLanguage), title+"####"+description))
		if err != nil {
			log.GetLogger().Error("getVideoInfo openai chat completion error", zap.Any("stepParam", stepParam), zap.Error(err))
		}
		log.GetLogger().Debug("getVideoInfo translate video info result", zap.String("result", result))

		taskPtr := stepParam.TaskPtr

		taskPtr.Title = title
		taskPtr.Description = description
		taskPtr.OriginLanguage = string(stepParam.OriginLanguage)
		taskPtr.TargetLanguage = string(stepParam.TargetLanguage)
		taskPtr.SetProgress(10)
		splitResult := strings.Split(result, "####")
		if len(splitResult) == 1 {
			taskPtr.TranslatedTitle = splitResult[0]
		} else if len(splitResult) == 2 {
			taskPtr.TranslatedTitle = splitResult[0]
			taskPtr.TranslatedDescription = splitResult[1]
		} else {
			log.GetLogger().Error("getVideoInfo translate video info error split result length != 1 and 2", zap.Any("stepParam", stepParam), zap.Any("translate result", result), zap.Error(err))
		}
	}
	return nil
}
