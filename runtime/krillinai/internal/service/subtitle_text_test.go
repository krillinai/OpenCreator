package service

import (
	"krillin-ai/internal/types"
	"strings"
	"testing"
)

func TestPairedTranslationMalayalamWordBoundary(t *testing.T) {
	// Source-side spans come from the saved step07 first response. The reverse
	// direction and edge-space variants are constructed offline regression cases.
	malayalam := []string{"എഴുതാനോ നിർമ്മിക്കാനോ എന്തെങ്കിലും കണ്ടെത്തുന്നത്", "ശ്രദ്ധിക്കുന്നതിന്റെ കാര്യം മാത്രമാണെന്ന്", "നിങ്ങൾ തിരിച്ചറിയും."}
	english := []string{"Finding something to write or create", "is just a matter of observing,", "you will realize."}
	for _, targetMalayalam := range []bool{false, true} {
		for _, keepSpaces := range []bool{false, true} {
			name := "source"
			source, target := append([]string(nil), malayalam...), append([]string(nil), english...)
			originLang, targetLang := types.StandardLanguageCode("ml"), types.StandardLanguageCode("en")
			if targetMalayalam {
				name, source, target = "target", target, source
				originLang, targetLang = targetLang, originLang
			}
			fullSource, fullTarget := strings.Join(source, " "), strings.Join(target, " ")
			if keepSpaces {
				name += "_with_edge_spaces"
				for i := 1; i < len(source); i++ {
					source[i], target[i] = " "+source[i], " "+target[i]
				}
			} else {
				name += "_trimmed_edges"
			}
			t.Run(name, func(t *testing.T) {
				input := pairedTranslationInput{MaxSourceChars: 60, MaxTargetChars: 60, Sentences: []pairedTranslationSource{{ID: "ml", Text: fullSource}}}
				response, err := encodePairedTestResponse([]pairedSentence{{ID: "ml", FullTarget: fullTarget, Source: source, Target: target}})
				if err != nil {
					t.Fatal(err)
				}
				translator := &Translator{}
				parsed, err := translator.parsePairedTranslation(string(response), input, originLang, targetLang)
				if err != nil || len(parsed) != 1 {
					t.Fatalf("safe word boundary was rejected: parsed=%+v error=%v", parsed, err)
				}
				recovered, ok := translator.recoverPairedSentence(parsed[0], input.Sentences[0], originLang, targetLang)
				if !ok || len(recovered.Source) != len(source) || len(recovered.Target) != len(target) {
					t.Fatalf("recovery discarded safe segments: recovered=%+v ok=%v", recovered, ok)
				}
			})
		}
	}
}

func TestSubtitleSegmentsCheckOriginalGraphemeEdges(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		segments   []string
		safe       bool
	}{
		{"combining_mark", "cafe\u0301 test", []string{"cafe", "\u0301 test"}, false},
		{"indic_conjunct", "क्षि नमस्ते", []string{"क्", "षि नमस्ते"}, false},
		{"emoji_joiner", "👩🏽‍💻 test", []string{"👩🏽", "\u200d💻 test"}, false},
		{"flag", "🇨🇳 test", []string{"🇨", "🇳 test"}, false},
		{"combining_mark_after_space", "word \u0301next", []string{"word ", "\u0301next"}, false},
		{"complete_space_grapheme", "word \u0301next", []string{"word \u0301", "next"}, true},
		{"valid_combining_word", "cafe\u0301 test", []string{"cafe\u0301", "test"}, true},
		{"missing_tibetan_separator", "བོད་སྐད།", []string{"བོད", "སྐད།"}, false},
		{"unchanged_tibetan_separator", "བོད་སྐད།", []string{"བོད་", "སྐད།"}, true},
		{"invalid_utf8_text", "a\xffb", []string{"a\xffb"}, false},
		{"invalid_utf8_segment", "ab", []string{"a\xff", "b"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if safe := subtitleSegmentsHaveSafeBoundariesInText(tc.text, tc.segments); safe != tc.safe {
				t.Fatalf("safe=%v want=%v text=%q segments=%q", safe, tc.safe, tc.text, tc.segments)
			}
		})
	}
}
