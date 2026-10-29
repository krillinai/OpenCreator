package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"os"
	"path/filepath"
	"strconv"

	"go.uber.org/zap"
)

type translationCheckpoint struct {
	dir       string
	sentences map[string]pairedSentence
}

func (t *Translator) withTranslationRecovery(workdir string, task *types.SubtitleTask) *Translator {
	// Translator 可供多个任务共用，任务路径和回调必须放在副本上。
	copy := *t
	copy.checkpointDir = workdir
	if task != nil {
		copy.onRecovery = func(message string) {
			task.ReportTranslationRecovery(message)
		}
	}
	return &copy
}

func (t *Translator) openTranslationCheckpoint(texts []string, originLang, targetLang types.StandardLanguageCode) (*translationCheckpoint, error) {
	checkpoint := &translationCheckpoint{sentences: make(map[string]pairedSentence)}
	if t.checkpointDir == "" || len(texts) == 0 {
		return checkpoint, nil
	}
	// 排版目标和批次大小不进入内容指纹；重新排版可以复用已取得的完整译文。
	identity, err := json.Marshal(struct {
		Version, SourceLanguage, TargetLanguage, Model, Endpoint, Prompt string
		FilterFillers                                                    bool
		Texts                                                            []string
	}{"paired-recovery-v1", string(originLang), string(targetLang), config.Conf.Llm.Model, config.Conf.Llm.BaseUrl, pairedTranslationPrompt, t.filterNonSemanticFillers, texts})
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(identity)
	checkpoint.dir = filepath.Join(t.checkpointDir, "translation-checkpoints", hex.EncodeToString(hash[:]))
	if _, err := os.Stat(checkpoint.dir); os.IsNotExist(err) {
		return checkpoint, nil
	}
	for i := range texts {
		id := strconv.Itoa(i + 1)
		data, err := os.ReadFile(filepath.Join(checkpoint.dir, id+".json"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("读取翻译检查点失败: %w", err)
		}
		var sentence pairedSentence
		if err := json.Unmarshal(data, &sentence); err != nil {
			log.GetLogger().Warn("单句翻译检查点损坏，将重新翻译该句", zap.String("sentence_id", id), zap.Error(err))
			continue
		}
		checkpoint.sentences[id] = sentence
	}
	return checkpoint, nil
}

// 调用方序列化 save，原子替换防止进程退出留下半份 JSON。
func (c *translationCheckpoint) save(sentence pairedSentence) error {
	c.sentences[sentence.ID] = sentence
	if c.dir == "" {
		return nil
	}
	if err := os.MkdirAll(c.dir, 0700); err != nil {
		return fmt.Errorf("创建翻译检查点目录失败: %w", err)
	}
	// 单句原子落盘，避免长视频每完成一句都重写整份翻译结果。
	data, err := json.Marshal(sentence)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(c.dir, ".translation-*.tmp")
	if err != nil {
		return fmt.Errorf("创建翻译检查点失败: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(file.Name(), filepath.Join(c.dir, sentence.ID+".json"))
	}
	if err != nil {
		return fmt.Errorf("保存翻译检查点失败: %w", err)
	}
	return nil
}
