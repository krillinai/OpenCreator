package service

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"krillin-ai/config"
	"krillin-ai/internal/storage"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"

	"go.uber.org/zap"
)

var ErrYouTubeCaptionAccess = errors.New("platform caption access failed")

// VttWord 表示VTT文件中的一个单词及其时间戳信息
type VttWord struct {
	Text  string // 单词文本，包含标点符号
	Start string // 开始时间戳字符串 (HH:MM:SS.mmm)
	End   string // 结束时间戳字符串 (HH:MM:SS.mmm)
	Num   int    // 序号
}

type YoutubeSubtitleReq struct {
	TaskBasePath        string
	TaskId              string
	URL                 string
	OriginLanguage      string
	TargetLanguage      string
	VttFile             string
	TaskPtr             *types.SubtitleTask
	SourceOnly          bool
	TargetLanguageFirst bool // 是否将目标语言放在上面（双语字幕）
}

// YouTubeSubtitleService handles all operations related to YouTube subtitles.
type YouTubeSubtitleService struct {
	translator         *Translator
	timestampGenerator *TimestampGenerator
}

type youtubeSubtitleFormat struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

type youtubeSubtitleMetadata struct {
	Language          string                             `json:"language"`
	Subtitles         map[string][]youtubeSubtitleFormat `json:"subtitles"`
	AutomaticCaptions map[string][]youtubeSubtitleFormat `json:"automatic_captions"`
}

type youtubeSubtitleTrack struct {
	Language  string
	Automatic bool
}

// NewYouTubeSubtitleService creates a new YouTubeSubtitleService.
func NewYouTubeSubtitleService() *YouTubeSubtitleService {
	return &YouTubeSubtitleService{
		translator:         NewTranslator(),
		timestampGenerator: NewTimestampGenerator(),
	}
}

// Process handles the entire workflow for YouTube subtitles, from downloading to processing.
func (s *YouTubeSubtitleService) Process(ctx context.Context, req *YoutubeSubtitleReq) (string, error) {
	// 1. Download subtitle file
	vttFile, err := s.downloadYouTubeSubtitle(ctx, req)
	if err != nil {
		// Return error to let the caller handle fallback (e.g., audio transcription)
		return "", err
	}

	req.VttFile = vttFile

	// 2. Process the downloaded subtitle file
	log.GetLogger().Info("Successfully downloaded YouTube subtitles, processing...", zap.String("taskId", req.TaskId))
	return s.processYouTubeSubtitle(ctx, req)
}

func (s *YouTubeSubtitleService) parseVttTime(timeStr string) (float64, error) {
	// VTT format: HH:MM:SS.ms or MM:SS.ms
	parts := strings.Split(timeStr, ":")
	var h, m, sec, ms int
	var err error

	if len(parts) == 3 { // HH:MM:SS.ms
		h, err = strconv.Atoi(parts[0])
		if err != nil {
			return 0, err
		}
		m, err = strconv.Atoi(parts[1])
		if err != nil {
			return 0, err
		}
		secParts := strings.Split(parts[2], ".")
		sec, err = strconv.Atoi(secParts[0])
		if err != nil {
			return 0, err
		}
		ms, err = strconv.Atoi(secParts[1])
		if err != nil {
			return 0, err
		}
	} else if len(parts) == 2 { // MM:SS.ms
		m, err = strconv.Atoi(parts[0])
		if err != nil {
			return 0, err
		}
		secParts := strings.Split(parts[1], ".")
		sec, err = strconv.Atoi(secParts[0])
		if err != nil {
			return 0, err
		}
		ms, err = strconv.Atoi(secParts[1])
		if err != nil {
			return 0, err
		}
	} else {
		return 0, fmt.Errorf("invalid time format: %s", timeStr)
	}

	return float64(h)*3600 + float64(m)*60 + float64(sec) + float64(ms)/1000, nil
}

// 使用yt-dlp下载YouTube视频的字幕文件
func (s *YouTubeSubtitleService) downloadYouTubeSubtitle(ctx context.Context, req *YoutubeSubtitleReq) (string, error) {
	if !util.IsYouTubeURL(req.URL) {
		return "", fmt.Errorf("downloadYouTubeSubtitle: not a YouTube link")
	}

	// 提取YouTube视频ID
	videoID, err := util.GetYouTubeID(req.URL)
	if err != nil {
		return "", fmt.Errorf("downloadYouTubeSubtitle: failed to extract video ID: %w", err)
	}

	// 确定要下载的字幕语言
	track, err := s.resolveYouTubeSubtitleTrack(ctx, req)
	if err != nil {
		return "", fmt.Errorf("downloadYouTubeSubtitle: resolve origin subtitle: %w", err)
	}
	if strings.EqualFold(strings.TrimSpace(req.OriginLanguage), "auto") {
		req.OriginLanguage = internalLanguageCodeFromYouTube(track.Language)
	}

	// 构造yt-dlp命令参数，使用视频ID作为文件名
	outputPattern := filepath.Join(req.TaskBasePath, videoID+".%(ext)s")
	cmdArgs := youtubeSubtitleCommandArgs(track, outputPattern)

	// 添加代理设置
	cmdArgs = appendYouTubeAccessArgs(cmdArgs)

	// 添加cookies（如果存在且格式有效）

	// 添加ffmpeg路径
	if storage.FfmpegPath != "ffmpeg" {
		cmdArgs = append(cmdArgs, "--ffmpeg-location", storage.FfmpegPath)
	}
	cmdArgs = append(cmdArgs, req.URL)

	log.GetLogger().Info("downloadYouTubeSubtitle starting",
		zap.String("taskId", req.TaskId),
		zap.String("subtitleLanguage", track.Language),
		zap.Bool("automatic", track.Automatic))

	// 添加重试机制
	maxAttempts := 3
	var lastErr error
	var lastOutput []byte

	for attempt := 0; attempt < maxAttempts; attempt++ {
		log.GetLogger().Info("Attempting to download YouTube subtitle",
			zap.Any("taskId", req.TaskId),
			zap.Int("attempt", attempt+1),
			zap.Int("maxAttempts", maxAttempts))

		cmd := storage.YtdlpCommand(cmdArgs...)
		output, err := cmd.CombinedOutput()

		if err == nil {
			log.GetLogger().Info("downloadYouTubeSubtitle completed", zap.Any("taskId", req.TaskId), zap.String("output", string(output)))

			// 查找下载的字幕文件
			subtitleFile, err := s.findDownloadedSubtitleFile(req.TaskBasePath, track.Language, videoID)
			if err != nil {
				log.GetLogger().Error("downloadYouTubeSubtitle findDownloadedSubtitleFile error", zap.Any("stepParam", req), zap.Error(err))
				return "", fmt.Errorf("downloadYouTubeSubtitle findDownloadedSubtitleFile error: %w", err)
			}

			log.GetLogger().Info("downloadYouTubeSubtitle found subtitle file", zap.Any("taskId", req.TaskId), zap.String("subtitleFile", subtitleFile))
			return subtitleFile, nil
		}

		lastErr = err
		lastOutput = output
		log.GetLogger().Warn("downloadYouTubeSubtitle attempt failed",
			zap.Any("taskId", req.TaskId),
			zap.Int("attempt", attempt+1),
			zap.String("output", string(output)),
			zap.Error(err))

		// 如果不是最后一次尝试，等待一段时间再重试
		if attempt < maxAttempts-1 {
			time.Sleep(time.Duration(attempt+1) * time.Second)
		}
	}

	log.GetLogger().Error("downloadYouTubeSubtitle failed after all attempts", zap.Any("req", req), zap.Error(lastErr))
	return "", fmt.Errorf(
		"%w: downloadYouTubeSubtitle yt-dlp error after %d attempts: %w: %s",
		ErrYouTubeCaptionAccess,
		maxAttempts,
		lastErr,
		compactCommandOutput(lastOutput),
	)
}

// 查找下载的字幕文件
func (s *YouTubeSubtitleService) resolveYouTubeSubtitleTrack(ctx context.Context, req *YoutubeSubtitleReq) (youtubeSubtitleTrack, error) {
	if err := ctx.Err(); err != nil {
		return youtubeSubtitleTrack{}, err
	}

	cmdArgs := []string{"--dump-single-json", "--skip-download", "--no-playlist"}
	cmdArgs = appendYouTubeAccessArgs(cmdArgs)
	cmdArgs = append(cmdArgs, req.URL)

	output, err := storage.YtdlpCommand(cmdArgs...).Output()
	if err != nil {
		details := ""
		if exitErr, ok := err.(*exec.ExitError); ok {
			details = compactCommandOutput(exitErr.Stderr)
		}
		if details != "" {
			return youtubeSubtitleTrack{}, fmt.Errorf("%w: yt-dlp subtitle metadata error: %w: %s", ErrYouTubeCaptionAccess, err, details)
		}
		return youtubeSubtitleTrack{}, fmt.Errorf("%w: yt-dlp subtitle metadata error: %w", ErrYouTubeCaptionAccess, err)
	}

	var metadata youtubeSubtitleMetadata
	if err := json.Unmarshal(output, &metadata); err != nil {
		return youtubeSubtitleTrack{}, fmt.Errorf("%w: parse yt-dlp subtitle metadata: %w", ErrYouTubeCaptionAccess, err)
	}

	manualLanguages := availableLanguageKeys(metadata.Subtitles)
	automaticLanguages := automaticOriginLanguageKeys(metadata.AutomaticCaptions)
	markedOriginLanguages := markedOriginalLanguageKeys(metadata.AutomaticCaptions)
	track, err := selectYouTubeSubtitleTrack(metadata, req.OriginLanguage)
	if err != nil {
		log.GetLogger().Warn("No matching YouTube origin subtitle track",
			zap.String("taskId", req.TaskId),
			zap.String("metadataLanguage", metadata.Language),
			zap.Strings("manualSubtitleLanguages", manualLanguages),
			zap.Strings("automaticSourceLanguages", automaticLanguages),
			zap.Strings("markedOriginLanguages", markedOriginLanguages),
			zap.Error(err))
		return youtubeSubtitleTrack{}, err
	}

	log.GetLogger().Info("Resolved YouTube origin subtitle track",
		zap.String("taskId", req.TaskId),
		zap.String("metadataLanguage", metadata.Language),
		zap.Strings("manualSubtitleLanguages", manualLanguages),
		zap.Strings("automaticSourceLanguages", automaticLanguages),
		zap.Strings("markedOriginLanguages", markedOriginLanguages),
		zap.String("selectedLanguage", track.Language),
		zap.Bool("automatic", track.Automatic))
	return track, nil
}

func selectYouTubeSubtitleTrack(metadata youtubeSubtitleMetadata, requestedLanguage string) (youtubeSubtitleTrack, error) {
	manualLanguages := availableLanguageKeys(metadata.Subtitles)
	automaticLanguages := automaticOriginLanguageKeys(metadata.AutomaticCaptions)
	markedOriginLanguages := markedOriginalLanguageKeys(metadata.AutomaticCaptions)
	requestedLanguage = strings.TrimSpace(requestedLanguage)

	if requestedLanguage != "" && !strings.EqualFold(requestedLanguage, "auto") {
		youtubeLanguage := util.MapLanguageForYouTube(requestedLanguage)
		if language, ok := matchMarkedOriginLanguage(youtubeLanguage, markedOriginLanguages); ok {
			return youtubeSubtitleTrack{Language: language, Automatic: true}, nil
		}
		if language, ok := matchAvailableLanguage(youtubeLanguage, manualLanguages); ok {
			return youtubeSubtitleTrack{Language: language}, nil
		}
		if language, ok := matchAvailableLanguage(youtubeLanguage, automaticLanguages); ok {
			return youtubeSubtitleTrack{Language: language, Automatic: true}, nil
		}
		return youtubeSubtitleTrack{}, fmt.Errorf("origin subtitle language %q is unavailable", youtubeLanguage)
	}

	if metadata.Language != "" {
		if language, ok := matchMarkedOriginLanguage(metadata.Language, markedOriginLanguages); ok {
			return youtubeSubtitleTrack{Language: language, Automatic: true}, nil
		}
	}
	if len(markedOriginLanguages) == 1 {
		return youtubeSubtitleTrack{Language: markedOriginLanguages[0], Automatic: true}, nil
	}

	if metadata.Language != "" {
		if language, ok := matchAvailableLanguage(metadata.Language, manualLanguages); ok {
			return youtubeSubtitleTrack{Language: language}, nil
		}
		if language, ok := matchAvailableLanguage(metadata.Language, automaticLanguages); ok {
			return youtubeSubtitleTrack{Language: language, Automatic: true}, nil
		}
	}

	if len(manualLanguages) == 1 {
		return youtubeSubtitleTrack{Language: manualLanguages[0]}, nil
	}
	if len(automaticLanguages) == 1 {
		return youtubeSubtitleTrack{Language: automaticLanguages[0], Automatic: true}, nil
	}

	return youtubeSubtitleTrack{}, fmt.Errorf("cannot determine the origin subtitle from available tracks")
}

func youtubeSubtitleCommandArgs(track youtubeSubtitleTrack, outputPattern string) []string {
	writeFlag := "--write-subs"
	if track.Automatic {
		writeFlag = "--write-auto-subs"
	}
	return []string{
		writeFlag,
		"--sub-langs", track.Language,
		"--sub-format", "vtt",
		"--skip-download",
		"--no-playlist",
		"-o", outputPattern,
	}
}

func appendYouTubeAccessArgs(cmdArgs []string) []string {
	if config.Conf.App.Proxy != "" {
		cmdArgs = append(cmdArgs, "--proxy", config.Conf.App.Proxy)
	}
	return appendCookiesArgs(cmdArgs, youtubeCookiesPath)
}

func availableLanguageKeys(tracks map[string][]youtubeSubtitleFormat) []string {
	languages := make([]string, 0, len(tracks))
	for language, formats := range tracks {
		if strings.TrimSpace(language) != "" && len(formats) > 0 {
			languages = append(languages, language)
		}
	}
	sort.Strings(languages)
	return languages
}

func automaticOriginLanguageKeys(tracks map[string][]youtubeSubtitleFormat) []string {
	languages := make([]string, 0, len(tracks))
	for language, formats := range tracks {
		if strings.TrimSpace(language) != "" && hasUntranslatedCaptionFormat(formats) {
			languages = append(languages, language)
		}
	}
	sort.Strings(languages)
	return languages
}

func markedOriginalLanguageKeys(tracks map[string][]youtubeSubtitleFormat) []string {
	languages := make([]string, 0, len(tracks))
	for language, formats := range tracks {
		if strings.HasSuffix(canonicalYouTubeLanguage(language), "-orig") || hasOriginalCaptionName(formats) {
			languages = append(languages, language)
		}
	}
	sort.Strings(languages)
	return languages
}

func hasOriginalCaptionName(formats []youtubeSubtitleFormat) bool {
	for _, format := range formats {
		if strings.Contains(strings.ToLower(format.Name), "original") {
			return true
		}
	}
	return false
}

func hasUntranslatedCaptionFormat(formats []youtubeSubtitleFormat) bool {
	for _, format := range formats {
		captionURL, err := url.Parse(format.URL)
		if err == nil && format.URL != "" && !captionURL.Query().Has("tlang") {
			return true
		}
	}
	return false
}

func matchAvailableLanguage(requestedLanguage string, availableLanguages []string) (string, bool) {
	requested := canonicalYouTubeLanguage(requestedLanguage)
	if requested == "" {
		return "", false
	}
	for _, language := range availableLanguages {
		if canonicalYouTubeLanguage(language) == requested {
			return language, true
		}
	}

	requestedBase := strings.Split(requested, "-")[0]
	var baseMatches []string
	for _, language := range availableLanguages {
		if strings.Split(canonicalYouTubeLanguage(language), "-")[0] == requestedBase {
			baseMatches = append(baseMatches, language)
		}
	}
	if len(baseMatches) == 1 {
		return baseMatches[0], true
	}
	return "", false
}

func matchMarkedOriginLanguage(requestedLanguage string, availableLanguages []string) (string, bool) {
	normalized := make([]string, 0, len(availableLanguages))
	for _, language := range availableLanguages {
		normalized = append(normalized, strings.TrimSuffix(canonicalYouTubeLanguage(language), "-orig"))
	}
	matched, ok := matchAvailableLanguage(requestedLanguage, normalized)
	if !ok {
		return "", false
	}
	for index, language := range normalized {
		if language == matched {
			return availableLanguages[index], true
		}
	}
	return "", false
}

func canonicalYouTubeLanguage(language string) string {
	language = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(language), "_", "-"))
	if language == "iw" {
		return "he"
	}
	return language
}

