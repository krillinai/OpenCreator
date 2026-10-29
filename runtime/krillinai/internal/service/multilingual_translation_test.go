package service

import (
	"context"
	"fmt"
	"krillin-ai/config"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"strings"
	"testing"
)

func TestMultilingualSourceRoutes(t *testing.T) {
	log.InitLogger()
	previous := config.Conf
	t.Cleanup(func() { config.Conf = previous })
	config.Conf.App.TranslateParallelNum = 1
	config.Conf.App.MaxSentenceLength = 50
	cases := []struct{ code, left, right string }{
		{"ar", "مرحبًا ", "بالعالم."},
		{"hi", "नमस्ते ", "दुनिया।"},
		{"bn", "হ্যালো ", "পৃথিবী।"},
		{"vi", "Xin chào ", "thế giới."},
		{"he", "שלום ", "עולם."},
		{"fa", "ما می‌توانیم ", "شروع کنیم."},
		{"ur", "سلام ", "دنیا۔"},
		{"ta", "வணக்கம் ", "உலகம்."},
		{"te", "నమస్కారం ", "ప్రపంచం."},
		{"pl", "Witaj ", "świecie."},
		{"uk", "Привіт, ", "світе."},
		{"fil", "Kumusta ", "mundo."},
		{"km", "សួស្តី ", "ពិភពលោក។"},
		{"lo", "ສະບາຍດີ ", "ໂລກ."},
		{"mr", "नमस्कार ", "जग।"},
		{"pa", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ ", "ਦੁਨੀਆ।"},
		{"am", "ሰላም ", "ዓለም።"},
		{"jv", "ꦱꦸꦒꦼꦁ ", "ꦫꦮꦸꦃ꧉"},
		{"ml", "നമസ്കാരം ", "ലോകമേ."},
		{"kn", "ನಮಸ್ಕಾರ ", "ಜಗತ್ತೇ."},
		{"or", "ନମସ୍କାର ", "ଦୁନିଆ।"},
		{"ka", "გამარჯობა ", "მსოფლიო."},
		{"hy", "Բարեւ ", "աշխարհ։"},
		{"si", "ආයුබෝවන් ", "ලෝකය."},
		{"bo", "བོད་", "སྐད།"},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			source := tc.left + tc.right
			language := types.StandardLanguageCode(tc.code)
			limit := max(6, max(subtitleTargetLength(tc.left), subtitleTargetLength(tc.right)))
			calls := 0
			translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				calls++
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				if input.SourceLanguage == "未知" || len(input.Sentences) != 1 || input.Sentences[0].Text != source {
					return "", fmt.Errorf("unexpected input: %+v", input)
				}
				data, err := encodePairedTestResponse([]pairedSentence{{ID: input.Sentences[0].ID, FullTarget: "你好，世界。", Source: []string{tc.left, tc.right}, Target: []string{"你好，", "世界。"}}})
				return string(data), err
			})}
			translated, err := translator.translatePairedSentences(context.Background(), []string{source}, language, "zh_cn", limit, 1, nil)
			if err != nil || calls != 1 || len(translated) != 1 {
				t.Fatalf("translation structure: calls=%d error=%v output=%+v", calls, err, translated)
			}
			var blocks []*util.SrtBlock
			for i, segment := range translated[0].Source {
				blocks = append(blocks, &util.SrtBlock{Index: i + 1, OriginLanguageSentence: segment, TargetLanguageSentence: translated[0].Target[i]})
			}
			if compactSubtitleText(strings.Join(translated[0].Source, "")) != compactSubtitleText(source) {
				t.Fatal("source lost")
			}
			for _, cleanPunctuation := range []bool{false, true} {
				words := []types.Word{{Text: strings.TrimSpace(tc.left), Start: 0, End: 1}, {Text: tc.right, Start: 1, End: 2}}
				if cleanPunctuation {
					for i := range words {
						words[i].Text = util.CleanPunction(words[i].Text)
					}
				}
				timed, spans, err := pairedAudioTiming(blocks, words, language, 10)
				if err != nil || len(timed) != len(blocks) || len(spans) == 0 {
					t.Fatalf("timing fallback=%v: %v", cleanPunctuation, err)
				}
				start, _, err := parseSRTTimeline(timed[0].Timestamp)
				if err != nil || start != 10000 {
					t.Fatalf("start=%d error=%v", start, err)
				}
				_, end, err := parseSRTTimeline(timed[len(timed)-1].Timestamp)
				if err != nil || end != 12000 {
					t.Fatalf("end=%d error=%v", end, err)
				}
				short, err := splitShortSubtitleBlocks(timed, spans, 8, 12)
				if err != nil || len(short) != len(blocks) {
					t.Fatalf("short subtitles: %v", err)
				}
			}
			cueTranslator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
				input, err := decodePairedTestInput(prompt)
				if err != nil {
					return "", err
				}
				data, err := encodePairedTestResponse([]pairedSentence{{ID: input.Sentences[0].ID, FullTarget: "你好，世界。", Source: []string{source}, Target: []string{"你好，世界。"}}})
				return string(data), err
			})}
			cueOutput, err := cueTranslator.BatchTranslateSrtBlocks(context.Background(), []*util.SrtBlock{{Index: 1, Timestamp: "00:00:10,000 --> 00:00:12,000", OriginLanguageSentence: source}}, tc.code, "zh_cn", nil)
			if err != nil || len(cueOutput) != 1 || cueOutput[0].Timestamp != "00:00:10,000 --> 00:00:12,000" {
				t.Fatalf("cue route: %+v error=%v", cueOutput, err)
			}
		})
	}
}

func TestMultilingualSubtitleWrapKeepsGraphemeBoundaries(t *testing.T) {
	for _, sample := range []string{"क्षि", "हिन्दी ", "العَرَبِيَّة ", "বাংলা ", "தமிழ் ", "ภาษาไทย ", "မြန်မာ ", "ខ្មែរ ", "ພາສາລາວ ", "漢字क्षि"} {
		text := strings.Repeat(sample, 40)
		for _, wrap := range []func(string, subtitlestyle.Style, *types.SubtitleTaskStepParam) []string{wrapSubtitleForASS, wrapVerticalChineseSubtitleForASS} {
			parts := wrap(text, subtitlestyle.Style{}, nil)
			if len(parts) == 0 || !subtitleSegmentsHaveSafeBoundaries(parts) || compactSubtitleText(strings.Join(parts, "")) != compactSubtitleText(text) {
				t.Fatalf("unsafe wrap for %q: %q", sample, parts)
			}
		}
	}
}

func TestOriginSubtitlePreservesLanguageSpaces(t *testing.T) {
	for _, test := range []struct{ code, text, left, right string }{
		{"ko", "한국어 문장입니다.", "한국어", "문장입니다"},
		{"th", "ภาษาไทย ทดสอบ", "ภาษาไทย", "ทดสอบ"},
		{"ar", "مرحبًا بالعالم.", "مرحبًا", "بالعالم"},
	} {
		cues := originCuesFromTranscription(&types.TranscriptionData{Text: test.text, Words: []types.Word{{Text: test.left, Start: 0, End: 1}, {Text: test.right, Start: 1, End: 2}}}, 0, 2, 12, types.StandardLanguageCode(test.code))
		if len(cues) != 1 || cues[0].Text != test.text {
			t.Fatalf("%s: %+v", test.code, cues)
		}
	}
}
