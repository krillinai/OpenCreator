package service

import (
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"strings"
	"testing"
)

func TestWriteStyledSubtitleDialogueKeepsBlurredShadowBehindSharpText(t *testing.T) {
	style := subtitlestyle.DefaultStyleSet().Horizontal
	shadow := 2.0
	style.Major.Shadow = &shadow
	style.Major.OverrideTags = `\xshad0\yshad2\blur4`
	text := `{\rMajor}{\an2}{\xshad0\yshad2\blur4}Subtitle`
	var ass strings.Builder
	writeStyledSubtitleDialogue(&ass, "00:00:00.00", "00:00:02.00", text, style)
	if strings.Count(ass.String(), "Dialogue:") != 2 ||
		!strings.Contains(ass.String(), "Dialogue: 1,00:00:00.00,00:00:02.00,Major,,0,0,0,,{\\rMajor}{\\an2}{\\shad0\\blur0}Subtitle") {
		t.Fatalf("blurred shadow and sharp foreground were not separated:\n%s", ass.String())
	}

	style.Major.OverrideTags = ""
	ass.Reset()
	writeStyledSubtitleDialogue(&ass, "00:00:00.00", "00:00:02.00", `{\rMajor}{\an2}Subtitle`, style)
	if strings.Count(ass.String(), "Dialogue:") != 1 {
		t.Fatalf("unblurred subtitle should use one layer:\n%s", ass.String())
	}
}
