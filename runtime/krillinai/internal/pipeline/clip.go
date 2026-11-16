package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"krillin-ai/internal/storage"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ClipRequest struct {
	Input              string
	InputSRT           string
	Workdir            string
	TaskID             string
	OriginLang         string
	CaptionSource      CaptionSource
	DeferTranscription bool
	Count              int
	MinDurationSec     int
	MaxDurationSec     int
	ReportProgress     ProgressReporter
}

type ClipResult struct {
	SchemaVersion  int              `json:"schema_version"`
	CaptionSource  string           `json:"caption_source"`
	RequestedCount int              `json:"requested_count"`
	Clips          []ClipResultItem `json:"clips"`
}

type ClipResultItem struct {
	ID      string  `json:"id"`
	File    string  `json:"file"`
	StartMS int64   `json:"start_ms"`
	EndMS   int64   `json:"end_ms"`
	Score   float64 `json:"score"`
}

type ClipAnalyzer interface {
	AnalyzeClipWindow(context.Context, string) (string, error)
}

type clipRow struct {
	StartMS int64
	EndMS   int64
	Text    string
}

type clipCandidate struct {
	StartMS int64
	EndMS   int64
	Score   float64
}

type clipMedia struct {
	DurationMS int64
	HasAudio   bool
}

func (req ClipRequest) Validate() error {
	if strings.TrimSpace(req.Input) == "" || strings.TrimSpace(req.Workdir) == "" {
		return errors.New("clip requires --input and --workdir")
	}
	if req.Count < 1 || req.Count > 20 {
		return errors.New("clip count must be between 1 and 20")
	}
	if req.MinDurationSec < 15 || req.MaxDurationSec > 180 || req.MinDurationSec > req.MaxDurationSec {
		return errors.New("clip duration must be between 15 and 180 seconds, with minimum <= maximum")
	}
	if req.CaptionSource != "" && req.CaptionSource != CaptionSourceAny && req.CaptionSource != CaptionSourcePlatform && req.CaptionSource != CaptionSourceWhisper {
		return errors.New("clip caption source must be any, platform, or whisper")
	}
	if req.CaptionSource == CaptionSourcePlatform && !IsYouTubeInput(req.Input) && req.InputSRT == "" {
		return errors.New("platform captions are currently supported for YouTube only")
	}
	return nil
}

