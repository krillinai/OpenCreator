package service

import (
	"context"
	"strings"
	"testing"
)

func TestPairedTranslationRepairsOnlyEmptyTargetRegion(t *testing.T) {
	source := "I review notes and I finish tasks before school starts"
	initial := `{"sentences":[{"sentence_id":"1","segments":[{"source":"I review notes ","target":"我会复习笔记，并完成任务，"},{"source":"and I finish tasks ","target":""},{"source":"before school starts","target":"在开学前完成。"}]}]}`
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		if calls == 1 {
			return initial, nil
		}
		input, err := decodePairedTestInput(prompt)
		if err != nil || len(input.Sentences) != 1 || input.Sentences[0].ID != "1.missing.1" || input.Sentences[0].Text != source {
			t.Fatalf("局部请求没有只提交空译文片段: %+v err=%v", input, err)
		}
		return `{"sentences":[{"sentence_id":"1.missing.1","segments":[{"source":"I review notes ","target":"我会复习笔记，"},{"source":"and I finish tasks ","target":"并完成任务，"},{"source":"before school starts","target":"在开学前完成。"}]}]}`, nil
	})}
	input := pairedTranslationInput{
		SourceLanguage: "English", TargetLanguage: "简体中文", MaxSourceChars: 30, MaxTargetChars: 30,
		Sentences: []pairedTranslationSource{{ID: "1", Text: source}},
	}
	var final pairedSentence
	_, err := translator.translatePairedBatch(context.Background(), input, "en", "zh_cn", func(sentence pairedSentence, complete bool) error {
		if complete {
			final = sentence
		}
		return nil
	})
	if err != nil || calls != 2 || final.LayoutFallback || len(final.Source) != 3 || len(final.Target) != 3 {
		t.Fatalf("空译文没有局部修复: calls=%d final=%+v err=%v", calls, final, err)
	}
	if strings.Join(final.Source, "") != source || strings.Join(final.Target, "") != "我会复习笔记，并完成任务，在开学前完成。" {
		t.Fatalf("局部修复改变了完整覆盖: %+v", final)
	}
}

func TestPairedTranslationKeepsValidRegionWhileRepairingLongAndEmptyRegions(t *testing.T) {
	source := "I review notes and I finish many tasks before school starts"
	initial := `{"sentences":[{"sentence_id":"1","segments":[{"source":"I review notes ","target":"我会复习笔记，"},{"source":"and I finish many tasks before school ","target":"并完成许多任务，在学校开学前，开始。"},{"source":"starts","target":""}]}]}`
	calls := 0
	translator := &Translator{chatCompleter: translationCompleterFunc(func(prompt string) (string, error) {
		calls++
		input, err := decodePairedTestInput(prompt)
		if err != nil {
			t.Fatalf("局部请求输入无效: %v", err)
		}
		if calls == 1 {
			return initial, nil
		}
		if calls == 2 {
			if len(input.Sentences) != 1 || input.Sentences[0].ID != "1.missing.2" {
				t.Fatalf("空译文请求提交了错误片段: %+v", input.Sentences)
			}
			return `{"sentences":[{"sentence_id":"1.missing.2","segments":[{"source":"and I finish many tasks ","target":"并完成许多任务，"},{"source":"before school ","target":"在学校开学前，"},{"source":"starts","target":"开始。"}]}]}`, nil
		}
		return "", nil
	})}
	input := pairedTranslationInput{
		SourceLanguage: "English", TargetLanguage: "简体中文", MaxSourceChars: 30, MaxTargetChars: 30,
		Sentences: []pairedTranslationSource{{ID: "1", Text: source}},
	}
	var final pairedSentence
	_, err := translator.translatePairedBatch(context.Background(), input, "en", "zh_cn", func(sentence pairedSentence, complete bool) error {
		if complete {
			final = sentence
		}
		return nil
	})
	if err != nil || calls != 2 || final.LayoutFallback || len(final.Source) != 4 || !pairedSentenceWithinLimit(final, 30) {
		t.Fatalf("有效片段未保留或长片段未局部修复: calls=%d final=%+v err=%v", calls, final, err)
	}
	if strings.Join(final.Source, "") != source || strings.Join(final.Target, "") != "我会复习笔记，并完成许多任务，在学校开学前，开始。" {
		t.Fatalf("局部修复破坏完整覆盖: %+v", final)
	}
}
