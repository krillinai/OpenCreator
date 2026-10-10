package util

import (
	"net/url"
	"strings"
)

func IsYouTubeURL(input string) bool {
	parsed, err := url.Parse(strings.TrimSpace(input))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return false
	}
	hostname := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	return hostname == "youtu.be" ||
		hostname == "youtube.com" || strings.HasSuffix(hostname, ".youtube.com") ||
		hostname == "youtube-nocookie.com" || strings.HasSuffix(hostname, ".youtube-nocookie.com")
}