func internalLanguageCodeFromYouTube(language string) string {
	canonical := canonicalYouTubeLanguage(language)
	switch canonical {
	case "zh-hans", "zh-cn", "zh-sg", "zh":
		return "zh_cn"
	case "zh-hant", "zh-tw", "zh-hk", "zh-mo":
		return "zh_tw"
	}
	return strings.Split(canonical, "-")[0]
}

func (s *YouTubeSubtitleService) findDownloadedSubtitleFile(taskBasePath, language, videoID string) (string, error) {
	// 支持的字幕文件扩展名
	extensions := []string{".vtt", ".srt"}

	// 构造预期的文件名模式：{videoID}.{ext}
	for _, ext := range extensions {
		expectedFileName := fmt.Sprintf("%s.%s", videoID, ext)
		expectedPath := filepath.Join(taskBasePath, expectedFileName)

		// 检查文件是否存在
		if _, err := os.Stat(expectedPath); err == nil {
			return expectedPath, nil
		}
	}

	// 如果预期的文件名不存在，则回退到遍历目录的方式（兼容旧的命名方式）
	err := filepath.Walk(taskBasePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		fileName := info.Name()
		for _, ext := range extensions {
			// 检查文件名是否包含视频ID、语言代码和对应扩展名
			if strings.Contains(fileName, videoID) && strings.Contains(fileName, language) && strings.HasSuffix(fileName, ext) {
				return fmt.Errorf("found:%s", path) // 使用error来返回找到的文件路径
			}
		}
		return nil
	})

	if err != nil && strings.HasPrefix(err.Error(), "found:") {
		return strings.TrimPrefix(err.Error(), "found:"), nil
	}

	return "", fmt.Errorf("subtitle file not found for video ID: %s, language: %s", videoID, language)
}

// 处理YouTube字幕文件，转换为标准格式并进行翻译
func (s *YouTubeSubtitleService) processYouTubeSubtitle(ctx context.Context, req *YoutubeSubtitleReq) (string, error) {
	if req.VttFile == "" {
		return "", fmt.Errorf("processYouTubeSubtitle: no original subtitle file found")
	}

	log.GetLogger().Info("processYouTubeSubtitle start",
		zap.String("taskId", req.TaskId),
		zap.String("subtitleFile", req.VttFile))

	// 更新进度：开始处理
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(10)
	}

	// 1. 提取VTT单词
	vttFilePath := req.VttFile
	if vttFilePath == "" {
		foundVttFile, err := s.findVttFileInDirectory(req.TaskBasePath)
		if err != nil {
			return "", fmt.Errorf("failed to find VTT file: %w", err)
		}
		vttFilePath = foundVttFile
	}

	vttWords, err := s.ExtractWordsFromVtt(vttFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to extract VTT words: %w", err)
	}
	log.GetLogger().Info("提取VTT单词完成", zap.Int("单词数", len(vttWords)))
	if len(vttWords) == 0 {
		return "", fmt.Errorf("platform captions contained no usable text after filtering music, sound annotations and punctuation")
	}

	// 更新进度：提取完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(20)
	}

	// 2. 组织成句子
	var sentences []Sentence
	if req.SourceOnly {
		sentences = s.groupWordsIntoSentencesWithoutLLM(vttWords)
	} else {
		sentences = s.groupWordsIntoSentences(vttWords)
	}
	if len(sentences) == 0 {
		return "", fmt.Errorf("no sentences formed from VTT words")
	}
	log.GetLogger().Info("组织句子完成", zap.Int("句子数", len(sentences)))

	// 更新进度：句子组织完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(30)
	}

	// 3. 生成原始语言SRT文件（origin_language_srt.srt）
	originSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskOriginLanguageSrtFileName)
	srtBlocks, err := s.generateOriginLanguageSrt(sentences, originSrtFile, req)
	if err != nil {
		return "", fmt.Errorf("failed to generate origin language SRT: %w", err)
	}
	log.GetLogger().Info("生成原始语言SRT完成",
		zap.String("文件", originSrtFile),
		zap.Int("块数", len(srtBlocks)))

	// 更新进度：原始SRT生成完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(40)
	}
	if req.SourceOnly {
		if req.TaskPtr != nil {
			req.TaskPtr.SetProgress(100)
		}
		return originSrtFile, nil
	}

	// 4. 批量翻译生成目标语言SRT（40%-90%进度）
	err = s.translator.BatchTranslateSrtBlocks(srtBlocks, req.OriginLanguage, req.TargetLanguage, req.TaskPtr)
	if err != nil {
		return "", fmt.Errorf("failed to batch translate: %w", err)
	}
	log.GetLogger().Info("批量翻译完成", zap.Int("块数", len(srtBlocks)))

	// 更新进度：翻译完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(90)
	}

	// 5. 生成目标语言SRT文件（target_language_srt.srt）
	targetSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskTargetLanguageSrtFileName)
	err = s.writeTargetLanguageSrtFile(srtBlocks, targetSrtFile)
	if err != nil {
		return "", fmt.Errorf("failed to write target language SRT: %w", err)
	}
	log.GetLogger().Info("生成目标语言SRT完成", zap.String("文件", targetSrtFile))

	// 更新进度：目标语言SRT生成完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(92)
	}

	// 6. 生成双语字幕文件（bilingual_srt.srt）
	bilingualSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskBilingualSrtFileName)
	err = s.writeBilingualSrtFile(srtBlocks, bilingualSrtFile, req.TargetLanguageFirst)
	if err != nil {
		return "", fmt.Errorf("failed to write bilingual SRT: %w", err)
	}
	log.GetLogger().Info("生成双语字幕完成", zap.String("文件", bilingualSrtFile))

	// 更新进度：双语字幕生成完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(95)
	}

	// 7. 生成短字幕文件（竖屏用）
	shortSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskShortOriginMixedSrtFileName)
	err = s.writeShortSubtitleFile(srtBlocks, sentences, shortSrtFile, req.TargetLanguageFirst)
	if err != nil {
		log.GetLogger().Warn("生成短字幕失败", zap.Error(err))
		// 不影响主流程，继续执行
	} else {
		log.GetLogger().Info("生成短字幕完成", zap.String("文件", shortSrtFile))
	}

	// 更新进度：短字幕生成完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(98)
	}

	// 8. 生成纯文本文件到output目录
	outputDir := filepath.Join(req.TaskBasePath, "output")
	err = os.MkdirAll(outputDir, 0755)
	if err != nil {
		log.GetLogger().Warn("创建output目录失败", zap.Error(err))
	}
	originTxtFile := filepath.Join(outputDir, "origin_language.txt")
	targetTxtFile := filepath.Join(outputDir, "target_language.txt")
	err = s.generateTextFiles(srtBlocks, originTxtFile, targetTxtFile, req.TargetLanguage)
	if err != nil {
		log.GetLogger().Warn("生成文本文件失败", zap.Error(err))
	} else {
		log.GetLogger().Info("生成文本文件完成",
			zap.String("原文", originTxtFile),
			zap.String("译文", targetTxtFile))
	}

	// 更新进度：完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(100)
	}

	log.GetLogger().Info("processYouTubeSubtitle 处理完成",
		zap.String("taskId", req.TaskId),
		zap.String("输出文件", bilingualSrtFile))

	return bilingualSrtFile, nil
}