func RunClip(ctx context.Context, svc StageService, req ClipRequest) (Response, error) {
	if err := req.Validate(); err != nil {
		return failClip(req, ErrorKindUsage, "clip_invalid_request", err), err
	}
	if req.OriginLang == "" {
		req.OriginLang = "auto"
	}
	if req.CaptionSource == "" {
		req.CaptionSource = CaptionSourceAny
	}
	reportClip(req, "preparing_source", 1, "正在准备原视频和原文字幕")
	captionSource := req.CaptionSource
	if req.DeferTranscription && IsYouTubeInput(req.Input) && req.CaptionSource == CaptionSourceAny && req.InputSRT == "" {
		captionSource = CaptionSourcePlatform
	}
	subtitle, err := GenerateSubtitles(ctx, svc, SubtitleRequest{
		Input: req.Input, InputSRT: req.InputSRT, Workdir: req.Workdir,
		TaskID: req.TaskID, OriginLang: req.OriginLang,
		CaptionSource: captionSource, PrepareVideo: true, SourceOnly: true,
		ReportProgress: func(phase string, percent int, message string, counts ...ProgressCounts) {
			reportClip(req, phase, min(45, 1+percent*44/100), message, counts...)
		},
	})
	if err != nil {
		if captionSource == CaptionSourcePlatform && subtitle.Error != nil &&
			(subtitle.Error.Code == "platform_caption_failed" || subtitle.Error.Code == "platform_caption_invalid") {
			return failClip(req, ErrorKindDependency, "clip_transcription_required", err), err
		}
		return failClip(req, ErrorKindRetryable, "clip_subtitle_failed", err), err
	}
	video, srt := subtitle.Outputs.OriginVideo, subtitle.Outputs.OriginSRT
	if video == "" || srt == "" {
		err = errors.New("source video or original-language subtitles were not produced")
		return failClip(req, ErrorKindInternal, "clip_source_missing", err), err
	}
	media, err := probeClipMedia(ctx, video)
	if err != nil {
		return failClip(req, ErrorKindUsage, "clip_video_invalid", err), err
	}
	if media.DurationMS < int64(req.MinDurationSec)*1000 {
		err = errors.New("video is shorter than the minimum clip duration")
		return failClip(req, ErrorKindUsage, "clip_video_too_short", err), err
	}
	rows, err := readClipRows(srt)
	if err != nil {
		return failClip(req, ErrorKindUsage, "clip_subtitle_invalid", err), err
	}
	analyzer, ok := svc.(ClipAnalyzer)
	if !ok {
		err = errors.New("clip analyzer is unavailable")
		return failClip(req, ErrorKindDependency, "clip_analyzer_missing", err), err
	}
	reportClip(req, "analyzing_clips", 48, "正在查找完整片段")
	selected, err := analyzeClipRows(ctx, analyzer, rows, req, media.DurationMS)
	if err != nil {
		return failClip(req, ErrorKindRetryable, "clip_analysis_failed", err), err
	}
	if len(selected) == 0 {
		err = errors.New("no complete clips matched the requested duration")
		return failClip(req, ErrorKindUsage, "clip_no_candidates", err), err
	}
	clipDir := filepath.Join(req.Workdir, "clips")
	if err := os.MkdirAll(clipDir, 0755); err != nil {
		return failClip(req, ErrorKindInternal, "clip_output_failed", err), err
	}
	result := ClipResult{SchemaVersion: 1, CaptionSource: string(subtitle.CaptionSource), RequestedCount: req.Count, Clips: make([]ClipResultItem, 0, len(selected))}
	for index, candidate := range selected {
		if err := ctx.Err(); err != nil {
			return failClip(req, ErrorKindRetryable, "clip_canceled", err), err
		}
		name := fmt.Sprintf("clip-%02d.mp4", index+1)
		reportClip(req, "rendering_clips", 60+index*38/len(selected), fmt.Sprintf("正在生成片段 %d/%d", index+1, len(selected)), ProgressCounts{index, len(selected)})
		if err := renderClip(ctx, video, filepath.Join(clipDir, name), candidate, media.HasAudio); err != nil {
			return failClip(req, ErrorKindRetryable, "clip_render_failed", err), err
		}
		result.Clips = append(result.Clips, ClipResultItem{
			ID: fmt.Sprintf("clip-%02d", index+1), File: filepath.ToSlash(filepath.Join("clips", name)),
			StartMS: candidate.StartMS, EndMS: candidate.EndMS, Score: candidate.Score,
		})
	}
	indexPath := filepath.Join(req.Workdir, "clips.json")
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return failClip(req, ErrorKindInternal, "clip_output_failed", err), err
	}
	if err := os.WriteFile(indexPath+".tmp", append(data, '\n'), 0644); err != nil {
		return failClip(req, ErrorKindInternal, "clip_output_failed", err), err
	}
	if err := os.Rename(indexPath+".tmp", indexPath); err != nil {
		return failClip(req, ErrorKindInternal, "clip_output_failed", err), err
	}
	manifest, err := LoadManifest(req.Workdir)
	if err != nil {
		return failClip(req, ErrorKindInternal, "clip_manifest_failed", err), err
	}
	manifest.Outputs.ClipIndex = indexPath
	manifest.MarkStage(StageClip, true, "")
	if err := manifest.Save(); err != nil {
		return failClip(req, ErrorKindInternal, "clip_manifest_failed", err), err
	}
	reportClip(req, "completed", 100, fmt.Sprintf("已生成 %d 个视频切片", len(result.Clips)), ProgressCounts{len(result.Clips), len(result.Clips)})
	return Response{OK: true, Stage: StageClip, Workdir: req.Workdir, TaskID: req.TaskID,
		CaptionSource: subtitle.CaptionSource, Outputs: manifest.Outputs, Warnings: manifest.Warnings}, nil
}

func failClip(req ClipRequest, kind ErrorKind, code string, err error) Response {
	if strings.TrimSpace(req.Workdir) != "" {
		if manifest, loadErr := LoadManifest(req.Workdir); loadErr == nil {
			manifest.Outputs.ClipIndex = ""
			manifest.MarkStage(StageClip, false, err.Error())
			_ = manifest.Save()
		}
	}
	return Response{OK: false, Stage: StageClip, Workdir: req.Workdir, TaskID: req.TaskID,
		Error: &Error{Kind: kind, Code: code, Message: err.Error(), Retryable: kind == ErrorKindRetryable}}
}

func reportClip(req ClipRequest, phase string, percent int, message string, counts ...ProgressCounts) {
	if req.ReportProgress != nil {
		req.ReportProgress(phase, percent, message, counts...)
	}
}

