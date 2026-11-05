package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSrtFileToSpeechRejectsNilStepParam(t *testing.T) {
	err := Service{}.srtFileToSpeech(context.Background(), nil)
	if err == nil {
		t.Fatal("srtFileToSpeech() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "srtFileToSpeech stepParam is nil") {
		t.Fatalf("srtFileToSpeech() error = %q, want nil stepParam error", err)
	}
}

func TestResolveDubbingVoiceCodeUsesCloneCode(t *testing.T) {
	var gotPrefix string
	var gotAudioURL string
	clone := func(prefix, audioURL string) (string, error) {
		gotPrefix = prefix
		gotAudioURL = audioURL
		return "cloned-code", nil
	}

	got, err := resolveDubbingVoiceCode("base", "clone.wav", clone)
	if err != nil {
		t.Fatalf("resolveDubbingVoiceCode() error = %v, want nil", err)
	}
	if got != "cloned-code" {
		t.Fatalf("resolveDubbingVoiceCode() = %q, want %q", got, "cloned-code")
	}
	if gotPrefix != "krillinai" {
		t.Fatalf("clone prefix = %q, want %q", gotPrefix, "krillinai")
	}
	if gotAudioURL != "clone.wav" {
		t.Fatalf("clone audioURL = %q, want %q", gotAudioURL, "clone.wav")
	}
}

func TestResolveDubbingVoiceCodeWithoutCloneURLReturnsBaseVoice(t *testing.T) {
	called := false
	clone := func(prefix, audioURL string) (string, error) {
		called = true
		return "cloned-code", nil
	}

	got, err := resolveDubbingVoiceCode("base", "", clone)
	if err != nil {
		t.Fatalf("resolveDubbingVoiceCode() error = %v, want nil", err)
	}
	if got != "base" {
		t.Fatalf("resolveDubbingVoiceCode() = %q, want %q", got, "base")
	}
	if called {
		t.Fatal("clone was called without clone URL")
	}
}

func TestTargetSRTPathForDubbingUsesTargetLanguageFile(t *testing.T) {
	base := filepath.Join("tasks", "demo")
	got := targetSRTPathForDubbing(base)
	want := filepath.Join(base, "target_language_srt.srt")
	if got != want {
		t.Fatalf("targetSRTPathForDubbing() = %q, want %q", got, want)
	}
}

func TestPersistDubbingSubtitleCopiesFinalSubtitleToTargetPath(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "dubbing", "dub.srt")
	target := filepath.Join(dir, "custom", "target.srt")
	if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	content := "1\n00:00:00,000 --> 00:00:01,000\n实际配音文本\n\n"
	if err := os.WriteFile(source, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	if err := persistDubbingSubtitle(source, target); err != nil {
		t.Fatalf("persistDubbingSubtitle() error = %v", err)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != content {
		t.Fatalf("target subtitle = %q, want %q", string(data), content)
	}
}

func TestPersistDubbingSubtitlesAlignsAllSubtitleOutputsToFinalDubbingTimeline(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "origin_language_srt.srt")
	dubbing := filepath.Join(dir, "dubbing", "dub.srt")
	originOutput := filepath.Join(dir, "synced", "origin_language_srt.srt")
	targetOutput := filepath.Join(dir, "synced", "target_language_srt.srt")
	bilingualOutput := filepath.Join(dir, "synced", "bilingual_srt.srt")
	if err := os.MkdirAll(filepath.Dir(dubbing), 0755); err != nil {
		t.Fatal(err)
	}
	origin := "1\n00:00:00,000 --> 00:00:00,900\nsource one\ncontinues here\n\n2\n00:00:00,900 --> 00:00:01,800\nsource two\n\n"
	dub := "7\n00:00:00,000 --> 00:00:01,800\n目标配音文本\n\n"
	if err := os.WriteFile(source, []byte(origin), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dubbing, []byte(dub), 0644); err != nil {
		t.Fatal(err)
	}
	if err := persistDubbingSubtitles(source, dubbing, originOutput, targetOutput, bilingualOutput); err != nil {
		t.Fatalf("persistDubbingSubtitles() error = %v", err)
	}
	for _, path := range []string{originOutput, targetOutput, bilingualOutput} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("synchronized subtitle %s missing: %v", path, err)
		}
	}
	originData, err := os.ReadFile(originOutput)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(originData), "7\n00:00:00,000 --> 00:00:01,800\nsource one continues here source two\n\n"; got != want {
		t.Fatalf("synchronized origin = %q, want %q", got, want)
	}
	bilingualData, err := os.ReadFile(bilingualOutput)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(bilingualData), "7\n00:00:00,000 --> 00:00:01,800\n目标配音文本\nsource one continues here source two\n\n"; got != want {
		t.Fatalf("synchronized bilingual = %q, want %q", got, want)
	}
	targetData, err := os.ReadFile(targetOutput)
	if err != nil {
		t.Fatal(err)
	}
	if string(targetData) != dub {
		t.Fatalf("target subtitle = %q, want final dubbing subtitle %q", string(targetData), dub)
	}
}

func TestPersistDubbingSubtitlesDoesNotUpdateAnyOutputWhenSourceCannotAlign(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "origin.srt")
	dubbing := filepath.Join(dir, "dub.srt")
	target := filepath.Join(dir, "target.srt")
	originOutput := filepath.Join(dir, "origin-output.srt")
	bilingualOutput := filepath.Join(dir, "bilingual-output.srt")
	if err := os.WriteFile(source, []byte("1\n00:00:00,000 --> 00:00:01,000\nsource\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dubbing, []byte("1\n00:00:02,000 --> 00:00:03,000\ntarget\n\n"), 0644); err != nil {
		t.Fatal(err)
	}
	oldTarget := "old target\n"
	if err := os.WriteFile(target, []byte(oldTarget), 0644); err != nil {
		t.Fatal(err)
	}
	if err := persistDubbingSubtitles(source, dubbing, originOutput, target, bilingualOutput); err == nil {
		t.Fatal("persistDubbingSubtitles() error = nil, want alignment error")
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != oldTarget {
		t.Fatalf("target subtitle changed after alignment failure: %q", string(data))
	}
	for _, path := range []string{originOutput, bilingualOutput} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("synchronized output %s exists after alignment failure", path)
		}
	}
}
