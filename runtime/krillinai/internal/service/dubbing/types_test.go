package dubbing

import "testing"

func TestDefaultConfigValues(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.MinSubtitleDuration != 3.0 || cfg.MaxChunkSize != 5 || cfg.MaxSubtitleChars != 70 || cfg.GapTolerance != 1.5 {
		t.Fatalf("DefaultConfig timing = %+v", cfg)
	}
	if cfg.SpeedMin != 0.95 || cfg.SpeedAccept != 1.15 || cfg.SpeedMax != 1.30 || cfg.MaxTimingOverrunRatio != 0.10 {
		t.Fatalf("DefaultConfig speed = %+v", cfg)
	}
	if !cfg.EnableTextRewrite || cfg.RewriteMaxAttempts != 3 || cfg.Estimator != "statistical" {
		t.Fatalf("DefaultConfig rewrite = %+v", cfg)
	}
}

func TestCueDuration(t *testing.T) {
	cue := Cue{Start: 1.25, End: 3.75}
	if cue.Duration() != 2.5 {
		t.Fatalf("Duration() = %v, want 2.5", cue.Duration())
	}
}
