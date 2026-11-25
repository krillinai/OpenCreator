package util

import (
	"fmt"
	"go.uber.org/zap"
	"io"
	"krillin-ai/config"
	"krillin-ai/log"
	"net/http"
	"os"
	"time"
)

// 用于显示下载进度，实现io.Writer
type progressWriter struct {
	Total      uint64
	Downloaded uint64
	StartTime  time.Time
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.Downloaded += uint64(n)

	// 初始化开始时间
	if pw.StartTime.IsZero() {
		pw.StartTime = time.Now()
	}

	percent := float64(pw.Downloaded) / float64(pw.Total) * 100
	elapsed := time.Since(pw.StartTime).Seconds()
	speed := float64(pw.Downloaded) / 1024 / 1024 / elapsed

	fmt.Printf("\r下载进度: %.2f%% (%.2f MB / %.2f MB) | 速度: %.2f MB/s",
		percent,
		float64(pw.Downloaded)/1024/1024,
		float64(pw.Total)/1024/1024,
		speed)

	return n, nil
}

// DownloadFile 下载文件并保存到指定路径，支持代理
func DownloadFile(urlStr, filepath, proxyAddr string) error {
	log.GetLogger().Info("开始下载文件", zap.String("url", urlStr))
	client := &http.Client{}
	if proxyAddr != "" {
		client.Transport = &http.Transport{
			Proxy: http.ProxyURL(config.Conf.App.ParsedProxy),
		}
	}

	resp, err := client.Get(urlStr)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载失败: %s 返回状态码 %d", urlStr, resp.StatusCode)
	}

	size := resp.ContentLength
	fmt.Printf("文件大小: %.2f MB\n", float64(size)/1024/1024)

	out, err := os.Create(filepath)
	if err != nil {
		return err
	}

	// 带有进度的 Reader
	progress := &progressWriter{
		Total: uint64(size),
	}
	reader := io.TeeReader(resp.Body, progress)

	_, err = io.Copy(out, reader)
	closeErr := out.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		// 不留下半截文件，否则后续 os.Stat 检查会误以为已下载
		_ = os.Remove(filepath)
		return err
	}
	fmt.Printf("\n") // 进度信息结束，换新行

	log.GetLogger().Info("文件下载完成", zap.String("路径", filepath))
	return nil
}
