package util

import "testing"

func TestIsYouTubeURL(t *testing.T) {
	for _, test := range []struct {
		input string
		want  bool
	}{
		{"https://youtu.be/1_iv-S02hJ0?si=example", true},
		{"https://www.youtube.com/watch?v=1_iv-S02hJ0", true},
		{"https://m.youtube.com/shorts/1_iv-S02hJ0", true},
		{" https://YOUTU.BE./1_iv-S02hJ0 ", true},
		{"https://www.youtube-nocookie.com/embed/1_iv-S02hJ0", true},
		{"https://youtube.com.example.test/watch?v=demo", false},
		{"https://example.test/youtube.com/watch?v=demo", false},
		{"https://example.test/?url=https://youtube.com", false},
		{"file://youtube.com/demo", false},
		{"local:youtube.com.mp4", false},
		{"invalid", false},
	} {
		t.Run(test.input, func(t *testing.T) {
			if got := IsYouTubeURL(test.input); got != test.want {
				t.Fatalf("IsYouTubeURL(%q) = %v, want %v", test.input, got, test.want)
			}
		})
	}
}
