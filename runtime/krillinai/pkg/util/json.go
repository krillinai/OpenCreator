package util

import (
	"encoding/json"
	"strings"
)

// ExtractJSONObject 从大模型返回的文本中提取顶层带有 requiredKey 字段的 JSON 对象。
// 本地模型（如通过 Ollama 运行的 llama3.1）经常在 JSON 前后附带对话式说明，
// 或在 } 、] 之前多输出一个逗号，这两种情况都会让 encoding/json 解析失败。
// 说明里还可能带上示例或解释用的 JSON（如 {} 或 {"note":"..."}），
// 因此这里按顺序扫描文本中的每个完整 JSON 值，只接受顶层带 requiredKey 的对象，
// 避免把示例当成模型真正的回答，从而解析出一个空结果。
// 若文本中没有这样的对象，则原样返回去除首尾空白的输入，
// 让调用方拿到真实的解析错误并走原有的重试逻辑。
func ExtractJSONObject(response, requiredKey string) string {
	trimmed := CleanMarkdownCodeBlock(response)

	for offset := 0; offset < len(trimmed); {
		value, end, ok := extractFirstJSONValue(trimmed, offset)
		if !ok {
			break
		}
		if hasTopLevelKey(value, requiredKey) {
			return value
		}
		offset = end
	}

	return trimmed
}

// extractFirstJSONValue 从 from 开始找到第一个 { 或 [，按嵌套深度取到匹配的结束符，
// 返回该 JSON 值、它在 s 中结束后的下一个位置，以及是否找到完整结构。
// 扫描会跳过字符串字面量中的内容，因此正文里的括号、引号和逗号不会被破坏；
// 结束符前的尾随逗号会被去掉。结构不完整（缺少结束符）时不做猜测。
func extractFirstJSONValue(s string, from int) (string, int, bool) {
	start := strings.IndexAny(s[from:], "{[")
	if start < 0 {
		return "", len(s), false
	}
	start += from

	var (
		builder  strings.Builder
		depth    int
		inString bool
		escaped  bool
	)
	for i := start; i < len(s); i++ {
		c := s[i]

		if inString {
			builder.WriteByte(c)
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			continue
		}

		switch c {
		case '"':
			inString = true
		case '{', '[':
			depth++
		case '}', ']':
			trimTrailingComma(&builder)
			depth--
		}

		builder.WriteByte(c)

		if depth == 0 {
			return builder.String(), i + 1, true
		}
	}

	return "", len(s), false
}

// hasTopLevelKey 判断 value 是不是顶层含有 key 字段的 JSON 对象。
// 数组、标量以及解析失败的内容都不算，嵌套在下层的同名字段也不算。
func hasTopLevelKey(value, key string) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(value), &fields); err != nil {
		return false
	}
	_, ok := fields[key]
	return ok
}

// trimTrailingComma 去掉已写入内容末尾的逗号（含其后的空白），用于容忍结束符前的尾随逗号。
// 末尾没有逗号时保持原内容不变，避免改动合法 JSON 的缩进。
func trimTrailingComma(builder *strings.Builder) {
	current := builder.String()
	cleaned := strings.TrimRight(current, " \t\r\n,")
	if !strings.Contains(current[len(cleaned):], ",") {
		return
	}
	builder.Reset()
	builder.WriteString(cleaned)
}
