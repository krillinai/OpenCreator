package dubbing

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
)

type segmentCache string

func (cache segmentCache) path(item *PlanItem, voice string) string {
	if cache == "" {
		return ""
	}
	key, _ := json.Marshal([]any{item.Index, item.SpokenText, voice})
	digest := sha256.Sum256(key)
	return filepath.Join(string(cache), hex.EncodeToString(digest[:])+".segment")
}

func restoreSegment(path, output string) bool {
	if path == "" {
		return false
	}
	record, err := os.ReadFile(path)
	if err != nil || len(record) <= sha256.Size {
		return false
	}
	audio := record[sha256.Size:]
	digest := sha256.Sum256(audio)
	return bytes.Equal(record[:sha256.Size], digest[:]) && os.WriteFile(output, audio, 0600) == nil
}

func saveSegment(path, output string) {
	if path == "" {
		return
	}
	audio, err := os.ReadFile(output)
	if err != nil || len(audio) == 0 {
		return
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return
	}
	temp, err := os.CreateTemp(dir, ".segment-*")
	if err != nil {
		return
	}
	defer os.Remove(temp.Name())
	digest := sha256.Sum256(audio)
	_, writeErr := temp.Write(append(digest[:], audio...))
	if closeErr := temp.Close(); writeErr == nil && closeErr == nil {
		_ = os.Rename(temp.Name(), path)
	}
}
