package service

import (
	"encoding/json"
	"fmt"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type subtitleRenderDocument struct {
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	Horizontal       bool   `json:"horizontal"`
	Bilingual        bool   `json:"bilingual"`
	SubtitlePosition string `json:"subtitlePosition"`
	// The daemon includes the style in its request document for cache/debug
	// completeness. The compiled style is supplied separately via the CLI flag.
	SubtitleStyle json.RawMessage     `json:"subtitleStyle,omitempty"`
	MajorTitle    string              `json:"majorTitle,omitempty"`
	MinorTitle    string              `json:"minorTitle,omitempty"`
	Cues          []subtitleRenderCue `json:"cues"`
}

type subtitleRenderCue struct {
	StartMs    int    `json:"startMs"`
	EndMs      int    `json:"endMs"`
	Text       string `json:"text"`
	SourceText string `json:"sourceText,omitempty"`
}

// CompileSubtitleDocument converts the structured Creator preview input to the
// same ASS track used by the video renderer, without requiring a media input.
func CompileSubtitleDocument(input, output string, styleSet *subtitlestyle.StyleSet) error {
	data, err := os.ReadFile(input)
	if err != nil {
		return fmt.Errorf("read subtitle render document: %w", err)
	}
	var document subtitleRenderDocument
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return fmt.Errorf("parse subtitle render document: %w", err)
	}
	if document.Width < 32 || document.Height < 32 {
		return fmt.Errorf("subtitle render dimensions must be at least 32x32")
	}
	if document.SubtitlePosition != "top" && document.SubtitlePosition != "bottom" {
		return fmt.Errorf("unsupported subtitle position: %s", document.SubtitlePosition)
	}
	if len(document.Cues) == 0 {
		return fmt.Errorf("subtitle render document has no cues")
	}
	if styleSet == nil {
		styleSet = subtitlestyle.DefaultStyleSet()
	}
	if err := subtitlestyle.Validate(styleSet); err != nil {
		return fmt.Errorf("subtitle style invalid: %w", err)
	}

	screenStyle := styleSet.Vertical
	if document.Horizontal {
		screenStyle = styleSet.Horizontal
	}
	majorPrefix := fmt.Sprintf("{\\rMajor}{\\an%d}%s", subtitlestyle.Alignment(screenStyle.Major), subtitlestyle.DialogueTags(screenStyle.Major))
	minorPrefix := fmt.Sprintf("{\\rMinor}{\\an%d}%s", subtitlestyle.Alignment(screenStyle.Minor), subtitlestyle.DialogueTags(screenStyle.Minor))
	firstStyle, secondStyle := screenStyle.Major, screenStyle.Minor
	firstPrefix, secondPrefix := majorPrefix, minorPrefix
	if document.SubtitlePosition == "bottom" {
		firstStyle, secondStyle = screenStyle.Minor, screenStyle.Major
		firstPrefix, secondPrefix = minorPrefix, majorPrefix
	}
	fallbacks := packagedSubtitleFallbacks()
	var ass strings.Builder
	ass.WriteString(strings.Replace(subtitlestyle.BuildAssHeader(styleSet, document.Horizontal), "[Script Info]", "[Script Info]\nWrapStyle: 2", 1))
	for index, cue := range document.Cues {
		if cue.StartMs < 0 || cue.EndMs <= cue.StartMs {
			return fmt.Errorf("invalid subtitle cue %d timing", index+1)
		}
		start := formatTimestamp(time.Duration(cue.StartMs) * time.Millisecond)
		end := formatTimestamp(time.Duration(cue.EndMs) * time.Millisecond)
		var text string
		if document.Bilingual && cue.SourceText != "" {
			first, second := cue.Text, cue.SourceText
			text = firstPrefix + subtitleFallbackFontTags(assText(first), firstStyle.FontName, fallbacks)
			text += `\N` + secondPrefix + subtitleFallbackFontTags(assText(second), secondStyle.FontName, fallbacks)
		} else {
			text = majorPrefix + subtitleFallbackFontTags(assText(cue.Text), screenStyle.Major.FontName, fallbacks)
		}
		ass.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", start, end, text))
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		return fmt.Errorf("create subtitle output directory: %w", err)
	}
	if err := os.WriteFile(output, []byte(ass.String()), 0600); err != nil {
		return fmt.Errorf("write subtitle ASS: %w", err)
	}
	return nil
}

func assText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.ReplaceAll(value, "\n", `\N`)
}
