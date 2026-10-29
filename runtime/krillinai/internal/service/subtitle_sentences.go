package service

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/clipperhouse/uax29/v2/sentences"
)

// 保留首字母缩写中的原始空白和字节坐标；只保护内部句界，末尾的点仍可能结束一句。
var subtitleInitialismPattern = regexp.MustCompile(`\p{Lu}\.(?:[\t \p{Zs}]*\p{Lu}\.)+`)

func splitTranslationSentenceForBudget(text string, maxBytes, limit int) ([]string, error) {
	text = strings.TrimSpace(text)
	// 整句能安全提交时，不为旧的固定片段大小制造额外语义接缝。
	if len(text) <= maxBytes && pairedTranslationResponseBudget(text, limit) <= translationOutputBudget {
		return []string{text}, nil
	}
	// 必须拆分时沿用原来的片段大小，避免把切口后移成只有一两个词的尾段。
	maxBytes = min(maxBytes, 800)
	initialisms := subtitleInitialismPattern.FindAllStringIndex(text, -1)
	return splitSubtitleTextAtBoundaries(text, func(part string) bool {
		return len(part) <= maxBytes && pairedTranslationResponseBudget(part, limit) <= translationOutputBudget
	}, func(cut int) bool {
		index := sort.Search(len(initialisms), func(i int) bool { return initialisms[i][1] >= cut })
		return index == len(initialisms) || cut <= initialisms[index][0] || cut == initialisms[index][1]
	})
}

func splitTranslationSentences(text string) []string {
	initialisms := subtitleInitialismPattern.FindAllStringIndex(text, -1)
	var result []string
	start := 0
	iter := sentences.FromString(text)
	for iter.Next() {
		end := iter.End()
		if subtitleBoundaryContinuesAbbreviation(text, start, end, initialisms) {
			continue
		}
		if sentence := strings.TrimSpace(text[start:end]); sentence != "" {
			result = append(result, sentence)
		}
		start = end
	}
	if tail := strings.TrimSpace(text[start:]); tail != "" {
		result = append(result, tail)
	}
	return result
}

func subtitleBoundaryContinuesAbbreviation(text string, start, end int, initialisms [][]int) bool {
	next := strings.TrimSpace(text[end:])
	if next == "" {
		return false
	}
	left := strings.TrimRightFunc(text[start:end], unicode.IsSpace)
	// 闭引号、括号后的句界沿用 Unicode 判断，不能因引文末尾是缩写而吞并后句。
	if !strings.HasSuffix(left, ".") {
		return false
	}
	period := start + len(left) - 1
	first, _ := utf8.DecodeRuneInString(next)
	if index := sort.Search(len(initialisms), func(i int) bool { return initialisms[i][1] > period }); index < len(initialisms) && initialisms[index][0] <= period {
		span := initialisms[index]
		if period < span[1]-1 {
			return true
		}
		if period == span[1]-1 {
			// 句首连续首字母与随后的姓名连读；有完整前文的缩写保留其末尾句界。
			return !hasSubtitleContent(text[start:span[0]]) && unicode.IsUpper(first)
		}
	}
	fields := strings.Fields(left)
	if len(fields) == 0 {
		return false
	}
	last := fields[len(fields)-1]
	switch strings.ToLower(last) {
	case "no.":
		// No. 5 是编号；No. YouTube ... 中的 No 是独立否定句。
		return unicode.IsDigit(first)
	case "etc.", "inc.", "ltd.", "corp.", "co.", "jr.":
		// 这类后缀可位于真实句末，不再无条件合并下一句。
		return false
	}
	if subtitleAbbreviations[strings.ToLower(last)] {
		return true
	}
	initial, size := utf8.DecodeRuneInString(last)
	return unicode.IsUpper(initial) && last[size:] == "." && unicode.IsUpper(first)
}