// ExtractWordsFromVtt 从VTT文件中提取所有单词及其时间戳信息
func (s *YouTubeSubtitleService) ExtractWordsFromVtt(vttFile string) ([]VttWord, error) {
	// 记录正在尝试打开的文件路径
	log.GetLogger().Info("Attempting to open VTT file", zap.String("filePath", vttFile))

	file, err := os.Open(vttFile)
	if err != nil {
		return nil, fmt.Errorf("读取VTT文件失败: %w", err)
	}
	defer file.Close()

	var words []VttWord
	scanner := bufio.NewScanner(file)
	var blockStartTime, blockEndTime string
	wordNum := 0

	// 匹配时间戳行的正则表达式（支持有空格和无空格的格式）
	timestampLineRegex := regexp.MustCompile(`^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})`)
	// 匹配单词级时间戳的正则表达式
	wordTimeRegex := regexp.MustCompile(`<(\d{2}:\d{2}:\d{2}\.\d{3})>`)
	// 清理样式标签
	styleTagRegex := regexp.MustCompile(`</?c[^>]*>`)

	log.GetLogger().Debug("开始解析VTT文件", zap.String("文件", vttFile))

	// 用于跟踪已处理的单词，避免重复
	processedWords := make(map[string]bool)
	// 用于跟踪单词文本，避免同一个单词重复添加
	seenWordTexts := make(map[string]bool)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// 跳过空行和头部信息
		if line == "" || strings.HasPrefix(line, "WEBVTT") ||
			strings.HasPrefix(line, "Kind:") || strings.HasPrefix(line, "Language:") {
			continue
		}

		// 检查是否是时间戳行（可能包含align等属性）
		if matches := timestampLineRegex.FindStringSubmatch(line); len(matches) >= 3 {
			blockStartTime = matches[1]
			blockEndTime = matches[2]
			log.GetLogger().Debug("发现时间戳", zap.String("开始", blockStartTime), zap.String("结束", blockEndTime))
			continue
		}

		// 如果不是时间戳行，且有有效的时间戳信息，则处理内容
		if blockStartTime != "" && blockEndTime != "" && line != "" {
			// 首先清理HTML实体和特殊字符
			cleanedLine := s.cleanVttText(line)

			// 如果清理后为空或只是空白字符，跳过
			if strings.TrimSpace(cleanedLine) == "" {
				continue
			}

			// 优先处理包含内联时间戳的行（这些是真正的单词级时间戳数据）
			if wordTimeRegex.MatchString(cleanedLine) {
				// 处理包含单词级时间戳的行
				styleCleaned := styleTagRegex.ReplaceAllString(cleanedLine, "")
				wordsFromLine := s.parseWordsWithTimestamps(styleCleaned, blockStartTime, blockEndTime, &wordNum)

				// 添加带时间戳的单词，这些有更高优先级
				for _, word := range wordsFromLine {
					// 再次清理单词文本
					word.Text = s.cleanVttText(word.Text)
					if strings.TrimSpace(word.Text) == "" {
						continue // 跳过空的单词
					}

					// 过滤掉单独的双引号
					trimmedText := strings.TrimSpace(word.Text)
					if s.isSingleDoubleQuote(trimmedText) {
						log.GetLogger().Debug("过滤掉单独的双引号", zap.String("文本", trimmedText))
						continue // 跳过单独的双引号
					}

					wordKey := fmt.Sprintf("%s-%s-%s", word.Text, word.Start, word.End)
					if !processedWords[wordKey] {
						words = append(words, word)
						processedWords[wordKey] = true
						// 同时记录这个单词文本已经被处理过
						seenWordTexts[strings.ToLower(word.Text)] = true
						log.GetLogger().Debug("添加带时间戳的单词",
							zap.String("文本", word.Text),
							zap.String("开始", word.Start),
							zap.String("结束", word.End))
					}
				}
			} else {
				// 对于没有内联时间戳的行，需要更严格的判断
				trimmedLine := strings.TrimSpace(cleanedLine)

				// 跳过明显的重复内容行（通常是完整句子的重复）
				if s.isLikelyRepeatContent(trimmedLine) {
					log.GetLogger().Debug("跳过重复内容", zap.String("文本", trimmedLine))
					continue
				}

				// 检查是否为有效的单个单词
				if s.isValidSingleWord(trimmedLine) {
					// 检查这个单词文本是否已经被处理过（忽略大小写）
					wordTextLower := strings.ToLower(trimmedLine)
					if seenWordTexts[wordTextLower] {
						log.GetLogger().Debug("跳过重复单词",
							zap.String("文本", trimmedLine),
							zap.String("时间", blockStartTime+" -> "+blockEndTime))
						continue
					}

					// 过滤掉单独的双引号
					if s.isSingleDoubleQuote(trimmedLine) {
						log.GetLogger().Debug("过滤掉单独的双引号", zap.String("文本", trimmedLine))
						continue // 跳过单独的双引号
					}

					// 创建单词的唯一标识
					wordKey := fmt.Sprintf("%s-%s-%s", trimmedLine, blockStartTime, blockEndTime)
					if !processedWords[wordKey] {
						wordNum++
						word := VttWord{
							Text:  trimmedLine,
							Start: blockStartTime,
							End:   blockEndTime,
							Num:   wordNum,
						}
						words = append(words, word)
						processedWords[wordKey] = true
						seenWordTexts[wordTextLower] = true
						log.GetLogger().Debug("添加单个单词",
							zap.String("文本", trimmedLine),
							zap.String("开始", blockStartTime),
							zap.String("结束", blockEndTime))
					}
				} else {
					// 跳过完整句子或无效内容
					log.GetLogger().Debug("跳过完整句子或无效内容", zap.String("文本", trimmedLine))
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取VTT文件失败: %v", err)
	}

	log.GetLogger().Info("VTT单词解析完成", zap.Int("总单词数", len(words)))
	return words, nil
}

// cleanVttText 清理VTT文本中的HTML实体和特殊字符，包括音乐标记等
func (s *YouTubeSubtitleService) cleanVttText(text string) string {
	if text == "" {
		return text
	}
	text = html.UnescapeString(text)
	text = strings.NewReplacer("\u200b", "", "\u200c", "", "\u200d", "", "\u00a0", " ").Replace(text)

	// 先过滤音乐和其他提示标记（方括号内容）
	// 匹配 [music], [applause], [laughter], [inaudible] 等标记
	bracketRegex := regexp.MustCompile(`\[[^\]]*\]`)
	cleanedText := bracketRegex.ReplaceAllString(text, "")

	// 过滤圆括号内的提示（如 (music), (applause) 等）- 更全面的匹配
	parenRegex := regexp.MustCompile(`\([^)]*(?i:music|applause|laughter|laugh|inaudible|mumbling|cheering|whistling|booing|silence|noise|sound|audio)[^)]*\)`)
	cleanedText = parenRegex.ReplaceAllString(cleanedText, "")

	// 过滤音乐符号和表情符号
	musicSymbolRegex := regexp.MustCompile(`[♪♫♬♩🎵🎶🎤🎧🎼🎹🎸🎺🎻🥁]`)
	cleanedText = musicSymbolRegex.ReplaceAllString(cleanedText, "")

	// 过滤 >> 符号（YouTube自动字幕的提示符号）
	cleanedText = strings.ReplaceAll(cleanedText, ">>", "")

	// 过滤常见的语气词（位于句首或独立出现时）
	// 匹配 Um, Uh, Er, Ah, Oh, Mm, Hmm 等，支持大小写
	fillerWordsRegex := regexp.MustCompile(`(?i)^\s*(um|uh|er|ah|oh|mm|hmm|hm|eh)\s*[,，]?\s*`)
	cleanedText = fillerWordsRegex.ReplaceAllString(cleanedText, "")

	// 移除多余的空格
	cleanedText = strings.TrimSpace(cleanedText)

	// 将多个连续空格替换为单个空格
	spaceRegex := regexp.MustCompile(`\s+`)
	cleanedText = spaceRegex.ReplaceAllString(cleanedText, " ")

	return cleanedText
}

// isPurePunctuation 检查文本是否只包含标点符号
func (s *YouTubeSubtitleService) isPurePunctuation(text string) bool {
	if text == "" {
		return false
	}

	// 定义标点符号正则表达式（只包含标点符号，不包含字母和数字）
	punctOnlyRegex := regexp.MustCompile(`^[^\p{L}\p{N}]+$`)
	return punctOnlyRegex.MatchString(text)
}

// isAudioCue 检查是否为音频提示词（如music等）
func (s *YouTubeSubtitleService) isAudioCue(text string) bool {
	if text == "" {
		return false
	}

	// 将文本转为小写进行匹配
	lowerText := strings.ToLower(text)

	// 精确匹配的音频提示词列表（完全匹配，不使用Contains）
	exactAudioCues := []string{
		"music", "applause", "laughter", "laugh", "clapping", "clap",
		"cheering", "cheer", "whistling", "whistle", "booing", "boo",
		"silence", "quiet", "noise", "sound", "audio", "inaudible",
		"mumbling", "mumble", "sighing", "sigh", "gasping", "gasp",
		"crying", "cry", "sobbing", "sob", "screaming", "scream",
		"shouting", "shout", "yelling", "yell", "singing", "sing",
		"humming", "hum", "buzzing", "buzz", "ringing", "ring",
		"beeping", "beep", "clicking", "click", "ticking", "tick",
		"background", "bgm", "sfx", "fx", "effect", "effects",
	}

	// 检查是否完全匹配任何音频提示词
	for _, cue := range exactAudioCues {
		if lowerText == cue {
			return true
		}
	}

	// 检查是否包含特殊字符模式（如♪, ♫, ♬等音乐符号）
	musicSymbolRegex := regexp.MustCompile(`[♪♫♬♩🎵🎶]`)
	if musicSymbolRegex.MatchString(text) {
		return true
	}

	return false
}

// isLikelyRepeatContent 检查是否为重复的内容行（通常是完整句子）
func (s *YouTubeSubtitleService) isLikelyRepeatContent(text string) bool {
	if text == "" {
		return false
	}

	// 如果包含多个单词（有空格），很可能是重复的完整句子
	if strings.Contains(text, " ") {
		return true
	}

	// 如果文本很长（超过20个字符），也可能是重复内容
	if len(text) > 20 {
		return true
	}

	return false
}

// isValidSingleWord 检查是否为有效的单个单词
func (s *YouTubeSubtitleService) isValidSingleWord(text string) bool {
	if text == "" {
		return false
	}

	// 不能包含空格（单个单词）
	if strings.Contains(text, " ") {
		return false
	}

	// 检查是否为音乐或其他提示标记
	if s.isAudioCue(text) {
		return false
	}

	// 不能只是标点符号
	if s.isPurePunctuation(text) {
		return false
	}

	// 长度需要合理（1-15个字符）
	if len(text) < 1 || len(text) > 15 {
		return false
	}

	return true
}

// parseWordsWithTimestamps 解析包含时间戳的内容行，保持标点符号与单词的完整性
func (s *YouTubeSubtitleService) parseWordsWithTimestamps(line, blockStart, blockEnd string, wordNum *int) []VttWord {
	var words []VttWord

	// 匹配单词级时间戳
	wordTimeRegex := regexp.MustCompile(`<(\d{2}:\d{2}:\d{2}\.\d{3})>`)

	// 按时间戳分割文本
	timeMatches := wordTimeRegex.FindAllStringSubmatch(line, -1)
	textParts := wordTimeRegex.Split(line, -1)

	log.GetLogger().Debug("解析行内容",
		zap.String("原始行", line),
		zap.Int("时间戳数量", len(timeMatches)),
		zap.Int("文本片段数量", len(textParts)))

	// 处理第一个文本片段（开始到第一个时间戳）
	if len(textParts) > 0 && strings.TrimSpace(textParts[0]) != "" {
		firstWordText := strings.TrimSpace(textParts[0])
		var endTime string
		if len(timeMatches) > 0 {
			endTime = timeMatches[0][1]
		} else {
			endTime = blockEnd
		}

		// 分割成单词但保持标点符号
		wordsInPart := s.splitIntoWordsKeepPunctuation(firstWordText)
		for _, wordText := range wordsInPart {
			words = append(words, VttWord{
				Text:  wordText,
				Start: blockStart,
				End:   endTime,
				Num:   *wordNum,
			})
			(*wordNum)++
		}
	}

	// 处理剩余的文本片段
	for i := 1; i < len(textParts); i++ {
		textPart := strings.TrimSpace(textParts[i])
		if textPart == "" {
			continue
		}

		// 确定开始时间
		startTime := timeMatches[i-1][1]

		// 确定结束时间
		var endTime string
		if i < len(timeMatches) {
			endTime = timeMatches[i][1]
		} else {
			endTime = blockEnd
		}

		// 分割成单词但保持标点符号
		wordsInPart := s.splitIntoWordsKeepPunctuation(textPart)
		for _, wordText := range wordsInPart {
			words = append(words, VttWord{
				Text:  wordText,
				Start: startTime,
				End:   endTime,
				Num:   *wordNum,
			})
			(*wordNum)++
		}
	}

	return words
}

// splitIntoWordsKeepPunctuation 将文本分割成单词，但保持标点符号与单词的完整性
func (s *YouTubeSubtitleService) splitIntoWordsKeepPunctuation(text string) []string {
	if strings.TrimSpace(text) == "" {
		return nil
	}

	// 使用空格分割，但保持标点符号与单词在一起
	rawWords := strings.Fields(text)
	var result []string

	for _, word := range rawWords {
		// 清理每个单词中的特殊字符
		cleanedWord := s.cleanVttText(word)
		if strings.TrimSpace(cleanedWord) != "" {
			result = append(result, cleanedWord)
		}
	}

	return result
}

// ConvertVttToSrt 将VTT转换为SRT格式
func (s *YouTubeSubtitleService) ConvertVttToSrt(req *YoutubeSubtitleReq, srtFile string) error {
	// 检查VttFile字段是否存在
	vttFilePath := req.VttFile
	if vttFilePath == "" {
		// 如果VttFile为空，尝试在任务目录中查找VTT文件
		log.GetLogger().Warn("VTT file path is empty, trying to find VTT file in task directory",
			zap.String("taskBasePath", req.TaskBasePath))

		foundVttFile, err := s.findVttFileInDirectory(req.TaskBasePath)
		if err != nil {
			return fmt.Errorf("VTT file path is empty and failed to find VTT file in directory: %w", err)
		}
		vttFilePath = foundVttFile
		log.GetLogger().Info("Found VTT file in task directory", zap.String("vttFile", vttFilePath))
	}

	// 使用新的ExtractWordsFromVtt函数获取VttWord
	vttWords, err := s.ExtractWordsFromVtt(vttFilePath)
	if err != nil {
		return fmt.Errorf("failed to extract VTT words: %w", err)
	}

	// 将VttWord转换为SRT格式
	return s.writeVttWordsToSrt(vttWords, srtFile, req)
}

// findVttFileInDirectory 在指定目录中查找VTT文件
func (s *YouTubeSubtitleService) findVttFileInDirectory(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", fmt.Errorf("failed to read directory %s: %w", dir, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		fileName := entry.Name()
		if strings.HasSuffix(strings.ToLower(fileName), ".vtt") {
			fullPath := filepath.Join(dir, fileName)
			log.GetLogger().Info("Found VTT file", zap.String("file", fullPath))
			return fullPath, nil
		}
	}

	return "", fmt.Errorf("no VTT file found in directory: %s", dir)
}

// writeVttWordsToSrt 将VttWord数组写入SRT文件，支持翻译和时间戳生成
func (s *YouTubeSubtitleService) writeVttWordsToSrt(vttWords []VttWord, srtFile string, req *YoutubeSubtitleReq) error {
	if len(vttWords) == 0 {
		return fmt.Errorf("no VTT words to write")
	}

	// 初始进度基准（从当前进度开始，到90%结束）
	baseProgress := uint8(10) // 假设函数开始时已有10%进度
	if req.TaskPtr != nil && req.TaskPtr.ProcessPct > 0 {
		baseProgress = req.TaskPtr.ProcessPct
	}
	targetProgress := uint8(90) // 函数完成时的目标进度

	// 步骤1: 根据标点符号将单词整理成完整的句子 (约占总进度的10%)
	sentences := s.groupWordsIntoSentences(vttWords)
	// 输出句子到调试文件
	debugFile := filepath.Join(req.TaskBasePath, "no_ts.txt")
	if err := s.writeSentencesToDebugFile(sentences, debugFile); err != nil {
		log.GetLogger().Warn("Failed to write sentences debug file", zap.Error(err))
	}
	if len(sentences) == 0 {
		return fmt.Errorf("no sentences formed from VTT words")
	}

	// 更新进度到15%
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(baseProgress + uint8(float64(targetProgress-baseProgress)*0.1))
		log.GetLogger().Info("Progress updated after grouping sentences",
			zap.Uint8("progress", req.TaskPtr.ProcessPct))
	}

	log.GetLogger().Info("Grouped VTT words into sentences", zap.Int("句子数", len(sentences)))

	// 创建初始的SrtBlock列表
	srtBlocks := make([]*util.SrtBlock, 0, 2*len(sentences))

	// 使用并发翻译，同时保证顺序
	type translationResult struct {
		index  int
		blocks []*util.SrtBlock
		err    error
	}

	// 创建结果通道和goroutine数量控制
	resultCh := make(chan translationResult, len(sentences))
	maxConcurrency := 5 // 限制并发数量，避免请求过多
	semaphore := make(chan struct{}, maxConcurrency)

	// 启动并发翻译
	for idx, sentence := range sentences {
		go func(index int, sent Sentence) {
			// 获取信号量
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			translatedBlocks, err := s.translator.SplitTextAndTranslate(sent.Text, types.StandardLanguageCode(req.OriginLanguage), types.StandardLanguageCode(req.TargetLanguage))
			if err != nil {
				log.GetLogger().Warn("Translation failed, using original text",
					zap.Int("index", index),
					zap.Error(err))
				resultCh <- translationResult{index: index, blocks: nil, err: err}
				return
			}

			// 构建临时SrtBlock
			notsSrtBlock := make([]*util.SrtBlock, 0, len(translatedBlocks))
			for _, block := range translatedBlocks {
				notsSrtBlock = append(notsSrtBlock, &util.SrtBlock{
					OriginLanguageSentence: block.OriginText,
					TargetLanguageSentence: block.TranslatedText,
				})
			}

			// 生成时间戳
			updatedBlocks, err := s.timestampGenerator.GenerateTimestamps(
				notsSrtBlock,
				s.convertVttWordsToTypesWords(sent.Words),
				types.StandardLanguageCode("base"), // 默认使用base语言类型
				0.0,                                // 时间偏移
			)
			if err != nil {
				log.GetLogger().Warn("Timestamp generation failed",
					zap.Int("index", index),
					zap.Error(err))
				updatedBlocks = notsSrtBlock // 使用未生成时间戳的块
			}

			resultCh <- translationResult{index: index, blocks: updatedBlocks, err: nil}
		}(idx, sentence)
	}

	// 收集结果，按顺序排列，实时更新进度 (占总进度的70%)
	results := make(map[int][]*util.SrtBlock)
	completedTasks := 0
	translationProgressBase := baseProgress + uint8(float64(targetProgress-baseProgress)*0.1) // 15%
	translationProgressRange := uint8(float64(targetProgress-baseProgress) * 0.7)             // 70%的进度范围

	for i := 0; i < len(sentences); i++ {
		result := <-resultCh
		completedTasks++

		if result.err == nil {
			results[result.index] = result.blocks
		}

		// 实时更新翻译进度
		if req.TaskPtr != nil {
			currentTranslationProgress := float64(completedTasks) / float64(len(sentences))
			req.TaskPtr.SetProgress(translationProgressBase + uint8(float64(translationProgressRange)*currentTranslationProgress))

			// 每完成5个或完成所有任务时记录日志
			if completedTasks%5 == 0 || completedTasks == len(sentences) {
				log.GetLogger().Info("Translation progress updated",
					zap.Int("completed", completedTasks),
					zap.Int("total", len(sentences)),
					zap.Uint8("progress", req.TaskPtr.ProcessPct))
			}
		}
	}

	// 按顺序添加到最终的srtBlocks (占总进度的10%)
	var blockIndex int
	for i := 0; i < len(sentences); i++ {
		if blocks, exists := results[i]; exists {
			for _, block := range blocks {
				srtBlocks = append(srtBlocks, &util.SrtBlock{
					Index:                  blockIndex + 1,
					Timestamp:              block.Timestamp,
					OriginLanguageSentence: block.OriginLanguageSentence,
					TargetLanguageSentence: block.TargetLanguageSentence,
				})
				blockIndex++
			}
		}
	}

	// 更新进度到85%（结果整理完成）
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(baseProgress + uint8(float64(targetProgress-baseProgress)*0.85))
		log.GetLogger().Info("Progress updated after organizing results",
			zap.Uint8("progress", req.TaskPtr.ProcessPct))
	}

	// 步骤6: 写入正常的SRT文件
	err := s.writeSrtBlocksToFile(srtBlocks, srtFile)
	if err != nil {
		return err
	}

	// 更新进度到88%（正常SRT文件写入完成）
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(baseProgress + uint8(float64(targetProgress-baseProgress)*0.88))
		log.GetLogger().Info("Progress updated after writing SRT file",
			zap.Uint8("progress", req.TaskPtr.ProcessPct))
	}

	// 步骤7: 生成短字幕文件
	shortSrtFile := filepath.Join(filepath.Dir(srtFile), types.SubtitleTaskShortOriginMixedSrtFileName)
	err = s.writeShortSubtitleFile(srtBlocks, sentences, shortSrtFile, req.TargetLanguageFirst)
	if err != nil {
		log.GetLogger().Warn("生成短字幕失败", zap.Error(err))
		// 不影响主流程，继续执行
	} else {
		log.GetLogger().Info("生成短字幕完成", zap.String("文件", shortSrtFile))
	}

	// 最终更新进度到90%（所有操作完成）
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(targetProgress)
		log.GetLogger().Info("writeVttWordsToSrt completed",
			zap.Uint8("final_progress", req.TaskPtr.ProcessPct),
			zap.Int("total_srt_blocks", len(srtBlocks)))
	}

	return nil
}

// Sentence 表示一个完整的句子及其时间信息
type Sentence struct {
	Text      string    // 句子文本
	Words     []VttWord // 组成句子的单词
	StartTime string    // 句子开始时间
	EndTime   string    // 句子结束时间
}

func (s *YouTubeSubtitleService) groupWordsIntoSentencesWithoutLLM(words []VttWord) []Sentence {
	primarySentences := s.splitByPrimarySentencePunctuation(words)
	deterministicSentences := make([]Sentence, 0, len(primarySentences))
	for _, sentence := range primarySentences {
		if util.CountEffectiveChars(sentence.Text) <= config.Conf.App.MaxSentenceLength {
			deterministicSentences = append(deterministicSentences, sentence)
			continue
		}
		for _, candidate := range s.splitByCommasPunctuation(sentence.Words) {
			if util.CountEffectiveChars(candidate.Text) > config.Conf.App.MaxSentenceLength {
				deterministicSentences = append(deterministicSentences, s.splitByFixedLength(candidate.Words)...)
			} else {
				deterministicSentences = append(deterministicSentences, candidate)
			}
		}
	}
	return s.cleanupPunctuationOnlySentences(deterministicSentences)
}

