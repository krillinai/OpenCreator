package service

import (
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
	"krillin-ai/log"
)

// 最终导出只报告未解决的超长片段，绝不在同一语言内插入换行。
// 分段耗尽时仍交付完整单行内容，不能用折行冒充拆短成功。
func ReportSubtitleLengthFallbacks(paths ...string) error {
	limit := subtitleAcceptedLimit(subtitleTargetLimit())
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		position, overlong := 0, 0
		for _, line := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(line) == "" {
				position = 0
				continue
			}
			position++
			if position > 2 && subtitleTargetLength(line) > limit {
				overlong++
			}
		}
		if overlong > 0 {
			log.GetLogger().Warn("字幕仍有超长单行，已保留完整内容；禁止使用折行兜底",
				zap.String("file", filepath.Base(path)), zap.Int("lines", overlong), zap.Int("limit", limit))
		}
	}
	return nil
}
