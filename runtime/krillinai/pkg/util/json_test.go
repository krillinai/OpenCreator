package util

import "testing"

func TestExtractJSONObject(t *testing.T) {
	tests := []struct {
		name     string
		response string
		key      string
		want     string
	}{
		{
			name:     "prefix",
			response: "以下是分割后的结果：\n\n\n{\n  \"align\": [\n    { \"origin_part\": \"I want to show you\" }\n  ]\n}\n",
			key:      "align",
			want:     "{\n  \"align\": [\n    { \"origin_part\": \"I want to show you\" }\n  ]\n}",
		},
		{
			name:     "suffix",
			response: "{\"short_sentences\":[{\"text\":\"a\"}]}\n\n希望这个结果对你有帮助！",
			key:      "short_sentences",
			want:     `{"short_sentences":[{"text":"a"}]}`,
		},
		{
			name:     "object trailing comma",
			response: "{\n\"short_sentences\":[{\n\"text\": \"the owl is a symbol\",\n\t}] \n}",
			key:      "short_sentences",
			want:     "{\n\"short_sentences\":[{\n\"text\": \"the owl is a symbol\"}] \n}",
		},
		{
			name:     "array trailing comma",
			response: `{"short_sentences":[{"text":"a"},{"text":"b"}, ]}`,
			key:      "short_sentences",
			want:     `{"short_sentences":[{"text":"a"},{"text":"b"}]}`,
		},
		{
			name:     "nested trailing commas",
			response: `{"a":{"b":[{"c":1},,]},}`,
			key:      "a",
			want:     `{"a":{"b":[{"c":1}]}}`,
		},
		{
			name:     "crlf trailing comma",
			response: "{\r\n\"a\": 1,\r\n}",
			key:      "a",
			want:     "{\r\n\"a\": 1}",
		},
		{
			name:     "fence",
			response: "以下是分割后的结果：\n```json\n{\"short_sentences\":[{\"text\":\"a\"},]}\n```",
			key:      "short_sentences",
			want:     `{"short_sentences":[{"text":"a"}]}`,
		},
		{
			name:     "decoys",
			response: `例如 [] 或 {} 或 {"text":"x"}，实际结果：{"translations":[{"index":1,"text":"一"}]}`,
			key:      "translations",
			want:     `{"translations":[{"index":1,"text":"一"}]}`,
		},
		{
			name:     "first carrier",
			response: `{"align":[{"origin_part":"a"}]} {"align":[{"origin_part":"b"}]}`,
			key:      "align",
			want:     `{"align":[{"origin_part":"a"}]}`,
		},
		{
			name:     "empty value",
			response: `{"align":[]} {"align":[{"origin_part":"a"}]}`,
			key:      "align",
			want:     `{"align":[]}`,
		},
		{
			name:     "null value",
			response: `{"align":null} {"align":[{"origin_part":"a"}]}`,
			key:      "align",
			want:     `{"align":null}`,
		},
		{
			name:     "key case",
			response: `{"Align":[{"origin_part":"a"}]} {"align":[{"origin_part":"b"}]}`,
			key:      "align",
			want:     `{"align":[{"origin_part":"b"}]}`,
		},
		{
			name:     "nested key",
			response: `{"data":{"align":[9]}} {"align":[{"origin_part":"a"}]}`,
			key:      "align",
			want:     `{"align":[{"origin_part":"a"}]}`,
		},
		{
			name:     "top-level array",
			response: `[{"align":[9]}] {"align":[{"origin_part":"a"}]}`,
			key:      "align",
			want:     `{"align":[{"origin_part":"a"}]}`,
		},
		{
			name:     "brace in decoy string",
			response: `{"note":"{"} 结果：{"align":[{"origin_part":"a"}]}`,
			key:      "align",
			want:     `{"align":[{"origin_part":"a"}]}`,
		},
		{
			name:     "escapes in string",
			response: `{"text":"he said \"} \" then \\",}`,
			key:      "text",
			want:     `{"text":"he said \"} \" then \\"}`,
		},
		{
			name:     "comma in string",
			response: `{"text":"see [a, b, ]"}`,
			key:      "text",
			want:     `{"text":"see [a, b, ]"}`,
		},
		{
			name:     "full-width comma",
			response: `{"align":[1]，} {"align":[{"origin_part":"a"}]}`,
			key:      "align",
			want:     `{"align":[{"origin_part":"a"}]}`,
		},
		{
			name:     "incomplete",
			response: `{"short_sentences":[{"text":"a"}`,
			key:      "short_sentences",
			want:     `{"short_sentences":[{"text":"a"}`,
		},
		{
			name:     "no json",
			response: "  抱歉，我无法完成这个请求  ",
			key:      "short_sentences",
			want:     "抱歉，我无法完成这个请求",
		},
		{
			name:     "no carrier in fence",
			response: "```json\n{\"note\":\"x\"}\n```",
			key:      "align",
			want:     `{"note":"x"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractJSONObject(tt.response, tt.key); got != tt.want {
				t.Errorf("ExtractJSONObject() = %q, want %q", got, tt.want)
			}
		})
	}
}