// groupWordsIntoSentences 根据标点符号将单词分组成完整的句子
func (s *YouTubeSubtitleService) groupWordsIntoSentences(words []VttWord) []Sentence {
	if len(words) == 0 {
		return nil
	}

	fmt.Printf("\n========== 开始句子分组 ==========\n")
	fmt.Printf("总单词数: %d\n", len(words))
	fmt.Printf("最大句子长度: %d 字符\n\n", config.Conf.App.MaxSentenceLength)

	// 第一步：按整句标点符号分割（句号、问号、感叹号）
	primarySentences := s.splitByPrimarySentencePunctuation(words)
	fmt.Printf("=== 第一步：按句号/问号/感叹号分割 ===\n")
	fmt.Printf("结果: %d 个句子\n\n", len(primarySentences))

	log.GetLogger().Info("第一步：按句号/问号/感叹号分割完成",
		zap.Int("总单词数", len(words)),
		zap.Int("句子数", len(primarySentences)))

	// 第二步：对超长的句子按逗号、分号等进行二次分割
	fmt.Printf("=== 第二步：检查超长句子并按逗号/分号分割 ===\n")
	var secondarySentences []Sentence
	superLongCount := 0
	for _, sentence := range primarySentences {
		sentenceChars := util.CountEffectiveChars(sentence.Text)
		if sentenceChars > config.Conf.App.MaxSentenceLength {
			superLongCount++
			fmt.Printf("发现超长句子 #%d: %d 字符\n", superLongCount, sentenceChars)
			log.GetLogger().Info("检测到超长句子，尝试按逗号分割",
				zap.String("句子预览", sentence.Text[:min(len(sentence.Text), 80)]+"..."),
				zap.Int("字符数", sentenceChars))
			// 超长句子，按逗号等进行二次分割
			splitResults := s.splitByCommasPunctuation(sentence.Words)
			secondarySentences = append(secondarySentences, splitResults...)
		} else {
			// 句子长度合适，直接保留
			secondarySentences = append(secondarySentences, sentence)
		}
	}
	fmt.Printf("共处理 %d 个超长句子\n", superLongCount)
	fmt.Printf("结果: %d 个句子\n\n", len(secondarySentences))
	log.GetLogger().Info("第二步：按逗号/分号分割完成",
		zap.Int("句子数", len(secondarySentences)))

	// 第三步：对仍然超长的句子，使用LLM递归拆分（并发处理）
	var llmSplitSentences []Sentence
	var needLLMSplit []int // 记录需要LLM拆分的句子索引

	// 先筛选出需要LLM拆分的句子
	for i, sentence := range secondarySentences {
		sentenceChars := util.CountEffectiveChars(sentence.Text)
		if sentenceChars > config.Conf.App.MaxSentenceLength {
			needLLMSplit = append(needLLMSplit, i)
		}
	}

	if len(needLLMSplit) > 0 {
		fmt.Printf("\n=== 第三步：LLM递归拆分 ===\n")
		fmt.Printf("检测到 %d 个超长句子需要LLM拆分（总共 %d 句）\n", len(needLLMSplit), len(secondarySentences))
		fmt.Printf("并发限制：3个goroutine\n\n")

		log.GetLogger().Info("检测到需要LLM拆分的超长句子",
			zap.Int("超长句子数", len(needLLMSplit)),
			zap.Int("总句子数", len(secondarySentences)))

		// 使用并发处理LLM拆分
		type llmResult struct {
			index     int
			sentences []Sentence
		}
		resultChan := make(chan llmResult, len(needLLMSplit))
		semaphore := make(chan struct{}, 3) // 限制并发数为3

		// 并发处理每个超长句子，使用信号量控制并发数
		for _, idx := range needLLMSplit {
			semaphore <- struct{}{} // 获取信号量
			go func(index int, sentence Sentence) {
				defer func() { <-semaphore }() // 释放信号量

				sentenceChars := util.CountEffectiveChars(sentence.Text)
				log.GetLogger().Warn("并发调用LLM递归拆分",
					zap.Int("句子索引", index),
					zap.String("句子预览", sentence.Text[:min(len(sentence.Text), 80)]+"..."),
					zap.Int("字符数", sentenceChars))

				splitResults := s.splitSentenceByLLMRecursive(sentence)
				resultChan <- llmResult{index: index, sentences: splitResults}
			}(idx, secondarySentences[idx])
		}

		// 收集所有结果
		llmResults := make(map[int][]Sentence)
		for i := 0; i < len(needLLMSplit); i++ {
			result := <-resultChan
			llmResults[result.index] = result.sentences
			fmt.Printf("进度: %d/%d - 句子#%d 拆分完成，得到 %d 个子句\n",
				i+1, len(needLLMSplit), result.index, len(result.sentences))
		}
		close(resultChan)
		fmt.Printf("\n所有LLM拆分任务完成！\n\n")

		// 按顺序合并结果
		for i, sentence := range secondarySentences {
			if splitResults, exists := llmResults[i]; exists {
				llmSplitSentences = append(llmSplitSentences, splitResults...)
			} else {
				llmSplitSentences = append(llmSplitSentences, sentence)
			}
		}
	} else {
		llmSplitSentences = secondarySentences
	}

	fmt.Printf("=== LLM拆分统计 ===\n")
	fmt.Printf("拆分前: %d 句\n", len(secondarySentences))
	fmt.Printf("拆分后: %d 句\n\n", len(llmSplitSentences))

	log.GetLogger().Info("第三步：LLM递归拆分完成",
		zap.Int("句子数", len(llmSplitSentences)))

	// 第四步：清理单独的标点符号和过短的句子
	finalSentences := s.cleanupPunctuationOnlySentences(llmSplitSentences)
	fmt.Printf("=== 第四步：清理标点符号句子 ===\n")
	fmt.Printf("结果: %d 个句子\n\n", len(finalSentences))

	log.GetLogger().Info("第四步：清理标点符号句子完成",
		zap.Int("最终句子数", len(finalSentences)))

	// 统计最终结果
	maxChars := 0
	avgChars := 0
	shortSentences := 0 // 单词数<3的句子
	for _, sent := range finalSentences {
		chars := util.CountEffectiveChars(sent.Text)
		if chars > maxChars {
			maxChars = chars
		}
		avgChars += chars
		if len(sent.Words) < 3 {
			shortSentences++
		}
	}
	if len(finalSentences) > 0 {
		avgChars = avgChars / len(finalSentences)
	}

	fmt.Printf("========== 句子分组完成 ==========\n")
	fmt.Printf("总单词数: %d\n", len(words))
	fmt.Printf("最终句子数: %d\n", len(finalSentences))
	fmt.Printf("最长句子: %d 字符\n", maxChars)
	fmt.Printf("平均长度: %d 字符\n", avgChars)
	fmt.Printf("短句(<3词): %d 个\n", shortSentences)
	fmt.Printf("================================\n\n")

	log.GetLogger().Info("句子分组完成",
		zap.Int("总单词数", len(words)),
		zap.Int("最终句子数", len(finalSentences)),
		zap.Int("最长句子字符数", maxChars),
		zap.Int("平均句子字符数", avgChars))

	return finalSentences
}

// GroupWordsIntoSentencesPublic 公开的分组方法，用于测试
func (s *YouTubeSubtitleService) GroupWordsIntoSentencesPublic(words []VttWord) []Sentence {
	return s.groupWordsIntoSentences(words)
}

// ExtractWordsFromVttPublic 公开的VTT提取方法，用于测试
func (s *YouTubeSubtitleService) ExtractWordsFromVttPublic(vttFile string) ([]VttWord, error) {
	return s.ExtractWordsFromVtt(vttFile)
}

// SplitBySecondarySentencePunctuationPublic 公开的二次分割方法，用于测试
func (s *YouTubeSubtitleService) SplitBySecondarySentencePunctuationPublic(words []VttWord) []Sentence {
	return s.splitBySecondarySentencePunctuation(words)
}

// CleanVttTextPublic 公开的文本清理方法，用于测试
func (s *YouTubeSubtitleService) CleanVttTextPublic(text string) string {
	return s.cleanVttText(text)
}

// IsValidSingleWordPublic 公开的单词验证方法，用于测试
func (s *YouTubeSubtitleService) IsValidSingleWordPublic(text string) bool {
	return s.isValidSingleWord(text)
}

// IsAudioCuePublic 公开的音频提示检测方法，用于测试
func (s *YouTubeSubtitleService) IsAudioCuePublic(text string) bool {
	return s.isAudioCue(text)
}

// SplitBySecondarySentencePunctuationWithDepthPublic 公开的深度分割方法，用于测试
func (s *YouTubeSubtitleService) SplitBySecondarySentencePunctuationWithDepthPublic(words []VttWord) []Sentence {
	return s.splitBySecondarySentencePunctuationWithDepth(words, 0)
}

// CreateSentenceFromWordsPublic 公开的句子创建方法，用于测试
func (s *YouTubeSubtitleService) CreateSentenceFromWordsPublic(words []VttWord) Sentence {
	return s.createSentenceFromWords(words)
}

// cleanupPunctuationOnlySentences 清理只包含标点符号的句子，将其合并到前一句
func (s *YouTubeSubtitleService) cleanupPunctuationOnlySentences(sentences []Sentence) []Sentence {
	if len(sentences) <= 1 {
		return sentences
	}

	var result []Sentence
	removedCount := 0

	for _, sentence := range sentences {
		sentenceText := strings.TrimSpace(sentence.Text)

		// 检查是否只是标点符号或非常短的文本
		if s.isPunctuationOnly(sentenceText) && len(result) > 0 {
			removedCount++
			log.GetLogger().Info("发现单独的双引号句子，将被移除",
				zap.String("text", sentenceText),
				zap.String("sentence_full", sentence.Text))

			// 将标点符号合并到前一句
			lastIdx := len(result) - 1
			prevSentence := &result[lastIdx]

			// 合并文本，添加空格（如果需要）
			if prevSentence.Text != "" && !strings.HasSuffix(prevSentence.Text, " ") {
				prevSentence.Text += " " + sentenceText
			} else {
				prevSentence.Text += sentenceText
			}

			// 合并单词数据
			prevSentence.Words = append(prevSentence.Words, sentence.Words...)

			// 更新结束时间
			if sentence.EndTime != "" {
				prevSentence.EndTime = sentence.EndTime
			}

			log.GetLogger().Debug("Merged punctuation-only sentence",
				zap.String("punctuation", sentenceText),
				zap.String("merged_into", prevSentence.Text))
		} else {
			// 正常句子，直接添加
			result = append(result, sentence)
		}
	}

	log.GetLogger().Info("清理双引号句子完成",
		zap.Int("输入句子数", len(sentences)),
		zap.Int("输出句子数", len(result)),
		zap.Int("移除的双引号句子数", removedCount))

	return result
}

// isPunctuationOnly 检查文本是否只包含标点符号或单个字符
func (s *YouTubeSubtitleService) isPunctuationOnly(text string) bool {
	if text == "" {
		return true
	}

	// 只过滤单独的双引号（各种类型的双引号）
	trimmed := strings.TrimSpace(text)
	doubleQuotes := []string{"\"", "\u201c", "\u201d"} // 英文双引号、中文左双引号、中文右双引号
	for _, quote := range doubleQuotes {
		if trimmed == quote {
			return true // 只有双引号才过滤
		}
	}

	// 不再过滤其他标点符号，让它们保留
	return false
}

// isSingleDoubleQuote 检查文本是否是单独的双引号
func (s *YouTubeSubtitleService) isSingleDoubleQuote(text string) bool {
	trimmed := strings.TrimSpace(text)
	doubleQuotes := []string{"\"", "\u201c", "\u201d"} // 英文双引号、中文左双引号、中文右双引号
	for _, quote := range doubleQuotes {
		if trimmed == quote {
			return true
		}
	}
	return false
}

// endsWithSentencePunctuation 检查文本是否以句子结束标点符号结尾
func (s *YouTubeSubtitleService) endsWithSentencePunctuation(text string, punctuation []rune) bool {
	if text == "" {
		return false
	}

	textRunes := []rune(text)
	lastRune := textRunes[len(textRunes)-1]

	// 直接检查最后一个字符
	for _, punct := range punctuation {
		if lastRune == punct {
			return true
		}
	}

	// 检查倒数第二个字符（处理引号后的标点情况，如 TLC."）
	if len(textRunes) >= 2 {
		secondLastRune := textRunes[len(textRunes)-2]
		// 如果最后一个字符是引号，检查倒数第二个字符是否是标点
		if lastRune == '"' || lastRune == '\u201c' || lastRune == '\u201d' || lastRune == '」' || lastRune == '』' {
			for _, punct := range punctuation {
				if secondLastRune == punct {
					return true
				}
			}
		}
	}

	return false
}

// containsQuoteStart 检查文本是否包含引号开始符号
func (s *YouTubeSubtitleService) containsQuoteStart(text string) bool {
	quoteStarts := []string{`"`, `"`, `「`, `『`}
	for _, start := range quoteStarts {
		if strings.Contains(text, start) {
			return true
		}
	}
	return false
}

// containsQuoteEnd 检查文本是否包含引号结束符号
func (s *YouTubeSubtitleService) containsQuoteEnd(text string) bool {
	quoteEnds := []string{`"`, `"`, `」`, `』`}
	for _, end := range quoteEnds {
		if strings.Contains(text, end) {
			return true
		}
	}
	return false
}

// splitByPrimarySentencePunctuation 按整句标点符号（句号、问号、感叹号）分割
func (s *YouTubeSubtitleService) splitByPrimarySentencePunctuation(words []VttWord) []Sentence {
	if len(words) == 0 {
		return nil
	}

	var sentences []Sentence
	var currentWords []VttWord
	primaryEndPunctuation := []rune{'.', '!', '?', '。', '！', '？'}

	// 常见的缩写词，不应该作为句子结束标志
	abbreviations := map[string]bool{
		"dr.": true, "mr.": true, "mrs.": true, "ms.": true, "prof.": true,
		"vs.": true, "etc.": true, "inc.": true, "ltd.": true, "corp.": true,
		"co.": true, "jr.": true, "sr.": true, "st.": true, "ave.": true,
		"blvd.": true, "rd.": true, "apt.": true, "no.": true, "vol.": true,
		"ch.": true, "sec.": true, "fig.": true, "pg.": true, "pp.": true,
		"i.e.": true, "e.g.": true, "cf.": true, "et.": true, "al.": true,
	}

	// 跟踪引号状态
	var inQuotes bool

	for i, word := range words {
		currentWords = append(currentWords, word)

		// 检查引号状态变化
		if s.containsQuoteStart(word.Text) && !inQuotes {
			inQuotes = true
		}

		// 检查单词是否以整句结束标点符号结尾
		if s.endsWithSentencePunctuation(word.Text, primaryEndPunctuation) {
			wordLower := strings.ToLower(strings.TrimSpace(word.Text))

			// 如果是缩写词，不分句
			if abbreviations[wordLower] {
				continue
			}

			// 如果只是一个标点符号（如单独的引号），合并到前一句而不分句
			if len(strings.TrimSpace(word.Text)) == 1 && i > 0 {
				continue
			}

			// 检查是否在引号内
			if inQuotes {
				// 如果当前词包含引号结束，结束引号状态并分句
				if s.containsQuoteEnd(word.Text) {
					inQuotes = false
					if len(currentWords) > 0 {
						sentence := s.createSentenceFromWords(currentWords)
						sentences = append(sentences, sentence)
						currentWords = []VttWord{} // 重置
					}
				} else {
					// 在引号内但没有引号结束符，也可以分句（引号内分句是允许的）
					if len(currentWords) > 0 {
						sentence := s.createSentenceFromWords(currentWords)
						sentences = append(sentences, sentence)
						currentWords = []VttWord{} // 重置
					}
				}
			} else {
				// 正常分句（不在引号内）
				if len(currentWords) > 0 {
					sentence := s.createSentenceFromWords(currentWords)
					sentences = append(sentences, sentence)
					currentWords = []VttWord{} // 重置
				}
			}
		}
	}

	// 处理最后一组单词（如果没有以标点结尾）
	if len(currentWords) > 0 {
		sentence := s.createSentenceFromWords(currentWords)
		sentences = append(sentences, sentence)
	}

	return sentences
}

// splitBySecondarySentencePunctuation 按逗号、分号等断句标点符号分割
func (s *YouTubeSubtitleService) splitBySecondarySentencePunctuation(words []VttWord) []Sentence {
	return s.splitBySecondarySentencePunctuationWithDepth(words, 0)
}

// splitByCommasPunctuation 简单按逗号和分号分割句子（不再使用复杂的智能分割）
func (s *YouTubeSubtitleService) splitByCommasPunctuation(words []VttWord) []Sentence {
	if len(words) == 0 {
		return nil
	}

	var sentences []Sentence
	var currentWords []VttWord

	for _, word := range words {
		currentWords = append(currentWords, word)

		// 检查是否以逗号或分号结尾
		if strings.HasSuffix(word.Text, ",") || strings.HasSuffix(word.Text, ";") ||
			strings.HasSuffix(word.Text, "，") || strings.HasSuffix(word.Text, "；") {

			// 检查当前积累的单词是否已经足够长
			if len(currentWords) >= 3 { // 至少3个单词才分句
				sentence := s.createSentenceFromWords(currentWords)
				sentences = append(sentences, sentence)
				currentWords = nil
			}
		}
	}

	// 处理剩余的词语
	if len(currentWords) > 0 {
		// 创建最后一个句子，不要合并到前一句
		sentences = append(sentences, s.createSentenceFromWords(currentWords))
	}

	// 检查是否成功按逗号拆分
	if len(sentences) <= 1 {
		// 没有找到逗号分割点或拆分失败
		sentenceText := s.createSentenceFromWords(words).Text
		sentenceChars := util.CountEffectiveChars(sentenceText)

		// 如果句子仍然很长，使用简单语义关键词拆分
		if sentenceChars > config.Conf.App.MaxSentenceLength {
			log.GetLogger().Info("没有逗号分割点，使用简单语义关键词拆分",
				zap.Int("字符数", sentenceChars),
				zap.Int("单词数", len(words)))

			// 使用简化的语义拆分（更快速）
			return s.splitBySimpleSemanticBreaks(words)
		}
		return []Sentence{s.createSentenceFromWords(words)}
	}

	// 按逗号拆分成功，记录日志
	log.GetLogger().Info("按逗号拆分完成",
		zap.Int("输入单词数", len(words)),
		zap.Int("输出句子数", len(sentences)))

	return sentences
}

