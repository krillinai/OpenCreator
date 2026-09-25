package util

import (
	"encoding/json"
	"testing"
)

func TestCleanMarkdownCodeBlock(t *testing.T) {
	cases := []struct {
		name     string
		response string
		want     string
	}{
		{
			name:     "bare json",
			response: `{"align": []}`,
			want:     `{"align": []}`,
		},
		{
			name:     "fenced json without language tag",
			response: "```\n{\"align\": []}\n```",
			want:     `{"align": []}`,
		},
		{
			name:     "fenced json with language tag",
			response: "```json\n{\"align\": []}\n```",
			want:     `{"align": []}`,
		},
		{
			name:     "prose before the fence",
			response: "以下是分割后的结果：\n\n```json\n{\"align\": []}\n```",
			want:     `{"align": []}`,
		},
		{
			name:     "prose before and after the fence",
			response: "Sure! Here you go:\n\n```json\n{\"align\": []}\n```\n\nLet me know if you need more detail.",
			want:     `{"align": []}`,
		},
		{
			name:     "only the first fenced block is used",
			response: "```json\n{\"align\": []}\n```\n\nAnd a second block:\n\n```json\n{\"align\": [1]}\n```",
			want:     `{"align": []}`,
		},
		{
			name:     "fence without closing marker",
			response: "```json\n{\"align\": []}",
			want:     `{"align": []}`,
		},
		{
			name:     "json opened on the fence line",
			response: "```json {\"align\": []}",
			want:     `{"align": []}`,
		},
		{
			name:     "language tag is not part of the body",
			response: "```JSON\n[1]\n```",
			want:     `[1]`,
		},
		{
			name:     "windows line endings",
			response: "```json\r\n{\"align\": []}\r\n```",
			want:     `{"align": []}`,
		},
		{
			name:     "no fence at all",
			response: `{"align": []}`,
			want:     `{"align": []}`,
		},
		{
			name:     "empty response",
			response: "",
			want:     "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CleanMarkdownCodeBlock(tc.response); got != tc.want {
				t.Errorf("CleanMarkdownCodeBlock() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestStripJSONTrailingCommas(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "trailing comma in an object",
			input: `{"a": 1,}`,
			want:  `{"a": 1}`,
		},
		{
			name:  "trailing comma in an array",
			input: `{"a": [1, 2, 3,]}`,
			want:  `{"a": [1, 2, 3]}`,
		},
		{
			name:  "trailing comma in nested values",
			input: "{\n  \"align\": [\n    {\"origin_part\": \"a\",},\n  ],\n}",
			want:  "{\n  \"align\": [\n    {\"origin_part\": \"a\"}\n  ]\n}",
		},
		{
			name:  "only the comma is dropped, the newline after it is kept",
			input: "{\"a\": 1,\n}",
			want:  "{\"a\": 1\n}",
		},
		{
			name:  "comma inside a string literal is kept",
			input: `{"text": "wait, then go"}`,
			want:  `{"text": "wait, then go"}`,
		},
		{
			name:  "trailing comma inside a string literal is kept",
			input: `{"text": "a, }"}`,
			want:  `{"text": "a, }"}`,
		},
		{
			name:  "escaped quote before a comma",
			input: `{"text": "say \"hi\", ok"}`,
			want:  `{"text": "say \"hi\", ok"}`,
		},
		{
			name:  "escaped backslash before a quote",
			input: `{"text": "back\\", "n": 1}`,
			want:  `{"text": "back\\", "n": 1}`,
		},
		{
			name:  "valid json is untouched",
			input: `{"a": [1, 2], "b": {"c": 3}}`,
			want:  `{"a": [1, 2], "b": {"c": 3}}`,
		},
		{
			name:  "no comma at all",
			input: `[1]`,
			want:  `[1]`,
		},
		{
			name:  "truncated input keeps the trailing comma",
			input: `{"a": 1,`,
			want:  `{"a": 1,`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StripJSONTrailingCommas(tc.input); got != tc.want {
				t.Errorf("StripJSONTrailingCommas() = %q, want %q", got, tc.want)
			}
		})
	}
}

// 大模型经常在 ```json 代码块前后附加说明文字，并偶尔输出结尾多余逗号，
// 两者都会让 json.Unmarshal 失败，见 issue #291
func TestCleanLLMJSON(t *testing.T) {
	response := "以下是分割后的结果：\n\n```json\n{\n  \"align\": [\n    {\"origin_part\": \"a\", \"translated_part\": \"A\",},\n  ],\n}\n```\n\n希望有帮助。"

	var splitResult struct {
		Align []struct {
			OriginPart     string `json:"origin_part"`
			TranslatedPart string `json:"translated_part"`
		} `json:"align"`
	}
	if err := json.Unmarshal([]byte(CleanLLMJSON(response)), &splitResult); err != nil {
		t.Fatalf("CleanLLMJSON() produced unparsable JSON %q: %v", CleanLLMJSON(response), err)
	}
	if len(splitResult.Align) != 1 {
		t.Fatalf("expected 1 aligned part, got %d", len(splitResult.Align))
	}
	if splitResult.Align[0].OriginPart != "a" || splitResult.Align[0].TranslatedPart != "A" {
		t.Errorf("unexpected aligned part: %+v", splitResult.Align[0])
	}
}
