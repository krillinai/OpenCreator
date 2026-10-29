package config

import "testing"

func TestDefaultImageConfig(t *testing.T) {
	if Conf.Image.Provider != "openai-compatible" {
		t.Fatalf("Image.Provider = %q, want openai-compatible", Conf.Image.Provider)
	}
	if Conf.Image.Openai.Model == "" {
		t.Fatalf("Image.Openai.Model is empty")
	}
}

func TestDefaultDubbingConfig(t *testing.T) {
	if Conf.Dubbing.MinSubtitleDuration != 2.5 {
		t.Fatalf("MinSubtitleDuration = %v, want 2.5", Conf.Dubbing.MinSubtitleDuration)
	}
	if Conf.Dubbing.MaxChunkSize != 5 {
		t.Fatalf("MaxChunkSize = %d, want 5", Conf.Dubbing.MaxChunkSize)
	}
	if Conf.Dubbing.GapTolerance != 1.5 {
		t.Fatalf("GapTolerance = %v, want 1.5", Conf.Dubbing.GapTolerance)
	}
	if Conf.Dubbing.SpeedMin != 0.95 || Conf.Dubbing.SpeedAccept != 1.15 || Conf.Dubbing.SpeedMax != 1.30 {
		t.Fatalf("speed config = %+v", Conf.Dubbing)
	}
	if !Conf.Dubbing.EnableTextRewrite {
		t.Fatalf("EnableTextRewrite = false, want true")
	}
	if Conf.Dubbing.RewriteMaxAttempts != 2 {
		t.Fatalf("RewriteMaxAttempts = %d, want 2", Conf.Dubbing.RewriteMaxAttempts)
	}
	if Conf.Dubbing.Estimator != "statistical" {
		t.Fatalf("Estimator = %q, want statistical", Conf.Dubbing.Estimator)
	}
}