func readClipRows(path string) ([]clipRow, error) {
	blocks, err := readSRTBlocks(path)
	if err != nil {
		return nil, err
	}
	rows := make([]clipRow, 0, len(blocks))
	for _, block := range blocks {
		start, end, err := parsePipelineSRTTimeline(block.Timestamp)
		if err != nil || end <= start {
			return nil, fmt.Errorf("invalid source subtitle timestamp: %s", block.Timestamp)
		}
		text := strings.TrimSpace(strings.Join(block.Lines, " "))
		if text == "" {
			continue
		}
		rows = append(rows, clipRow{StartMS: start, EndMS: end, Text: text})
	}
	if len(rows) == 0 {
		return nil, errors.New("source subtitles contain no speech")
	}
	return rows, nil
}

func probeClipMedia(ctx context.Context, path string) (clipMedia, error) {
	probe := storage.FfprobePath
	if probe == "" {
		probe = "ffprobe"
	}
	output, err := exec.CommandContext(ctx, probe, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path).Output()
	if err != nil {
		return clipMedia{}, fmt.Errorf("ffprobe failed: %w", err)
	}
	var result struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			CodecType string `json:"codec_type"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return clipMedia{}, err
	}
	seconds, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 {
		return clipMedia{}, errors.New("video duration is unavailable")
	}
	media := clipMedia{DurationMS: int64(seconds * 1000)}
	var hasVideo bool
	for _, stream := range result.Streams {
		if stream.CodecType == "video" {
			hasVideo = true
		}
		if stream.CodecType == "audio" {
			media.HasAudio = true
		}
	}
	if !hasVideo {
		return clipMedia{}, errors.New("input has no video stream")
	}
	return media, nil
}

func renderClip(ctx context.Context, source, output string, clip clipCandidate, hasAudio bool) error {
	ffmpeg := storage.FfmpegPath
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	temporary := output + ".tmp"
	defer os.Remove(temporary)
	args := []string{"-hide_banner", "-loglevel", "error", "-y",
		"-ss", fmt.Sprintf("%.3f", float64(clip.StartMS)/1000), "-i", source,
		"-t", fmt.Sprintf("%.3f", float64(clip.EndMS-clip.StartMS)/1000),
		"-map", "0:v:0", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
		"-c:v", "libx264", "-preset", "veryfast", "-sn", "-dn"}
	if hasAudio {
		args = append(args, "-map", "0:a:0", "-c:a", "aac")
	} else {
		args = append(args, "-an")
	}
	args = append(args, "-movflags", "+faststart", "-f", "mp4", temporary)
	if outputText, err := exec.CommandContext(ctx, ffmpeg, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg failed: %w: %s", err, strings.TrimSpace(string(outputText)))
	}
	info, err := os.Stat(temporary)
	if err != nil || info.Size() == 0 {
		return errors.New("ffmpeg produced an empty clip")
	}
	if _, err := probeClipMedia(ctx, temporary); err != nil {
		return fmt.Errorf("rendered clip is invalid: %w", err)
	}
	return os.Rename(temporary, output)
}

func clipWindows(rows []clipRow) [][2]int {
	const maxChars, maxMS, overlapMS = 12_000, 20 * 60 * 1000, 4 * 60 * 1000
	var windows [][2]int
	for first := 0; first < len(rows); {
		last, chars := first, utf8.RuneCountInString(rows[first].Text)
		for last+1 < len(rows) {
			next := utf8.RuneCountInString(rows[last+1].Text)
			if chars+next > maxChars || rows[last+1].EndMS-rows[first].StartMS > maxMS {
				break
			}
			last++
			chars += next
		}
		windows = append(windows, [2]int{first, last})
		if last+1 == len(rows) {
			break
		}
		nextFirst := last
		for nextFirst > first+1 && rows[last].EndMS-rows[nextFirst].StartMS < overlapMS {
			nextFirst--
		}
		first = max(first+1, nextFirst)
	}
	return windows
}

func analyzeClipRows(ctx context.Context, analyzer ClipAnalyzer, rows []clipRow, req ClipRequest, videoDurationMS int64) ([]clipCandidate, error) {
	var candidates []clipCandidate
	var firstWindowError error
	successfulWindows := 0
	windows := clipWindows(rows)
	for index, span := range windows {
		reportClip(req, "analyzing_clips", 48+index*12/len(windows), fmt.Sprintf("正在分析字幕窗口 %d/%d", index+1, len(windows)))
		prompt := clipPrompt(rows, span, req)
		var parsed []clipCandidate
		var parseErr error
		for attempt := 0; attempt < 2; attempt++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			response, err := analyzer.AnalyzeClipWindow(ctx, prompt)
			if err != nil {
				parseErr = err
				continue
			}
			parsed, parseErr = parseClipWindow(response, rows, span, req, videoDurationMS)
			if parseErr == nil {
				break
			}
			prompt += "\nThe previous response was invalid: " + parseErr.Error() + ". Return only JSON in the required format."
		}
		if parseErr != nil {
			if firstWindowError == nil {
				firstWindowError = fmt.Errorf("subtitle window %d: %w", index+1, parseErr)
			}
			continue
		}
		successfulWindows++
		candidates = append(candidates, parsed...)
	}
	if successfulWindows == 0 {
		return nil, firstWindowError
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		return candidates[i].StartMS < candidates[j].StartMS
	})
	selected := make([]clipCandidate, 0, min(req.Count, len(candidates)))
	for _, candidate := range candidates {
		overlaps := false
		for _, existing := range selected {
			if candidate.StartMS < existing.EndMS && existing.StartMS < candidate.EndMS {
				overlaps = true
				break
			}
		}
		if !overlaps {
			selected = append(selected, candidate)
			if len(selected) == req.Count {
				break
			}
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].StartMS < selected[j].StartMS })
	return selected, nil
}

func clipPrompt(rows []clipRow, span [2]int, req ClipRequest) string {
	var builder strings.Builder
	builder.WriteString("You are a short-video editor. Select clips from the complete source-language transcript that are worth publishing on their own.\n")
	builder.WriteString("Each row is global row number|start-end milliseconds|original text, in chronological order. A subtitle row may contain only part of a sentence.\n")
	builder.WriteString("Selection criteria: information value (distinct insights or concrete facts), emotional resonance (a clear point of view), shareability (memorable or discussable ideas), and structural completeness.\n")
	builder.WriteString("Cut-point rules (most important): each clip covers one complete answer or central idea. Start with its first sentence and end with the last sentence needed to complete that idea. Never stop mid-sentence or before the answer is complete. Exclude opening pleasantries, the next question or use case, transitions, requests for comments, and the full video's closing remarks. Different uses of the same device or person are different ideas.\n")
	fmt.Fprintf(&builder, "Duration: each clip must be %d to %d seconds, measured from the first row's start to the last row's end in milliseconds. Once the minimum is met, choose the earliest complete ending of the central idea. Do not pad the clip to fill the duration or to cover every use of the same device. Split an overlong answer at a natural paragraph boundary. Before choosing end, check whether its final sentences still support the title and reason; if they introduce a parallel use case or a new topic, end earlier.\n", req.MinDurationSec, req.MaxDurationSec)
	fmt.Fprintf(&builder, "Count: read the entire transcript and return exactly %d complete, non-overlapping clips on distinct topics when available. Return fewer only if there truly are not enough clips satisfying the duration and completeness rules.\n", req.Count)
	builder.WriteString("For each clip, provide start/end (inclusive row numbers), title (a faithful Chinese title of at most 20 characters), reason (15 to 30 Chinese characters describing its single central highlight), and score (publishability from 0 to 1; 0.7 or above is worth publishing). Select only publishable clips. Do not translate the subtitles.\n")
	builder.WriteString("Return only JSON: {\"clips\":[{\"start\":1,\"end\":2,\"title\":\"<Chinese title>\",\"reason\":\"<Chinese reason>\",\"score\":0.8}]}\n")
	for index := span[0]; index <= span[1]; index++ {
		row := rows[index]
		fmt.Fprintf(&builder, "%d|%d-%d|%s\n", index+1, row.StartMS, row.EndMS, row.Text)
	}
	return builder.String()
}

func parseClipWindow(raw string, rows []clipRow, span [2]int, req ClipRequest, videoDurationMS int64) ([]clipCandidate, error) {
	var result struct {
		Clips []struct {
			Start int     `json:"start"`
			End   int     `json:"end"`
			Score float64 `json:"score"`
		} `json:"clips"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &result); err != nil {
		return nil, err
	}
	if result.Clips == nil {
		return nil, errors.New("missing clips array")
	}
	clips := make([]clipCandidate, 0, len(result.Clips))
	for _, item := range result.Clips {
		first, last := item.Start-1, item.End-1
		if first < span[0] || last > span[1] || first > last || item.Score < 0 || item.Score > 1 || math.IsNaN(item.Score) {
			continue
		}
		start, end := rows[first].StartMS, rows[last].EndMS
		if end > videoDurationMS || end-start < int64(req.MinDurationSec)*1000 || end-start > int64(req.MaxDurationSec)*1000 {
			continue
		}
		clips = append(clips, clipCandidate{StartMS: start, EndMS: end, Score: item.Score})
	}
	if len(result.Clips) > 0 && len(clips) == 0 {
		return nil, errors.New("all candidate ranges were invalid")
	}
	return clips, nil
}