// splitSentenceByLLMRecursive 使用LLM递归拆分超长句子
func (s *YouTubeSubtitleService) splitSentenceByLLMRecursive(sentence Sentence) []Sentence {
	// 调用translator的递归拆分方法
	splitTexts := s.translator.RecursiveSplitSentence(sentence.Text, 0)

	if len(splitTexts) <= 1 {
		// LLM拆分失败，返回原句
		log.GetLogger().Warn("LLM拆分失败或返回单句，保留原句",
			zap.String("原句", sentence.Text[:min(len(sentence.Text), 80)]+"..."))
		return []Sentence{sentence}
	}

	// 将拆分后的文本映射回VttWord
	var results []Sentence
	wordIndex := 0
	allWords := sentence.Words
	const minWordsPerSentence = 3 // 每个句子最少3个单词

	for i, splitText := range splitTexts {
		splitText = strings.TrimSpace(splitText)
		if splitText == "" {
			continue
		}

		// 查找匹配的单词序列
		matchedWords := s.findMatchingWords(splitText, allWords, wordIndex)

		// 检查是否达到最小单词数
		if len(matchedWords) < minWordsPerSentence {
			// 单词数太少，记录警告但仍然添加
			log.GetLogger().Warn("LLM拆分结果单词数不足",
				zap.Int("片段序号", i+1),
				zap.String("文本", splitText),
				zap.Int("单词数", len(matchedWords)),
				zap.Int("最小要求", minWordsPerSentence))
		}

		if len(matchedWords) > 0 {
			results = append(results, s.createSentenceFromWords(matchedWords))
			wordIndex += len(matchedWords)
			log.GetLogger().Debug("LLM拆分结果",
				zap.Int("片段序号", i+1),
				zap.String("文本", splitText[:min(len(splitText), 50)]),
				zap.Int("单词数", len(matchedWords)))
		} else {
			log.GetLogger().Warn("无法找到匹配的单词序列",
				zap.String("拆分文本", splitText[:min(len(splitText), 50)]))
		}
	}

	// 如果有剩余的单词，添加到最后一句
	if wordIndex < len(allWords) && len(results) > 0 {
		lastIdx := len(results) - 1
		remainingWords := allWords[wordIndex:]
		allWords := append(results[lastIdx].Words, remainingWords...)
		results[lastIdx] = s.createSentenceFromWords(allWords)
		log.GetLogger().Debug("合并剩余单词到最后一句",
			zap.Int("剩余单词数", len(remainingWords)))
	}

	// 如果拆分结果为空，返回原句
	if len(results) == 0 {
		log.GetLogger().Warn("LLM拆分后结果为空，保留原句")
		return []Sentence{sentence}
	}

	return results
}

// findMatchingWords 在单词列表中查找匹配文本的单词序列
func (s *YouTubeSubtitleService) findMatchingWords(targetText string, words []VttWord, startIndex int) []VttWord {
	if startIndex >= len(words) {
		return nil
	}

	// 清理目标文本
	targetText = strings.TrimSpace(targetText)
	targetWords := strings.Fields(targetText)

	var matchedWords []VttWord
	currentIndex := startIndex
	targetWordIndex := 0

	// 尝试匹配单词
	for currentIndex < len(words) && targetWordIndex < len(targetWords) {
		wordText := strings.ToLower(strings.TrimSpace(words[currentIndex].Text))
		// 移除标点符号进行比较
		wordTextClean := strings.Trim(wordText, ".,;:!?\"'()[]{}")
		targetWord := strings.ToLower(strings.TrimSpace(targetWords[targetWordIndex]))
		targetWordClean := strings.Trim(targetWord, ".,;:!?\"'()[]{}")

		if wordTextClean == targetWordClean || strings.Contains(wordTextClean, targetWordClean) {
			matchedWords = append(matchedWords, words[currentIndex])
			targetWordIndex++
		}
		currentIndex++

		// 如果已经匹配了很多单词但还有很多目标单词未匹配，可能匹配错误
		if len(matchedWords) > len(targetWords)*2 {
			break
		}
	}

	// 如果匹配的单词数量太少，认为匹配失败
	if len(matchedWords) < len(targetWords)/2 {
		return nil
	}

	return matchedWords
}

// splitAtCommas 按逗号分割句子，返回分割后的词语组
func (s *YouTubeSubtitleService) splitAtCommas(words []VttWord) [][]VttWord {
	if len(words) == 0 {
		return nil
	}

	var result [][]VttWord
	var currentPart []VttWord

	for _, word := range words {
		currentPart = append(currentPart, word)

		// 检查是否以逗号或分号结尾
		if strings.HasSuffix(word.Text, ",") || strings.HasSuffix(word.Text, ";") ||
			strings.HasSuffix(word.Text, "，") || strings.HasSuffix(word.Text, "；") {

			// 保存当前部分
			if len(currentPart) > 0 {
				result = append(result, currentPart)
				currentPart = nil
			}
		}
	}

	// 处理剩余的词语
	if len(currentPart) > 0 {
		result = append(result, currentPart)
	}

	// 如果没有找到逗号，返回原始句子
	if len(result) <= 1 {
		return [][]VttWord{words}
	}

	// 合并过短的子句（少于2个单词的子句）
	var mergedResult [][]VttWord
	var tempPart []VttWord

	for i, part := range result {
		if len(part) == 1 {
			// 1个单词的部分，先暂存
			tempPart = append(tempPart, part...)
		} else {
			// 多个单词的部分
			if len(tempPart) > 0 {
				// 如果有暂存的单个单词，与当前部分合并
				mergedPart := append(tempPart, part...)
				mergedResult = append(mergedResult, mergedPart)
				tempPart = nil
			} else {
				// 没有暂存的单个单词，直接加入
				mergedResult = append(mergedResult, part)
			}
		}

		// 如果是最后一个部分，且还有暂存的单词
		if i == len(result)-1 && len(tempPart) > 0 {
			if len(mergedResult) > 0 {
				// 与最后一个已添加的部分合并
				lastIndex := len(mergedResult) - 1
				mergedResult[lastIndex] = append(mergedResult[lastIndex], tempPart...)
			} else {
				// 如果没有其他部分，直接作为一个部分
				mergedResult = append(mergedResult, tempPart)
			}
		}
	}

	return mergedResult
}

// splitBySecondarySentencePunctuationWithDepth 用递归方式分割长句
func (s *YouTubeSubtitleService) splitBySecondarySentencePunctuationWithDepth(words []VttWord, depth int) []Sentence {
	// 防止无限递归
	if depth > 3 {
		return []Sentence{s.createSentenceFromWords(words)}
	}

	// 检查整句是否过长，如果不长就检查是否有逗号可以分割
	sentenceText := s.createSentenceFromWords(words).Text
	totalEffectiveChars := util.CountEffectiveChars(sentenceText)

	log.GetLogger().Info("尝试分割长句", zap.String("sentence", sentenceText), zap.Int("chars", totalEffectiveChars), zap.Int("depth", depth))

	// 第一步：尝试逗号分割（不管长度，优先按逗号分割）
	commaSplitResult := s.splitAtCommas(words)
	if len(commaSplitResult) > 1 {
		// 检查是否所有分割出的子句都符合要求（不太长）
		allValid := true
		for _, part := range commaSplitResult {
			partText := s.createSentenceFromWords(part).Text
			partChars := util.CountEffectiveChars(partText)
			if partChars > config.Conf.App.MaxSentenceLength {
				// 分割后仍然过长
				allValid = false
				break
			}
		}

		if allValid {
			// 逗号分割成功，将所有部分转换为句子
			var sentences []Sentence
			for _, part := range commaSplitResult {
				sentences = append(sentences, s.createSentenceFromWords(part))
			}
			log.GetLogger().Info("逗号分割成功", zap.Int("parts", len(sentences)))
			return sentences
		}
	}

	// 如果逗号分割失败或没有逗号，检查是否需要进一步分割
	if totalEffectiveChars <= config.Conf.App.MaxSentenceLength {
		// 句子不长且没有有效的逗号分割，直接返回
		return []Sentence{s.createSentenceFromWords(words)}
	}

	// 第二步：逗号分割失败，对每个过长的部分使用智能分割
	var sentences []Sentence
	for _, part := range commaSplitResult {
		partText := s.createSentenceFromWords(part).Text
		partChars := util.CountEffectiveChars(partText)

		if partChars > config.Conf.App.MaxSentenceLength {
			// 过长的部分，使用智能分割
			smartSplitResult := s.splitBySmartRules(part)
			sentences = append(sentences, smartSplitResult...)
		} else {
			// 合适长度的部分，直接加入
			sentences = append(sentences, s.createSentenceFromWords(part))
		}
	}

	return sentences
}

// isInterruptionPattern 检查当前位置是否是插入语模式
// 例如: "personally, yes," "actually, no," "well, okay," 等
func (s *YouTubeSubtitleService) isInterruptionPattern(words []VttWord, currentIndex int) bool {
	if currentIndex >= len(words)-1 {
		return false
	}

	// 检查下一个词是否是常见的插入语词汇，并且以逗号结尾
	nextWordIndex := currentIndex + 1
	if nextWordIndex < len(words) {
		nextWord := strings.ToLower(strings.TrimSpace(words[nextWordIndex].Text))

		// 常见的插入语词汇列表
		interruptionWords := []string{
			"yes,", "yeah,", "no,", "okay,", "ok,", "right,", "well,",
			"actually,", "really,", "indeed,", "certainly,", "sure,",
			"exactly,", "absolutely,", "definitely,", "probably,", "maybe,",
		}

		for _, interruptionWord := range interruptionWords {
			if nextWord == interruptionWord {
				return true
			}
		}
	}

	return false
}

// createSentenceFromWords 从单词列表创建句子
func (s *YouTubeSubtitleService) createSentenceFromWords(words []VttWord) Sentence {
	if len(words) == 0 {
		return Sentence{}
	}

	var textParts []string
	for _, word := range words {
		textParts = append(textParts, word.Text)
	}

	return Sentence{
		Text:      strings.Join(textParts, " "),
		Words:     words,
		StartTime: words[0].Start,
		EndTime:   words[len(words)-1].End,
	}
}

// convertVttWordsToTypesWords 将VttWord转换为types.Word供时间戳生成器使用
func (s *YouTubeSubtitleService) convertVttWordsToTypesWords(vttWords []VttWord) []types.Word {
	var typesWords []types.Word

	for _, vttWord := range vttWords {
		// 将字符串时间戳转换为float64
		startTime, _ := s.parseVttTime(vttWord.Start)
		endTime, _ := s.parseVttTime(vttWord.End)

		typesWords = append(typesWords, types.Word{
			Text:  vttWord.Text,
			Start: startTime,
			End:   endTime,
			Num:   vttWord.Num,
		})
	}

	return typesWords
}

// writeSrtBlocksToFile 将SrtBlock数组写入文件
func (s *YouTubeSubtitleService) writeSrtBlocksToFile(blocks []*util.SrtBlock, srtFile string) error {
	file, err := os.Create(srtFile)
	if err != nil {
		return fmt.Errorf("failed to create SRT file: %w", err)
	}
	defer file.Close()

	for _, block := range blocks {
		// 写入序号
		_, err = file.WriteString(fmt.Sprintf("%d\n", block.Index))
		if err != nil {
			return err
		}

		// 写入时间戳
		_, err = file.WriteString(block.Timestamp + "\n")
		if err != nil {
			return err
		}

		// 写入文本内容 - 双语显示：目标语言在上，原语言在下
		var textContent strings.Builder
		if block.TargetLanguageSentence != "" {
			textContent.WriteString(block.TargetLanguageSentence)
			if block.OriginLanguageSentence != "" {
				textContent.WriteString("\n")
				textContent.WriteString(block.OriginLanguageSentence)
			}
		} else if block.OriginLanguageSentence != "" {
			// 如果没有翻译，只显示原语言
			textContent.WriteString(block.OriginLanguageSentence)
		}

		if textContent.Len() > 0 {
			_, err = file.WriteString(textContent.String() + "\n\n")
			if err != nil {
				return err
			}
		}
	}

	log.GetLogger().Info("SRT file written successfully",
		zap.String("文件", srtFile),
		zap.Int("块数", len(blocks)))

	return nil
}

// writeTargetLanguageSrtFile 写入只包含目标语言的SRT文件
func (s *YouTubeSubtitleService) writeTargetLanguageSrtFile(blocks []*util.SrtBlock, srtFile string) error {
	file, err := os.Create(srtFile)
	if err != nil {
		return fmt.Errorf("failed to create target language SRT file: %w", err)
	}
	defer file.Close()

	for _, block := range blocks {
		// 写入序号
		_, err = file.WriteString(fmt.Sprintf("%d\n", block.Index))
		if err != nil {
			return err
		}

		// 写入时间戳
		_, err = file.WriteString(block.Timestamp + "\n")
		if err != nil {
			return err
		}

		// 只写入目标语言文本
		if block.TargetLanguageSentence != "" {
			_, err = file.WriteString(block.TargetLanguageSentence + "\n\n")
			if err != nil {
				return err
			}
		} else if block.OriginLanguageSentence != "" {
			// 如果没有翻译，使用原语言
			_, err = file.WriteString(block.OriginLanguageSentence + "\n\n")
			if err != nil {
				return err
			}
		}
	}

	log.GetLogger().Info("Target language SRT file written successfully",
		zap.String("文件", srtFile),
		zap.Int("块数", len(blocks)))

	return nil
}

// generateOriginLanguageSrt 生成原始语言SRT文件（word-level VTT处理）
func (s *YouTubeSubtitleService) generateOriginLanguageSrt(sentences []Sentence, srtFile string, req *YoutubeSubtitleReq) ([]*util.SrtBlock, error) {
	srtBlocks := make([]*util.SrtBlock, 0, len(sentences))

	// 为每个句子创建SRT块
	for idx, sentence := range sentences {
		// VTT时间戳已经是字符串格式 (HH:MM:SS.mmm)
		// 需要转换为SRT格式 (HH:MM:SS,mmm) - 只是把点换成逗号
		startTime := strings.Replace(sentence.StartTime, ".", ",", 1)
		endTime := strings.Replace(sentence.EndTime, ".", ",", 1)

		timestamp := fmt.Sprintf("%s --> %s", startTime, endTime)

		// 创建SRT块
		srtBlocks = append(srtBlocks, &util.SrtBlock{
			Index:                  idx + 1,
			Timestamp:              timestamp,
			OriginLanguageSentence: sentence.Text,
			TargetLanguageSentence: "", // 稍后翻译
		})
	}

	// 写入原始语言SRT文件
	file, err := os.Create(srtFile)
	if err != nil {
		return nil, fmt.Errorf("failed to create origin language SRT file: %w", err)
	}
	defer file.Close()

	for _, block := range srtBlocks {
		_, err = file.WriteString(fmt.Sprintf("%d\n", block.Index))
		if err != nil {
			return nil, err
		}

		_, err = file.WriteString(block.Timestamp + "\n")
		if err != nil {
			return nil, err
		}

		_, err = file.WriteString(block.OriginLanguageSentence + "\n\n")
		if err != nil {
			return nil, err
		}
	}

	return srtBlocks, nil
}

// formatTimeForSrt 将浮点数时间格式化为SRT时间戳格式
func (s *YouTubeSubtitleService) formatTimeForSrt(timeInSeconds float64) string {
	hours := int(timeInSeconds) / 3600
	minutes := (int(timeInSeconds) % 3600) / 60
	seconds := int(timeInSeconds) % 60
	milliseconds := int((timeInSeconds - float64(int(timeInSeconds))) * 1000)

	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, milliseconds)
}

// writeBilingualSrtFile 生成双语字幕文件，支持配置目标语言在上或在下
func (s *YouTubeSubtitleService) writeBilingualSrtFile(blocks []*util.SrtBlock, srtFile string, targetLanguageFirst bool) error {
	file, err := os.Create(srtFile)
	if err != nil {
		return fmt.Errorf("failed to create bilingual SRT file: %w", err)
	}
	defer file.Close()

	for _, block := range blocks {
		// 写入序号
		_, err = file.WriteString(fmt.Sprintf("%d\n", block.Index))
		if err != nil {
			return err
		}

		// 写入时间戳
		_, err = file.WriteString(block.Timestamp + "\n")
		if err != nil {
			return err
		}

		// 根据配置决定显示顺序
		var textContent strings.Builder
		if targetLanguageFirst {
			// 目标语言在上
			if block.TargetLanguageSentence != "" {
				textContent.WriteString(block.TargetLanguageSentence)
				if block.OriginLanguageSentence != "" {
					textContent.WriteString("\n")
					textContent.WriteString(block.OriginLanguageSentence)
				}
			} else if block.OriginLanguageSentence != "" {
				textContent.WriteString(block.OriginLanguageSentence)
			}
		} else {
			// 原语言在上（默认）
			if block.OriginLanguageSentence != "" {
				textContent.WriteString(block.OriginLanguageSentence)
				if block.TargetLanguageSentence != "" {
					textContent.WriteString("\n")
					textContent.WriteString(block.TargetLanguageSentence)
				}
			} else if block.TargetLanguageSentence != "" {
				textContent.WriteString(block.TargetLanguageSentence)
			}
		}

		if textContent.Len() > 0 {
			_, err = file.WriteString(textContent.String() + "\n\n")
			if err != nil {
				return err
			}
		}
	}

	log.GetLogger().Info("Bilingual SRT file written successfully",
		zap.String("文件", srtFile),
		zap.Int("块数", len(blocks)),
		zap.Bool("目标语言在上", targetLanguageFirst))

	return nil
}

