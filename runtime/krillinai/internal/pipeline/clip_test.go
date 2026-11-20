package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"krillin-ai/internal/service"
	"krillin-ai/internal/types"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type clipSystemCompleter struct {
	systemPrompt string
	userPrompt   string
}

func (c *clipSystemCompleter) ChatCompletion(string) (string, error) {
	return "", errors.New("unexpected translation completion")
}

func (c *clipSystemCompleter) ChatCompletionContextWithSystem(_ context.Context, systemPrompt, userPrompt string) (string, error) {
	c.systemPrompt, c.userPrompt = systemPrompt, userPrompt
	return `{"clips":[]}`, nil
}

func TestClipAdapterUsesClipSystemPrompt(t *testing.T) {
	completer := &clipSystemCompleter{}
	adapter := NewServiceAdapter(&service.Service{ChatCompleter: completer})
	if _, err := adapter.AnalyzeClipWindow(context.Background(), "find clips"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(completer.systemPrompt, "short-video editor") || completer.userPrompt != "find clips" {
		t.Fatalf("clip prompt was not routed to the clip-specific system: %+v", completer)
	}
}

type clipFixtureService struct {
	*fakeStageService
	video   string
	prompts []string
}

func (f *clipFixtureService) PrepareMedia(_ context.Context, step *types.SubtitleTaskStepParam) error {
	step.InputVideoPath = f.video
	return nil
}

func (f *clipFixtureService) AnalyzeClipWindow(_ context.Context, prompt string) (string, error) {
	f.prompts = append(f.prompts, prompt)
	return `{"clips":[{"start":1,"end":2,"score":0.8,"reason":"La deuxième phrase résume la méthode.","reason_row":2},{"start":4,"end":5,"score":0.9,"reason":"Ce repère est hors du clip.","reason_row":3}]}`, nil
}

func TestRunClipWithImportedSourceSubtitlesDoesNotTranslate(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is unavailable")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is unavailable")
	}
	dir := t.TempDir()
	video := filepath.Join(dir, "source.mp4")
	if output, err := exec.Command(ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=1", "-t", "40", "-c:v", "mpeg4", video).CombinedOutput(); err != nil {
		t.Fatalf("create fixture video: %v: %s", err, output)
	}
	srt := filepath.Join(dir, "source.srt")
	var subtitles strings.Builder
	for index := 0; index < 5; index++ {
		fmt.Fprintf(&subtitles, "%d\n00:00:%02d,000 --> 00:00:%02d,000\nSentence %d.\n\n", index+1, index*8, (index+1)*8, index+1)
	}
	if err := os.WriteFile(srt, []byte(subtitles.String()), 0600); err != nil {
		t.Fatal(err)
	}
	svc := &clipFixtureService{fakeStageService: &fakeStageService{}, video: video}
	response, err := RunClip(context.Background(), svc, ClipRequest{
		Input: video, InputSRT: srt, Workdir: dir, TaskID: "clip-test",
		Count: 2, MinDurationSec: 15, MaxDurationSec: 20, ReasonLocale: "fr-FR",
	})
	if err != nil || !response.OK {
		t.Fatalf("RunClip: response=%+v error=%v", response, err)
	}
	if len(svc.calls) != 0 || len(svc.prompts) != 1 {
		t.Fatalf("unexpected translation or analysis calls: calls=%v prompts=%d", svc.calls, len(svc.prompts))
	}
	if !strings.Contains(svc.prompts[0], "in locale fr-FR") {
		t.Fatalf("selection reason prompt did not use the requested locale: %s", svc.prompts[0])
	}
	if response.Outputs.TargetSRT != "" || response.Outputs.ClipIndex == "" {
		t.Fatalf("unexpected outputs: %+v", response.Outputs)
	}
	data, err := os.ReadFile(response.Outputs.ClipIndex)
	if err != nil {
		t.Fatal(err)
	}
	var index struct {
		Clips []struct {
			ClipResultItem
			Reason *struct {
				Text     string `json:"text"`
				OffsetMS int64  `json:"offset_ms"`
				Locale   string `json:"locale"`
			} `json:"selection_reason"`
		} `json:"clips"`
	}
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatal(err)
	}
	if len(index.Clips) != 2 || index.Clips[0].StartMS != 0 || index.Clips[1].StartMS != 24000 {
		t.Fatalf("unexpected clip index: %+v", index)
	}
	if reason := index.Clips[0].Reason; reason == nil || reason.Text != "La deuxième phrase résume la méthode." || reason.OffsetMS != 8000 || reason.Locale != "fr-FR" {
		t.Fatalf("missing or invalid selection reason at the subtitle anchor: %+v", reason)
	}
	if index.Clips[1].Reason != nil {
		t.Fatalf("invalid selection reason should not be exported: %+v", index.Clips[1].Reason)
	}
	for _, item := range index.Clips {
		if _, err := probeClipMedia(context.Background(), filepath.Join(dir, filepath.FromSlash(item.File))); err != nil {
			t.Fatalf("invalid output %s: %v", item.File, err)
		}
	}
}

