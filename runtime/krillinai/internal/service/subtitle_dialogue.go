package service

import (
	"fmt"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"strings"
)

type assDialogueWriter interface {
	WriteString(string) (int, error)
}

func writeStyledSubtitleDialogue(writer assDialogueWriter, start, end, text string, screen subtitlestyle.ScreenStyle) {
	_, _ = writer.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Major,,0,0,0,,%s\n", start, end, text))
	if !hasBlurredShadow(screen.Major) && !hasBlurredShadow(screen.Minor) {
		return
	}

	foreground := text
	for _, entry := range []struct {
		name  string
		style subtitlestyle.Style
	}{
		{name: "Major", style: screen.Major},
		{name: "Minor", style: screen.Minor},
	} {
		prefix := fmt.Sprintf("{\\r%s}{\\an%d}%s", entry.name, subtitlestyle.Alignment(entry.style), subtitlestyle.DialogueTags(entry.style))
		sharpStyle := entry.style
		sharpStyle.OverrideTags = ""
		sharpPrefix := fmt.Sprintf("{\\r%s}{\\an%d}%s{\\shad0\\blur0}", entry.name, subtitlestyle.Alignment(sharpStyle), subtitlestyle.DialogueTags(sharpStyle))
		foreground = strings.ReplaceAll(foreground, prefix, sharpPrefix)
	}
	_, _ = writer.WriteString(fmt.Sprintf("Dialogue: 1,%s,%s,Major,,0,0,0,,%s\n", start, end, foreground))
}

func hasBlurredShadow(style subtitlestyle.Style) bool {
	return style.Shadow != nil && *style.Shadow > 0 && strings.Contains(style.OverrideTags, `\blur`)
}