// generateTextFiles 生成纯文本文件
func (s *YouTubeSubtitleService) generateTextFiles(blocks []*util.SrtBlock, originFile, targetFile, targetLanguage string) error {
	log.GetLogger().Info("开始生成文本文件",
		zap.Int("blocks数量", len(blocks)),
		zap.String("目标语言", targetLanguage),
		zap.String("原文文件", originFile),
		zap.String("译文文件", targetFile))

	// 生成原文文本文件
	originF, err := os.Create(originFile)
	if err != nil {
		return fmt.Errorf("failed to create origin text file: %w", err)
	}
	defer originF.Close()

	originLineCount := 0
	for _, block := range blocks {
		if block.OriginLanguageSentence != "" {
			content := block.OriginLanguageSentence + "\n"
			n, err := originF.WriteString(content)
			if err != nil {
				return err
			}
			originLineCount++
			if originLineCount <= 3 {
				log.GetLogger().Debug("写入原文",
					zap.Int("行号", originLineCount),
					zap.String("内容", block.OriginLanguageSentence),
					zap.Int("写入字节数", n))
			}
		}
	}
	log.GetLogger().Info("原文文件写入完成", zap.Int("总行数", originLineCount))

	// 生成译文文本文件
	targetF, err := os.Create(targetFile)
	if err != nil {
		return fmt.Errorf("failed to create target text file: %w", err)
	}
	defer targetF.Close()

	// 根据目标语言选择逗号
	comma := ","
	if targetLanguage == "zh" || targetLanguage == "zh-CN" || targetLanguage == "zh-TW" || targetLanguage == "ja" || targetLanguage == "ko" {
		comma = "，"
	}

	// 辅助函数：检查字符串结尾是否有标点符号
	hasPunctuation := func(s string) bool {
		if s == "" {
			return false
		}
		// 获取最后一个字符
		lastRune := []rune(s)
		if len(lastRune) == 0 {
			return false
		}
		last := lastRune[len(lastRune)-1]

		// 检查是否为标点符号（包括中英文标点）
		return (last >= 0x21 && last <= 0x2F) || // !"#$%&'()*+,-./
			(last >= 0x3A && last <= 0x40) || // :;<=>?@
			(last >= 0x5B && last <= 0x60) || // [\]^_`
			(last >= 0x7B && last <= 0x7E) || // {|}~
			(last >= 0x2000 && last <= 0x206F) || // 通用标点（包括省略号U+2026）
			(last >= 0x3000 && last <= 0x303F) || // CJK符号和标点
			(last >= 0xFF00 && last <= 0xFFEF) // 全角ASCII、全角标点
	}

	// 辅助函数：检查字符串结尾是否有结束标点（句号、问号、感叹号等）
	hasEndPunctuation := func(s string) bool {
		if s == "" {
			return false
		}
		lastRune := []rune(s)
		if len(lastRune) == 0 {
			return false
		}
		last := lastRune[len(lastRune)-1]

		// 中英文的句号、问号、感叹号、省略号
		return last == '。' || last == '！' || last == '？' ||
			last == '.' || last == '!' || last == '?' ||
			last == '…' || last == 0x2026 // 省略号 U+2026
	}

	// 对于中文/日文/韩文，将句子中间的空格替换为逗号
	shouldReplaceSpaces := targetLanguage == "zh" || targetLanguage == "zh-CN" || targetLanguage == "zh-TW" || targetLanguage == "ja" || targetLanguage == "ko"

	// 智能合并算法参数
	const (
		targetLineLength = 15 // 目标行长度（15字左右）
		minLineLength    = 8  // 最小行长度
		maxLineLength    = 22 // 最大行长度（严格控制，不能太长）
	)

	targetLineCount := 0
	var currentLine strings.Builder // 当前正在构建的行

	for _, block := range blocks {
		if block.TargetLanguageSentence != "" {
			sentence := block.TargetLanguageSentence

			// 如果是中文/日文/韩文，将句子中间的空格替换为逗号
			if shouldReplaceSpaces {
				sentence = strings.ReplaceAll(sentence, " ", comma)
			}

			currentText := currentLine.String()
			currentLen := len([]rune(currentText))
			sentenceLen := len([]rune(sentence))

			// 如果当前行为空，直接添加这个句子
			if currentLen == 0 {
				currentLine.WriteString(sentence)
			} else {
				// 判断是否应该合并
				currentHasEnd := hasEndPunctuation(currentText)
				sentenceHasEnd := hasEndPunctuation(sentence)

				// 计算合并后的潜在长度
				potentialLen := currentLen + sentenceLen
				if !currentHasEnd && !hasPunctuation(currentText) {
					potentialLen += 1 // 需要加逗号
				}

				// 关键规则：如果当前行有结束标点，只能和同样有结束标点的句子合并
				if currentHasEnd && !sentenceHasEnd {
					// 当前行有结束标点，但新句子没有，不合并，输出当前行
					targetF.WriteString(currentLine.String() + "\n")
					targetLineCount++
					currentLine.Reset()
					currentLine.WriteString(sentence)
				} else if currentHasEnd && currentLen >= targetLineLength {
					// 当前行有结束标点且已达到目标长度，输出当前行，不继续合并
					targetF.WriteString(currentLine.String() + "\n")
					targetLineCount++
					currentLine.Reset()
					currentLine.WriteString(sentence)
				} else if potentialLen > maxLineLength {
					// 合并后会超过最大长度，输出当前行，新句子开始新行
					if !hasPunctuation(currentText) {
						currentLine.WriteString(comma)
					}
					targetF.WriteString(currentLine.String() + "\n")
					targetLineCount++
					currentLine.Reset()
					currentLine.WriteString(sentence)
				} else {
					// 长度允许合并
					if hasEndPunctuation(currentText) {
						// 如果前面是结束标点，不加逗号，直接拼接
						currentLine.WriteString(sentence)
					} else if !hasPunctuation(currentText) {
						// 如果前面没有任何标点，添加逗号
						currentLine.WriteString(comma)
						currentLine.WriteString(sentence)
					} else {
						// 如果前面是其他标点（逗号等），直接拼接
						currentLine.WriteString(sentence)
					}
				}
			}

			// 检查当前行是否应该输出：
			currentText = currentLine.String()
			currentLen = len([]rune(currentText))

			// 输出条件：有结束标点 且 (长度达到目标 或 超过最大长度)
			if hasEndPunctuation(currentText) && currentLen >= targetLineLength {
				targetF.WriteString(currentLine.String() + "\n")
				targetLineCount++
				currentLine.Reset()
			} else if currentLen >= maxLineLength {
				// 超过最大长度，强制输出
				targetF.WriteString(currentLine.String() + "\n")
				targetLineCount++
				currentLine.Reset()
			}

		} else if block.OriginLanguageSentence != "" {
			// 如果没有翻译，使用原文（按原逻辑处理）
			if currentLine.Len() > 0 {
				targetF.WriteString(currentLine.String() + "\n")
				targetLineCount++
				currentLine.Reset()
			}
			targetF.WriteString(block.OriginLanguageSentence + "\n")
			targetLineCount++
		}
	}

	// 输出最后剩余的内容
	if currentLine.Len() > 0 {
		targetF.WriteString(currentLine.String() + "\n")
		targetLineCount++
	}

	log.GetLogger().Info("译文文件写入完成", zap.Int("总行数", targetLineCount))

	log.GetLogger().Info("Text files generated successfully",
		zap.String("原文文件", originFile),
		zap.String("译文文件", targetFile))

	return nil
}

// findVttWordsForText 根据文本内容在句子中找到对应的VttWord
func (s *YouTubeSubtitleService) findVttWordsForText(text string, sentences []Sentence) []VttWord {
	textWords := strings.Fields(strings.TrimSpace(text))
	if len(textWords) == 0 {
		return []VttWord{}
	}

	// 在所有句子中寻找匹配的单词序列
	for _, sentence := range sentences {
		if len(sentence.Words) < len(textWords) {
			continue
		}

		// 尝试在这个句子中找到匹配的单词序列
		for startIdx := 0; startIdx <= len(sentence.Words)-len(textWords); startIdx++ {
			match := true
			for i, expectedWord := range textWords {
				actualWord := strings.TrimSpace(sentence.Words[startIdx+i].Text)
				expectedClean := strings.Trim(expectedWord, ".,!?;:")
				actualClean := strings.Trim(actualWord, ".,!?;:")

				if !strings.EqualFold(expectedClean, actualClean) {
					match = false
					break
				}
			}

			if match {
				return sentence.Words[startIdx : startIdx+len(textWords)]
			}
		}
	}

	return []VttWord{}
}

// findVttWordsForSrtBlock 根据 SRT 块找到对应的 VTT 单词序列
func (s *YouTubeSubtitleService) findVttWordsForSrtBlock(
	srtBlock *util.SrtBlock,
	sentences []Sentence,
) []VttWord {
	if srtBlock.OriginLanguageSentence == "" {
		return []VttWord{}
	}

	// 清理文本
	originText := strings.TrimSpace(srtBlock.OriginLanguageSentence)
	originText = strings.Trim(originText, `"'`)
	expectedWords := strings.Fields(originText)

	if len(expectedWords) == 0 {
		return []VttWord{}
	}

	// 解析 SRT 块的时间戳范围
	srtStartTime, srtEndTime, err := s.parseSrtTimestamp(srtBlock.Timestamp)
	var useTimeFilter bool
	if err != nil {
		log.GetLogger().Debug("Failed to parse SRT timestamp, using text-only matching",
			zap.String("timestamp", srtBlock.Timestamp),
			zap.Error(err))
		useTimeFilter = false
	} else {
		useTimeFilter = true
	}

	// 在所有句子中查找匹配的单词序列
	for _, sentence := range sentences {
		if len(sentence.Words) < len(expectedWords) {
			continue
		}

		// 如果启用时间过滤，检查句子的时间范围是否与 SRT 块匹配
		if useTimeFilter && len(sentence.Words) > 0 {
			// 获取句子第一个单词的开始时间
			firstWordTime, err := s.parseVttTime(sentence.Words[0].Start)
			if err == nil {
				// 如果句子开始时间与 SRT 块开始时间相差超过 1 秒，跳过
				// 这样可以避免匹配到重复的文本
				timeDiff := firstWordTime - srtStartTime
				if timeDiff < -0.5 || timeDiff > 1.0 {
					continue
				}
			}
		}

		// 尝试匹配
		for i := 0; i <= len(sentence.Words)-len(expectedWords); i++ {
			match := true
			for j, expectedWord := range expectedWords {
				actualWord := strings.TrimSpace(sentence.Words[i+j].Text)
				expectedClean := strings.Trim(expectedWord, `".,!?;:'"`)
				actualClean := strings.Trim(actualWord, `".,!?;:'"`)

				if !strings.EqualFold(expectedClean, actualClean) {
					match = false
					break
				}
			}

			if match {
				// 如果启用时间过滤，再次验证匹配的单词时间范围
				if useTimeFilter {
					matchedWords := sentence.Words[i : i+len(expectedWords)]
					firstTime, err1 := s.parseVttTime(matchedWords[0].Start)
					lastTime, err2 := s.parseVttTime(matchedWords[len(matchedWords)-1].End)

					if err1 == nil && err2 == nil {
						// 检查匹配的单词时间范围是否与 SRT 块时间范围重叠
						// 允许一定的时间误差（0.5秒）
						if firstTime <= srtEndTime+0.5 && lastTime >= srtStartTime-0.5 {
							log.GetLogger().Debug("Found VTT words with time validation",
								zap.String("originText", originText),
								zap.Float64("srtStart", srtStartTime),
								zap.Float64("vttStart", firstTime))
							return matchedWords
						}
					}
				} else {
					// 没有时间过滤，直接返回匹配的单词
					return sentence.Words[i : i+len(expectedWords)]
				}
			}
		}
	}

	log.GetLogger().Debug("No VTT words found for SRT block",
		zap.String("originText", originText),
		zap.String("timestamp", srtBlock.Timestamp))
	return []VttWord{}
}

// parseSrtTimestamp 解析SRT时间戳格式 "HH:MM:SS,mmm --> HH:MM:SS,mmm"
func (s *YouTubeSubtitleService) parseSrtTimestamp(timestamp string) (float64, float64, error) {
	parts := strings.Split(timestamp, " --> ")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid SRT timestamp format: %s", timestamp)
	}

	startTime, err := s.parseSrtTime(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("failed to parse start time: %w", err)
	}

	endTime, err := s.parseSrtTime(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("failed to parse end time: %w", err)
	}

	return startTime, endTime, nil
}

// parseSrtTime 解析单个SRT时间格式 "HH:MM:SS,mmm"
func (s *YouTubeSubtitleService) parseSrtTime(timeStr string) (float64, error) {
	// SRT格式: HH:MM:SS,mmm
	timeStr = strings.Replace(timeStr, ",", ".", 1) // 转换为VTT格式
	return s.parseVttTime(timeStr)
}

// convertToSrtTimestamp 将VTT时间戳格式转换为SRT时间戳格式
func (s *YouTubeSubtitleService) convertToSrtTimestamp(startTime, endTime string) (string, error) {
	// VTT格式: HH:MM:SS.mmm
	// SRT格式: HH:MM:SS,mmm
	srtStart := strings.Replace(startTime, ".", ",", 1)
	srtEnd := strings.Replace(endTime, ".", ",", 1)
	return fmt.Sprintf("%s --> %s", srtStart, srtEnd), nil
}

// splitBySmartRules 智能分句：当没有标点符号时，使用多种策略分句
func (s *YouTubeSubtitleService) splitBySmartRules(words []VttWord) []Sentence {
	if len(words) == 0 {
		return nil
	}

	log.GetLogger().Info("Using smart sentence splitting strategies",
		zap.Int("total_words", len(words)))

	// 对于超长序列（>200个单词），采用分层处理策略
	if len(words) > 200 {
		return s.splitLargeSequenceByLayers(words)
	}

	var sentences []Sentence

	// 策略1: 基于语义分割点（连词、介词等）
	semanticSplits := s.splitBySemanticBreaks(words)
	if len(semanticSplits) > 1 {
		log.GetLogger().Info("Split by semantic breaks", zap.Int("result_sentences", len(semanticSplits)))
		sentences = append(sentences, semanticSplits...)
	} else {
		// 策略2: 基于时间间隔分句
		timeSplits := s.splitByTimeGaps(words)
		if len(timeSplits) > 1 {
			log.GetLogger().Info("Split by time gaps", zap.Int("result_sentences", len(timeSplits)))
			sentences = append(sentences, timeSplits...)
		} else {
			// 策略3: 固定长度分句（最后的备用方案）
			lengthSplits := s.splitByFixedLength(words)
			log.GetLogger().Info("Split by fixed length", zap.Int("result_sentences", len(lengthSplits)))
			sentences = append(sentences, lengthSplits...)
		}
	}

	return sentences
}

// splitLargeSequenceByLayers 分层处理超长序列的智能分句
func (s *YouTubeSubtitleService) splitLargeSequenceByLayers(words []VttWord) []Sentence {
	log.GetLogger().Info("Using layered splitting for large sequence",
		zap.Int("total_words", len(words)))

	// 第一层：按时间间隔进行粗分割，使用更小的阈值
	const roughTimeGapThreshold = 0.5 // 500毫秒
	roughChunks := s.splitByTimeGapsWithThreshold(words, roughTimeGapThreshold)

	if len(roughChunks) <= 1 {
		// 如果时间分割无效，按固定大小分块
		roughChunks = s.splitIntoFixedChunks(words, 100) // 每块100个单词
	}

	log.GetLogger().Info("First layer time-based rough splitting",
		zap.Int("rough_chunks", len(roughChunks)))

	var finalSentences []Sentence

	// 第二层：对每个时间块应用语义分割
	for i, chunk := range roughChunks {
		log.GetLogger().Debug("Processing chunk", zap.Int("chunk_index", i),
			zap.Int("chunk_words", len(chunk.Words)))

		// 对每个块使用常规智能分句
		chunkSentences := s.applySplittingStrategies(chunk.Words)
		finalSentences = append(finalSentences, chunkSentences...)
	}

	log.GetLogger().Info("Layered splitting completed",
		zap.Int("original_words", len(words)),
		zap.Int("final_sentences", len(finalSentences)))

	return finalSentences
}