type clipWindowAnalyzer struct {
	calls int
}

func TestClipReasonAnchorsToSubtitleRow(t *testing.T) {
	rows := []clipRow{{StartMS: 120000, EndMS: 132345}, {StartMS: 132345, EndMS: 150000}, {StartMS: 150000, EndMS: 160000}}
	candidates, err := parseClipWindow(`{"clips":[{"start":1,"end":2,"score":0.8,"reason":"An example illustrates the point.","reason_row":2},{"start":1,"end":2,"score":0.9,"reason":"Outside the clip.","reason_row":3},{"start":1,"end":2,"score":0.7,"reason":{},"reason_row":1}]}`,
		rows, [2]int{0, 2}, ClipRequest{MinDurationSec: 15, MaxDurationSec: 40}, 160000)
	if err != nil || len(candidates) != 3 {
		t.Fatalf("optional reasons must not invalidate clips: candidates=%+v error=%v", candidates, err)
	}
	for index, candidate := range candidates {
		data, err := json.Marshal(candidate)
		if err != nil {
			t.Fatal(err)
		}
		if index == 0 && !strings.Contains(string(data), `"offset_ms":12345`) {
			t.Fatalf("missing the clip-relative subtitle anchor: %s", data)
		}
		if index > 0 && strings.Contains(string(data), `"offset_ms"`) {
			t.Fatalf("invalid reason should not be retained: %s", data)
		}
	}
}

func (a *clipWindowAnalyzer) AnalyzeClipWindow(_ context.Context, prompt string) (string, error) {
	a.calls++
	if strings.Contains(prompt, "260|") {
		return `{"clips":[{"start":251,"end":260,"score":0.95}]}`, nil
	}
	if strings.Contains(prompt, "\n1|") {
		return `{"clips":[{"start":1,"end":10,"score":0.3}]}`, nil
	}
	return `{"clips":[]}`, nil
}

func TestClipAnalysisConsidersLaterWindows(t *testing.T) {
	rows := make([]clipRow, 260)
	for index := range rows {
		rows[index] = clipRow{StartMS: int64(index) * 10000, EndMS: int64(index+1) * 10000, Text: "complete sentence"}
	}
	analyzer := &clipWindowAnalyzer{}
	selected, err := analyzeClipRows(context.Background(), analyzer, rows, ClipRequest{Count: 1, MinDurationSec: 90, MaxDurationSec: 120}, rows[len(rows)-1].EndMS)
	if err != nil {
		t.Fatal(err)
	}
	if analyzer.calls < 2 || len(selected) != 1 || selected[0].StartMS != 2500000 {
		t.Fatalf("later window was not selected: calls=%d selected=%+v", analyzer.calls, selected)
	}
}

func TestRunClipRequestsTranscriptionOnlyAfterYouTubeCaptionsFail(t *testing.T) {
	svc := &fakeStageService{downloadErr: errors.New("captions unavailable")}
	workdir := t.TempDir()
	response, err := RunClip(context.Background(), svc, ClipRequest{
		Input: "https://www.youtube.com/watch?v=missing", Workdir: workdir,
		Count: 2, MinDurationSec: 30, MaxDurationSec: 60,
		CaptionSource: CaptionSourceAny, DeferTranscription: true,
	})
	if err == nil || response.Error == nil || response.Error.Code != "clip_transcription_required" {
		t.Fatalf("unexpected fallback response: %+v, %v", response, err)
	}
	if len(svc.calls) != 1 || svc.calls[0] != "download-youtube" {
		t.Fatalf("transcription started before dependencies were ready: %v", svc.calls)
	}
}

type partialClipAnalyzer struct{}

func (partialClipAnalyzer) AnalyzeClipWindow(_ context.Context, prompt string) (string, error) {
	if strings.Contains(prompt, "260|") {
		return `{"clips":[{"start":251,"end":260,"score":0.9}]}`, nil
	}
	return "invalid", nil
}

func TestClipAnalysisSkipsFailedWindowWhenAnotherWindowSucceeds(t *testing.T) {
	rows := make([]clipRow, 260)
	for index := range rows {
		rows[index] = clipRow{StartMS: int64(index) * 10000, EndMS: int64(index+1) * 10000, Text: "complete sentence"}
	}
	selected, err := analyzeClipRows(context.Background(), partialClipAnalyzer{}, rows,
		ClipRequest{Count: 1, MinDurationSec: 90, MaxDurationSec: 120}, rows[len(rows)-1].EndMS)
	if err != nil || len(selected) != 1 || selected[0].StartMS != 2500000 {
		t.Fatalf("later window lost: %+v, %v", selected, err)
	}
}
