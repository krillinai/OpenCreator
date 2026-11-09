package dubbing

import (
	"context"
	"krillin-ai/internal/types"
)

const (
	DubbingDirName          = "dubbing"
	DubbingInputFileName    = "dubbing_input.srt"
	DubbingPlanFileName     = "dubbing_plan.json"
	DubbingReportName       = "dubbing_report.json"
	DubSubtitleFileName     = "dub.srt"
	DefaultMaxSubtitleChars = 70
)

type Config struct {
	MinSubtitleDuration   float64
	MaxChunkSize          int
	MaxSubtitleChars      int
	GapTolerance          float64
	SpeedMin              float64
	SpeedAccept           float64
	SpeedMax              float64
	MaxTimingOverrunRatio float64
	EnableTextRewrite     bool
	RewriteMaxAttempts    int
	Estimator             string
}

func DefaultConfig() Config {
	return Config{
		MinSubtitleDuration:   3.0,
		MaxChunkSize:          5,
		MaxSubtitleChars:      DefaultMaxSubtitleChars,
		GapTolerance:          1.5,
		SpeedMin:              0.95,
		SpeedAccept:           1.15,
		SpeedMax:              1.30,
		MaxTimingOverrunRatio: 0.10,
		EnableTextRewrite:     true,
		RewriteMaxAttempts:    3,
		Estimator:             "statistical",
	}
}

type Cue struct {
	Index int
	Start float64
	End   float64
	Text  string
}

func (c Cue) Duration() float64 {
	return c.End - c.Start
}

type PlanItem struct {
	Index                int     `json:"index"`
	CueIndexes           []int   `json:"cue_indexes,omitempty"`
	OriginalStart        float64 `json:"original_start"`
	OriginalEnd          float64 `json:"original_end"`
	NewStart             float64 `json:"new_start"`
	NewEnd               float64 `json:"new_end"`
	OriginalText         string  `json:"original_text"`
	SourceText           string  `json:"source_text,omitempty"`
	CleanText            string  `json:"clean_text"`
	SpokenText           string  `json:"spoken_text"`
	EstimatedDuration    float64 `json:"estimated_duration"`
	EstimateConfidence   float64 `json:"estimate_confidence"`
	ActualDuration       float64 `json:"actual_duration"`
	SourceSpeechDuration float64 `json:"source_speech_duration"`
	TargetSpeechDuration float64 `json:"target_speech_duration"`
	DurationRatio        float64 `json:"duration_ratio"`
	SpeedFactor          float64 `json:"speed_factor"`
	ChunkID              int     `json:"chunk_id"`
	RewriteAttempts      int     `json:"rewrite_attempts"`
	Warning              string  `json:"warning,omitempty"`
}

type Chunk struct {
	ID             int
	Items          []int
	Start          float64
	End            float64
	ActualDuration float64
	SpeedFactor    float64
}

type Report struct {
	Warnings           []string `json:"warnings"`
	FailedIndexes      []int    `json:"failed_indexes"`
	MaxSpeedFactor     float64  `json:"max_speed_factor"`
	RewriteCount       int      `json:"rewrite_count"`
	SemanticMergeCount int      `json:"semantic_merge_count"`
}

type CommandRunner func(args []string) error
type DurationProbe func(path string) (float64, error)
type SpeechBoundsProbe func(path string) (float64, float64, error)

type Dependencies struct {
	TTS            types.Ttser
	Chat           types.ChatCompleter
	Language       types.StandardLanguageCode
	SourceSRT      string
	Voice          string
	Workdir        string
	InputSRT       string
	InputVideo     string
	AudioOnly      bool
	OutputAudio    string
	OutputVideo    string
	Config         Config
	FFmpeg         CommandRunner
	Duration       DurationProbe
	SpeechBounds   SpeechBoundsProbe
	ReportProgress func(completed, total int)
	ReportPhase    func(phase string)
}

type TextOptimizer interface {
	Optimize(ctx context.Context, text string, availableSeconds float64, reason string) (string, error)
}

type SourceAwareTextOptimizer interface {
	OptimizeWithSource(ctx context.Context, sourceText, targetText string, availableSeconds float64, reason string) (string, error)
}

// MeasuredSourceAwareTextOptimizer is the stricter source-aware contract used
// after TTS. It receives the measured target duration so the model can see the
// actual overrun instead of only the subtitle window.
type MeasuredSourceAwareTextOptimizer interface {
	OptimizeWithSourceMeasured(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string) (string, error)
}

type RewriteContext struct {
	OriginalTarget string
	PreviousSource string
	PreviousTarget string
	NextSource     string
	NextTarget     string
}

type ContextualMeasuredTextOptimizer interface {
	OptimizeWithSourceMeasuredContext(ctx context.Context, sourceText, targetText string, availableSeconds, actualSeconds float64, reason string, surrounding RewriteContext) (string, error)
}