// splitByTimeGapsWithThreshold 使用指定阈值按时间间隔分句
func (s *YouTubeSubtitleService) splitByTimeGapsWithThreshold(words []VttWord, thresholdSeconds float64) []Sentence {
	if len(words) <= 3 {
		return []Sentence{s.createSentenceFromWords(words)}
	}

	var sentences []Sentence
	var currentWords []VttWord

	for i, word := range words {
		currentWords = append(currentWords, word)

		// 检查与下一个词的时间间隔
		if i < len(words)-1 {
			currentEnd, err := s.parseVttTime(word.End)
			if err != nil {
				continue
			}
			nextStart, err := s.parseVttTime(words[i+1].Start)
			if err != nil {
				continue
			}

			timeGap := nextStart - currentEnd

			// 如果时间间隔较大且当前句子有足够长度，分句
			if timeGap >= thresholdSeconds && len(currentWords) >= 3 {
				sentence := s.createSentenceFromWords(currentWords)
				sentences = append(sentences, sentence)
				currentWords = []VttWord{} // 重置
			}
		}
	}

	// 处理剩余的单词
	if len(currentWords) > 0 {
		sentence := s.createSentenceFromWords(currentWords)
		sentences = append(sentences, sentence)
	}

	// 如果没有找到有效分割点，按固定大小分块
	if len(sentences) <= 1 {
		return s.splitIntoFixedChunks(words, 50) // 每块50个单词
	}

	return sentences
}

// splitIntoFixedChunks 按固定单词数量分块
func (s *YouTubeSubtitleService) splitIntoFixedChunks(words []VttWord, chunkSize int) []Sentence {
	var chunks []Sentence

	for i := 0; i < len(words); i += chunkSize {
		end := i + chunkSize
		if end > len(words) {
			end = len(words)
		}

		chunk := s.createSentenceFromWords(words[i:end])
		chunks = append(chunks, chunk)
	}

	return chunks
}

// applySplittingStrategies 对单个块应用分句策略
func (s *YouTubeSubtitleService) applySplittingStrategies(words []VttWord) []Sentence {
	if len(words) == 0 {
		return nil
	}

	// 策略1: 基于语义分割点
	semanticSplits := s.splitBySemanticBreaks(words)
	if len(semanticSplits) > 1 && !s.hasVeryShortSentences(semanticSplits) {
		return semanticSplits
	}

	// 策略2: 基于时间间隔
	timeSplits := s.splitByTimeGaps(words)
	if len(timeSplits) > 1 && !s.hasVeryShortSentences(timeSplits) {
		return timeSplits
	}

	// 策略3: 固定长度分句（最后的备用方案）
	return s.splitByFixedLength(words)
}

// splitBySimpleSemanticBreaks 简化的语义分割（更快速，适合大量单词）
func (s *YouTubeSubtitleService) splitBySimpleSemanticBreaks(words []VttWord) []Sentence {
	if len(words) <= 5 {
		return []Sentence{s.createSentenceFromWords(words)}
	}

	// 语义分割关键词
	breakWords := map[string]bool{
		// 连词
		"and": true, "but": true, "or": true, "so": true,
		// 从句标识
		"that": true, "which": true, "what": true, "who": true, "when": true,
		"where": true, "why": true, "how": true, "whose": true, "whom": true,
		// 原因和条件
		"because": true, "since": true, "if": true, "unless": true, "although": true,
		"though": true, "while": true, "whereas": true,
		// 时间
		"before": true, "after": true, "until": true, "whenever": true,
		// 转折和递进
		"however": true, "therefore": true, "moreover": true, "furthermore": true,
		"meanwhile": true, "besides": true, "nonetheless": true,
	}

	var sentences []Sentence
	var currentWords []VttWord
	var currentChars int // 跟踪当前累积的字符数

	for i, word := range words {
		wordText := word.Text
		wordLen := len(wordText) + 1 // +1 for space
		currentWords = append(currentWords, word)
		currentChars += wordLen

		wordLower := strings.ToLower(strings.TrimSpace(wordText))

		// 判断是否应该分割
		shouldBreak := false

		// 条件1：遇到关键词且累积字符数接近限制（留10字符余量）
		if breakWords[wordLower] && currentChars >= config.Conf.App.MaxSentenceLength-10 {
			shouldBreak = true
		}

		// 条件2：强制分割 - 字符数超过限制且遇到关键词
		if !shouldBreak && breakWords[wordLower] && currentChars >= config.Conf.App.MaxSentenceLength {
			shouldBreak = true
		}

		// 条件3：超强制分割 - 字符数远超限制，立即分割
		if !shouldBreak && currentChars >= config.Conf.App.MaxSentenceLength+15 {
			shouldBreak = true
		}

		// 执行分割
		if shouldBreak && i < len(words)-1 && len(currentWords) >= 3 {
			// 在关键词之前分割
			if breakWords[wordLower] && len(currentWords) > 1 {
				sentence := s.createSentenceFromWords(currentWords[:len(currentWords)-1])
				sentences = append(sentences, sentence)
				currentWords = []VttWord{word} // 关键词作为下一句开头
				currentChars = wordLen
			} else {
				sentence := s.createSentenceFromWords(currentWords)
				sentences = append(sentences, sentence)
				currentWords = nil
				currentChars = 0
			}
		}
	}

	// 处理剩余单词
	if len(currentWords) > 0 {
		if len(sentences) > 0 && len(currentWords) < 3 {
			// 剩余单词太少，合并到最后一句
			lastIdx := len(sentences) - 1
			allWords := append(sentences[lastIdx].Words, currentWords...)
			sentences[lastIdx] = s.createSentenceFromWords(allWords)
		} else {
			sentences = append(sentences, s.createSentenceFromWords(currentWords))
		}
	}

	log.GetLogger().Info("简单语义分割完成",
		zap.Int("输入单词数", len(words)),
		zap.Int("输出句子数", len(sentences)))

	// 如果没有成功分割，使用固定长度分割
	if len(sentences) <= 1 {
		log.GetLogger().Warn("语义分割失败，使用固定长度分割",
			zap.Int("单词数", len(words)))
		return s.splitByFixedLength(words)
	}

	return sentences
}

// splitBySemanticBreaks 基于语义分割点分句（连词、过渡词等）
func (s *YouTubeSubtitleService) splitBySemanticBreaks(words []VttWord) []Sentence {
	if len(words) <= 5 {
		return []Sentence{s.createSentenceFromWords(words)}
	}

	// 优化后的语义分割标志词 - 更注重句子完整性
	strongBreakWords := map[string]bool{
		// 强分割词：通常标志新句子或独立从句的开始
		"however": true, "therefore": true, "moreover": true, "furthermore": true,
		"nonetheless": true, "meanwhile": true, "afterwards": true, "consequently": true,
		"additionally": true, "besides": true, "similarly": true, "likewise": true,
		"nevertheless": true, "subsequently": true, "alternatively": true,
		// 时间和顺序标志词
		"first": true, "second": true, "third": true, "finally": true, "lastly": true,
		"next": true, "then": true, "now": true, "later": true, "previously": true,
		// 条件和对比词
		"although": true, "though": true, "whereas": true, "despite": true,
	}

	// 弱分割词：只在特定上下文中分割，需要更多条件
	contextualBreakWords := map[string]bool{
		"and": true, "but": true, "or": true, "so": true,
		"because": true, "since": true, "when": true, "while": true,
		"if": true, "unless": true, "until": true, "before": true,
		"after": true, "during": true,
	}

	// 关系代词需要更严格的判断（通常不应该分割）
	relativePronouns := map[string]bool{
		"who": true, "whom": true, "whose": true, "which": true, "that": true,
	}

	var sentences []Sentence
	var currentWords []VttWord
	minSentenceLength := 5 // 最小句子长度（单词数）

	for i, word := range words {
		currentWords = append(currentWords, word)
		wordLower := strings.ToLower(strings.TrimSpace(word.Text))

		shouldBreak := false

		// 检查强分割词
		if strongBreakWords[wordLower] && len(currentWords) >= minSentenceLength {
			shouldBreak = true
		}

		// 检查弱分割词，需要额外条件
		if !shouldBreak && contextualBreakWords[wordLower] && len(currentWords) >= minSentenceLength {
			// 额外条件：确保前面有完整的主谓结构
			if s.hasCompletePhrase(currentWords[:len(currentWords)-1]) {
				// 检查分割后的长度是否满足要求
				currentText := s.createSentenceFromWords(currentWords[:len(currentWords)-1]).Text
				currentChars := util.CountEffectiveChars(currentText)

				// 计算剩余部分的长度
				remainingWords := words[i:]
				remainingText := s.createSentenceFromWords(remainingWords).Text
				remainingChars := util.CountEffectiveChars(remainingText)

				// 只有当前部分和剩余部分都不超过限制时才分割
				if currentChars <= config.Conf.App.MaxSentenceLength &&
					remainingChars <= config.Conf.App.MaxSentenceLength {
					shouldBreak = true
				}
			}
		}

		// 关系代词（who, which等）只在句子过长且有完整从句时才分割
		if !shouldBreak && relativePronouns[wordLower] && len(currentWords) >= minSentenceLength*2 {
			// 只有在当前部分已经很长的情况下才考虑在关系代词处分割
			currentText := s.createSentenceFromWords(currentWords[:len(currentWords)-1]).Text
			currentChars := util.CountEffectiveChars(currentText)

			if currentChars > config.Conf.App.MaxSentenceLength {
				// 确保前面有完整的主谓结构
				if s.hasCompletePhrase(currentWords[:len(currentWords)-1]) {
					shouldBreak = true
				}
			}
		}

		// 如果满足分割条件且不是最后一个词
		if shouldBreak && i < len(words)-1 {
			// 创建句子，但不包含分割词（分割词放到下一句开头）
			if len(currentWords) > 1 {
				sentence := s.createSentenceFromWords(currentWords[:len(currentWords)-1])
				sentences = append(sentences, sentence)
				currentWords = []VttWord{word} // 分割词作为下一句的开头
			}
		}
	}

	// 处理剩余的单词
	if len(currentWords) > 0 {
		sentence := s.createSentenceFromWords(currentWords)
		sentences = append(sentences, sentence)
	}

	// 如果分割结果不理想，返回空
	if len(sentences) <= 1 || s.hasVeryShortSentences(sentences) {
		return []Sentence{}
	}

	return sentences
}

// hasCompletePhrase 检查词组是否包含完整的主谓结构或意义单元
func (s *YouTubeSubtitleService) hasCompletePhrase(words []VttWord) bool {
	if len(words) < 3 {
		return false
	}

	text := strings.ToLower(strings.Join(s.extractTextsFromWords(words), " "))

	// 检查是否包含动词指示词（简单启发式）
	verbIndicators := []string{
		"am", "is", "are", "was", "were", "be", "been", "being",
		"have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
		"can", "may", "might", "must", "shall",
		"go", "goes", "went", "come", "comes", "came", "get", "gets", "got",
		"make", "makes", "made", "take", "takes", "took", "give", "gives", "gave",
		"see", "sees", "saw", "know", "knows", "knew", "think", "thinks", "thought",
		"say", "says", "said", "tell", "tells", "told", "want", "wants", "wanted",
		"need", "needs", "needed", "like", "likes", "liked", "work", "works", "worked",
	}

	for _, verb := range verbIndicators {
		if strings.Contains(text, " "+verb+" ") || strings.HasPrefix(text, verb+" ") {
			return true
		}
	}

	return false
}

// hasVeryShortSentences 检查是否有过短的句子
func (s *YouTubeSubtitleService) hasVeryShortSentences(sentences []Sentence) bool {
	for _, sentence := range sentences {
		words := strings.Fields(sentence.Text)
		if len(words) < 3 {
			return true
		}
	}
	return false
}

// extractTextsFromWords 从VttWord数组中提取文本数组
func (s *YouTubeSubtitleService) extractTextsFromWords(words []VttWord) []string {
	texts := make([]string, len(words))
	for i, word := range words {
		texts[i] = word.Text
	}
	return texts
}

// splitByTimeGaps 基于时间间隔分句（检测较长的停顿）
func (s *YouTubeSubtitleService) splitByTimeGaps(words []VttWord) []Sentence {
	if len(words) <= 3 {
		return []Sentence{s.createSentenceFromWords(words)}
	}

	var sentences []Sentence
	var currentWords []VttWord

	// 设置时间间隔阈值（秒）
	const timeGapThreshold = 0.8 // 800毫秒

	for i, word := range words {
		currentWords = append(currentWords, word)

		// 检查与下一个词的时间间隔
		if i < len(words)-1 {
			currentEnd, err := s.parseVttTime(word.End)
			if err != nil {
				continue
			}
			nextStart, err := s.parseVttTime(words[i+1].Start)
			if err != nil {
				continue
			}

			timeGap := nextStart - currentEnd

			// 如果时间间隔较大且当前句子有足够长度，分句
			if timeGap >= timeGapThreshold && len(currentWords) >= 3 {
				sentence := s.createSentenceFromWords(currentWords)
				sentences = append(sentences, sentence)
				currentWords = []VttWord{} // 重置
			}
		}
	}

	// 处理剩余的单词
	if len(currentWords) > 0 {
		sentence := s.createSentenceFromWords(currentWords)
		sentences = append(sentences, sentence)
	}

	// 如果没有找到有效分割点，返回空
	if len(sentences) <= 1 {
		return []Sentence{}
	}

	return sentences
}

// splitByFixedLength 按固定长度分句（备用方案），优化以避免在关键词中间分割
func (s *YouTubeSubtitleService) splitByFixedLength(words []VttWord) []Sentence {
	if len(words) == 0 {
		return nil
	}

	var sentences []Sentence
	var currentWords []VttWord

	// 优化固定长度策略：目标长度10-15个单词，但避免在不合适的地方分割
	const targetLength = 12
	const minLength = 8
	const maxLength = 18

	// 不适合作为句子结尾的词
	badEndWords := map[string]bool{
		"a": true, "an": true, "the": true,
		"of": true, "in": true, "on": true, "at": true, "to": true, "for": true,
		"with": true, "by": true, "from": true, "about": true,
		"and": true, "but": true, "or": true,
		"is": true, "am": true, "are": true, "was": true, "were": true,
		"have": true, "has": true, "had": true,
		"will": true, "would": true, "could": true, "should": true,
		"my": true, "your": true, "his": true, "her": true, "its": true, "our": true, "their": true,
		"this": true, "that": true, "these": true, "those": true,
		// 新增：常见的不适合独立成句的词
		"up": true, "down": true, "out": true, "off": true, "away": true, "back": true,
		"into": true, "onto": true, "upon": true, "within": true, "without": true,
		"through": true, "across": true, "under": true, "over": true,
		"before": true, "after": true, "during": true, "since": true, "until": true,
		"can": true, "may": true, "might": true, "must": true, "shall": true,
		"not": true, "never": true, "always": true, "often": true, "sometimes": true,
		"very": true, "quite": true, "really": true, "just": true, "only": true,
		"more": true, "most": true, "less": true, "least": true, "much": true,
		"too": true, "so": true, "such": true, "even": true, "still": true,
	}

	// 常见的不应该被分割的短语和固定搭配
	commonPhrases := [][]string{
		{"fall", "apart"}, {"break", "down"}, {"give", "up"}, {"take", "off"},
		{"put", "on"}, {"turn", "off"}, {"turn", "on"}, {"look", "up"},
		{"look", "down"}, {"come", "back"}, {"go", "away"}, {"walk", "away"},
		{"run", "away"}, {"get", "up"}, {"sit", "down"}, {"stand", "up"},
		{"wake", "up"}, {"grow", "up"}, {"pick", "up"}, {"drop", "off"},
		{"find", "out"}, {"figure", "out"}, {"work", "out"}, {"sort", "out"},
		{"carry", "on"}, {"move", "on"}, {"hold", "on"}, {"hang", "on"},
		{"right", "now"}, {"right", "away"}, {"right", "here"}, {"right", "there"},
		{"all", "over"}, {"all", "around"}, {"all", "along"}, {"all", "together"},
		{"once", "again"}, {"over", "again"}, {"time", "after", "time"},
		{"day", "after", "day"}, {"year", "after", "year"}, {"forever"},
		{"for", "good"}, {"for", "sure"}, {"for", "real"}, {"for", "now"},
		{"at", "all"}, {"at", "once"}, {"at", "last"}, {"at", "first"},
		{"in", "fact"}, {"in", "general"}, {"in", "particular"}, {"in", "short"},
		{"on", "purpose"}, {"on", "time"}, {"by", "chance"}, {"by", "accident"},
		{"lose", "touch"}, {"get", "lost"}, {"make", "sense"}, {"take", "care"},
	}

	for i, word := range words {
		currentWords = append(currentWords, word)
		currentLength := len(currentWords)

		// 判断是否应该在此处分割
		shouldSplit := false

		if currentLength >= maxLength {
			// 超过最大长度，必须分割
			shouldSplit = true
		} else if currentLength >= targetLength {
			// 达到目标长度，寻找合适的分割点
			wordText := strings.ToLower(strings.TrimSpace(word.Text))

			// 检查是否为不良结尾词
			if !badEndWords[wordText] {
				// 进一步检查是否会分割常见短语
				if !s.wouldSplitCommonPhrase(currentWords, words, i, commonPhrases) {
					shouldSplit = true
				}
			}
		} else if i == len(words)-1 {
			// 最后一个词，必须结束
			shouldSplit = true
		}

		// 执行分割
		if shouldSplit && currentLength >= minLength {
			sentence := s.createSentenceFromWords(currentWords)
			sentences = append(sentences, sentence)
			currentWords = []VttWord{} // 重置
		} else if shouldSplit && currentLength < minLength && i == len(words)-1 {
			// 如果是最后一句但长度不够，仍然创建句子
			sentence := s.createSentenceFromWords(currentWords)
			sentences = append(sentences, sentence)
			currentWords = []VttWord{} // 重置
		}
	}

	// 处理可能剩余的单词（虽然理论上不应该有）
	if len(currentWords) > 0 {
		if len(sentences) > 0 {
			// 如果已经有句子，将剩余词合并到最后一句
			lastIdx := len(sentences) - 1
			lastSentence := &sentences[lastIdx]

			// 重新创建包含所有词的句子
			allWords := s.extractWordsFromSentence(*lastSentence)
			allWords = append(allWords, currentWords...)
			*lastSentence = s.createSentenceFromWords(allWords)
		} else {
			// 如果没有句子，创建一个新句子
			sentence := s.createSentenceFromWords(currentWords)
			sentences = append(sentences, sentence)
		}
	}

	// 后处理：合并过短的句子
	sentences = s.mergeVeryShortSentences(sentences)

	log.GetLogger().Info("Optimized fixed length splitting completed",
		zap.Int("original_words", len(words)),
		zap.Int("created_sentences", len(sentences)),
		zap.Int("target_length", targetLength))

	return sentences
}

// extractWordsFromSentence 从句子中提取VttWord（用于合并句子）
func (s *YouTubeSubtitleService) extractWordsFromSentence(sentence Sentence) []VttWord {
	// 直接返回句子中已有的单词数据
	return sentence.Words
}

// wouldSplitCommonPhrase 检查在当前位置分割是否会分开常见短语
func (s *YouTubeSubtitleService) wouldSplitCommonPhrase(currentWords, allWords []VttWord, currentIndex int, commonPhrases [][]string) bool {
	if len(currentWords) == 0 || currentIndex >= len(allWords)-1 {
		return false
	}

	// 获取当前句子末尾的几个词
	endWords := make([]string, 0, 3)
	for i := max(0, len(currentWords)-3); i < len(currentWords); i++ {
		endWords = append(endWords, strings.ToLower(strings.TrimSpace(currentWords[i].Text)))
	}

	// 获取接下来的几个词
	nextWords := make([]string, 0, 3)
	for i := currentIndex + 1; i < min(currentIndex+4, len(allWords)); i++ {
		nextWords = append(nextWords, strings.ToLower(strings.TrimSpace(allWords[i].Text)))
	}

	// 检查是否会分割常见短语
	for _, phrase := range commonPhrases {
		if s.wouldSplitPhrase(endWords, nextWords, phrase) {
			return true
		}
	}

	return false
}

// wouldSplitPhrase 检查是否会分割特定短语
func (s *YouTubeSubtitleService) wouldSplitPhrase(endWords, nextWords, phrase []string) bool {
	// 构建完整的词序列
	allWords := append(endWords, nextWords...)

	// 在词序列中查找短语
	for i := 0; i <= len(allWords)-len(phrase); i++ {
		match := true
		for j, phraseWord := range phrase {
			if i+j >= len(allWords) || allWords[i+j] != phraseWord {
				match = false
				break
			}
		}

		if match {
			// 找到短语，检查分割点是否在短语中间
			splitPoint := len(endWords)
			phraseStart := i
			phraseEnd := i + len(phrase)

			if splitPoint > phraseStart && splitPoint < phraseEnd {
				return true // 会分割这个短语
			}
		}
	}

	return false
}

// writeSentencesToDebugFile 将句子信息写入调试文件
func (s *YouTubeSubtitleService) writeSentencesToDebugFile(sentences []Sentence, debugFile string) error {
	file, err := os.Create(debugFile)
	if err != nil {
		return fmt.Errorf("failed to create debug file: %w", err)
	}
	defer file.Close()

	for i, sentence := range sentences {
		_, err := file.WriteString(fmt.Sprintf("Sentence %d:\n", i+1))
		if err != nil {
			return err
		}

		_, err = file.WriteString(fmt.Sprintf("Text: %s\n", sentence.Text))
		if err != nil {
			return err
		}

		_, err = file.WriteString(fmt.Sprintf("Start: %s, End: %s\n", sentence.StartTime, sentence.EndTime))
		if err != nil {
			return err
		}

		_, err = file.WriteString(fmt.Sprintf("Word count: %d\n\n", len(sentence.Words)))
		if err != nil {
			return err
		}
	}

	return nil
}

// mergeVeryShortSentences 合并过短的句子到前一句
func (s *YouTubeSubtitleService) mergeVeryShortSentences(sentences []Sentence) []Sentence {
	if len(sentences) <= 1 {
		return sentences
	}

	var result []Sentence
	const veryShortThreshold = 3 // 少于3个单词认为是过短

	for _, sentence := range sentences {
		words := strings.Fields(sentence.Text)

		if len(words) <= veryShortThreshold && len(result) > 0 {
			// 当前句子过短，合并到前一句
			lastIdx := len(result) - 1
			prevSentence := &result[lastIdx]

			// 合并单词
			mergedWords := append(prevSentence.Words, sentence.Words...)

			// 重新创建句子
			*prevSentence = s.createSentenceFromWords(mergedWords)
		} else {
			// 句子长度正常，直接添加
			result = append(result, sentence)
		}
	}

	return result
}

// min 返回两个int中的较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// max 返回两个int中的较大值
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// DetectVttFormat 检测VTT文件格式类型，返回是否包含单词级时间戳
// 返回值: true=word-level (有行内时间戳), false=block-level (仅块级时间戳)
// 导出为公开方法以便测试
func (s *YouTubeSubtitleService) DetectVttFormat(vttFile string) (bool, error) {
	file, err := os.Open(vttFile)
	if err != nil {
		return false, fmt.Errorf("无法打开VTT文件: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	// 匹配单词级行内时间戳的正则表达式
	wordTimeRegex := regexp.MustCompile(`<(\d{2}:\d{2}:\d{2}\.\d{3})>`)

	lineCount := 0
	maxLinesToCheck := 100 // 检查前100行即可判断格式

	for scanner.Scan() && lineCount < maxLinesToCheck {
		line := scanner.Text()
		lineCount++

		// 如果发现行内时间戳，说明是word-level格式
		if wordTimeRegex.MatchString(line) {
			log.GetLogger().Info("检测到word-level VTT格式（包含单词级时间戳）",
				zap.String("file", vttFile))
			return true, nil
		}
	}

	if err := scanner.Err(); err != nil {
		return false, fmt.Errorf("读取VTT文件错误: %w", err)
	}

	log.GetLogger().Info("检测到block-level VTT格式（仅块级时间戳）",
		zap.String("file", vttFile))
	return false, nil
}

// ProcessBlockLevelVtt 处理块级时间戳的VTT文件（无单词级时间戳）
// 流程: VTT → SRT → 批量翻译 → 双语字幕
func (s *YouTubeSubtitleService) ProcessBlockLevelVtt(ctx context.Context, req *YoutubeSubtitleReq) (string, error) {
	log.GetLogger().Info("开始处理block-level VTT字幕",
		zap.String("taskId", req.TaskId),
		zap.String("vttFile", req.VttFile))

	// 更新进度：开始处理
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(20)
	}

	// 1. 转换VTT到临时SRT文件
	tempSrtFile := filepath.Join(req.TaskBasePath, "temp_block_level.srt")
	err := util.ConvertBlockVttToSrt(req.VttFile, tempSrtFile)
	if err != nil {
		return "", fmt.Errorf("VTT转SRT失败: %w", err)
	}
	log.GetLogger().Info("VTT转SRT完成", zap.String("srtFile", tempSrtFile))

	// 更新进度：VTT转换完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(30)
	}

	// 2. 生成原文SRT文件（origin_language_srt.srt）
	originSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskOriginLanguageSrtFileName)
	// 直接复制临时SRT作为原文字幕
	originData, err := os.ReadFile(tempSrtFile)
	if err != nil {
		return "", fmt.Errorf("读取临时SRT失败: %w", err)
	}
	err = os.WriteFile(originSrtFile, originData, 0644)
	if err != nil {
		return "", fmt.Errorf("写入原文SRT失败: %w", err)
	}
	log.GetLogger().Info("生成原文SRT完成", zap.String("originSrtFile", originSrtFile))

	// 更新进度：原文SRT生成完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(40)
	}

	// 3. 解析SRT文件
	srtBlocks, err := util.ParseSrtFile(tempSrtFile)
	if err != nil {
		return "", fmt.Errorf("解析SRT文件失败: %w", err)
	}
	log.GetLogger().Info("解析SRT完成", zap.Int("字幕块数", len(srtBlocks)))

	// 4. 批量翻译（40%-90%的进度在BatchTranslateSrtBlocks内部更新）
	err = s.translator.BatchTranslateSrtBlocks(srtBlocks, req.OriginLanguage, req.TargetLanguage, req.TaskPtr)
	if err != nil {
		return "", fmt.Errorf("批量翻译失败: %w", err)
	}
	log.GetLogger().Info("批量翻译完成", zap.Int("翻译块数", len(srtBlocks)))

	// 更新进度：翻译完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(90)
	}

	// 5. 生成目标语言SRT文件（target_language_srt.srt）
	targetSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskTargetLanguageSrtFileName)
	err = s.writeTargetLanguageSrtFile(srtBlocks, targetSrtFile)
	if err != nil {
		return "", fmt.Errorf("写入目标语言SRT失败: %w", err)
	}
	log.GetLogger().Info("生成目标语言SRT完成", zap.String("targetSrtFile", targetSrtFile))

	// 更新进度：目标语言SRT生成完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(95)
	}

	// 6. 生成双语字幕文件（bilingual_srt.srt）
	bilingualSrtFile := filepath.Join(req.TaskBasePath, types.SubtitleTaskBilingualSrtFileName)
	err = s.writeSrtBlocksToFile(srtBlocks, bilingualSrtFile)
	if err != nil {
		return "", fmt.Errorf("写入双语字幕失败: %w", err)
	}
	log.GetLogger().Info("生成双语字幕完成", zap.String("bilingualSrtFile", bilingualSrtFile))

	// 更新进度：完成
	if req.TaskPtr != nil {
		req.TaskPtr.SetProgress(100)
	}

	log.GetLogger().Info("block-level VTT处理完成",
		zap.String("taskId", req.TaskId),
		zap.String("输出文件", bilingualSrtFile))

	// 清理临时文件
	os.Remove(tempSrtFile)

	return bilingualSrtFile, nil
}

// groupWordsByCharLength 按字符长度将 VTT 单词分组
// maxChars: 每组最大字符数（包含单词间的空格）
func (s *YouTubeSubtitleService) groupWordsByCharLength(words []VttWord, maxChars int) [][]VttWord {
	if len(words) == 0 {
		return nil
	}

	var groups [][]VttWord
	var currentGroup []VttWord
	currentLength := 0

	for _, word := range words {
		wordLen := len(word.Text)

		// 计算加上这个单词后的总长度（包含空格）
		newLength := currentLength
		if len(currentGroup) > 0 {
			newLength += 1 // 空格
		}
		newLength += wordLen

		// 如果超过上限，且当前组不为空，则开始新组
		if newLength > maxChars && len(currentGroup) > 0 {
			groups = append(groups, currentGroup)
			currentGroup = []VttWord{word}
			currentLength = wordLen
		} else {
			currentGroup = append(currentGroup, word)
			currentLength = newLength
		}
	}

	// 处理最后一组
	if len(currentGroup) > 0 {
		groups = append(groups, currentGroup)
	}

	return mergeShortTrailingWordGroup(groups)
}

func mergeShortTrailingWordGroup(groups [][]VttWord) [][]VttWord {
	if len(groups) < 2 {
		return groups
	}

	last := groups[len(groups)-1]
	if len(last) > 1 || wordGroupTextLength(last) > 12 {
		return groups
	}

	prevIndex := len(groups) - 2
	groups[prevIndex] = append(groups[prevIndex], last...)
	return groups[:len(groups)-1]
}

func wordGroupTextLength(words []VttWord) int {
	length := 0
	for i, word := range words {
		if i > 0 {
			length++
		}
		length += len([]rune(word.Text))
	}
	return length
}

// writeShortSubtitleFile 生成短字幕文件（中文完整 + 英文拆分）
// 适用于竖屏视频：中文保持完整便于理解，英文按字符长度拆分避免一行太长
func (s *YouTubeSubtitleService) writeShortSubtitleFile(
	srtBlocks []*util.SrtBlock,
	sentences []Sentence,
	shortSrtFile string,
	targetLanguageFirst bool,
) error {
	file, err := os.Create(shortSrtFile)
	if err != nil {
		return fmt.Errorf("failed to create short subtitle file: %w", err)
	}
	defer file.Close()

	blockIndex := 1
	maxChars := config.Conf.App.ShortSubtitleMaxChars
	if maxChars <= 0 {
		maxChars = 20 // 默认值
	}

	log.GetLogger().Info("开始生成短字幕文件",
		zap.String("file", shortSrtFile),
		zap.Int("maxChars", maxChars),
		zap.Int("srtBlocksCount", len(srtBlocks)))

	for _, srtBlock := range srtBlocks {
		// 1. 写入完整的中文翻译
		if srtBlock.TargetLanguageSentence != "" {
			_, err = file.WriteString(fmt.Sprintf("%d\n", blockIndex))
			if err != nil {
				return err
			}
			_, err = file.WriteString(srtBlock.Timestamp + "\n")
			if err != nil {
				return err
			}
			_, err = file.WriteString(srtBlock.TargetLanguageSentence + "\n\n")
			if err != nil {
				return err
			}
			blockIndex++
		}

		// 2. 找到对应的 VTT 单词
		vttWords := s.findVttWordsForSrtBlock(srtBlock, sentences)
		if len(vttWords) == 0 {
			log.GetLogger().Warn("No VTT words found for SRT block, skipping English split",
				zap.String("originText", srtBlock.OriginLanguageSentence))
			continue
		}

		// 3. 按字符长度分组
		groups := s.groupWordsByCharLength(vttWords, maxChars)

		log.GetLogger().Debug("Split English into groups",
			zap.String("originText", srtBlock.OriginLanguageSentence),
			zap.Int("groupsCount", len(groups)))

		// 4. 为每个英文片段生成字幕块
		for _, group := range groups {
			startTime := group[0].Start
			endTime := group[len(group)-1].End

			// 拼接单词
			var words []string
			for _, word := range group {
				words = append(words, word.Text)
			}
			text := strings.Join(words, " ")

			// 转换时间戳格式
			timestamp, err := s.convertToSrtTimestamp(startTime, endTime)
			if err != nil {
				log.GetLogger().Warn("Failed to convert timestamp, using SRT block timestamp",
					zap.Error(err))
				timestamp = srtBlock.Timestamp
			}

			// 写入英文片段
			_, err = file.WriteString(fmt.Sprintf("%d\n", blockIndex))
			if err != nil {
				return err
			}
			_, err = file.WriteString(timestamp + "\n")
			if err != nil {
				return err
			}
			_, err = file.WriteString(text + "\n\n")
			if err != nil {
				return err
			}
			blockIndex++
		}
	}

	log.GetLogger().Info("Short subtitle file written successfully",
		zap.String("file", shortSrtFile),
		zap.Int("totalBlocks", blockIndex-1))

	return nil
}
