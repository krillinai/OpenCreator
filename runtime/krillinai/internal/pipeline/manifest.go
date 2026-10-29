package pipeline

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const ManifestFileName = "krillinai_manifest.json"

type StageStatus struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Updated string `json:"updated,omitempty"`
}

type Manifest struct {
	TaskID         string                 `json:"task_id"`
	Workdir        string                 `json:"workdir"`
	InputURL       string                 `json:"input_url,omitempty"`
	OriginLanguage string                 `json:"origin_language,omitempty"`
	TargetLanguage string                 `json:"target_language,omitempty"`
	CaptionSource  string                 `json:"caption_source,omitempty"`
	Provider       map[string]string      `json:"provider,omitempty"`
	Outputs        Outputs                `json:"outputs"`
	Warnings       []string               `json:"warnings,omitempty"`
	FailedIndexes  []int                  `json:"failed_indexes,omitempty"`
	Stages         map[string]StageStatus `json:"stages"`
}

func NewManifest(taskID, workdir string) *Manifest {
	return &Manifest{
		TaskID:   taskID,
		Workdir:  workdir,
		Provider: map[string]string{},
		Stages:   map[string]StageStatus{},
	}
}

func ManifestPath(workdir string) string {
	return filepath.Join(workdir, ManifestFileName)
}

func LoadManifest(workdir string) (*Manifest, error) {
	data, err := os.ReadFile(ManifestPath(workdir))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	if m.Provider == nil {
		m.Provider = map[string]string{}
	}
	if m.Stages == nil {
		m.Stages = map[string]StageStatus{}
	}
	return &m, nil
}

func (m *Manifest) Save() error {
	if err := os.MkdirAll(m.Workdir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	path := ManifestPath(m.Workdir)
	temp, err := os.CreateTemp(m.Workdir, ".krillinai-manifest-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if _, err := temp.Write(append(data, '\n')); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return err
	}
	if dir, err := os.Open(m.Workdir); err == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

func (m *Manifest) ApplyDefaultOutputs() error {
	if err := os.MkdirAll(filepath.Join(m.Workdir, "output"), 0755); err != nil {
		return err
	}
	m.Outputs.OriginVideo = filepath.Join(m.Workdir, "origin_video.mp4")
	m.Outputs.OriginAudio = filepath.Join(m.Workdir, "origin_audio.mp3")
	m.Outputs.OriginSRT = filepath.Join(m.Workdir, "origin_language_srt.srt")
	m.Outputs.TargetSRT = filepath.Join(m.Workdir, "target_language_srt.srt")
	m.Outputs.BilingualSRT = filepath.Join(m.Workdir, "bilingual_srt.srt")
	m.Outputs.ShortOriginSRT = filepath.Join(m.Workdir, "short_origin_srt.srt")
	m.Outputs.ShortOriginMixedSRT = filepath.Join(m.Workdir, "short_origin_mixed_srt.srt")
	m.Outputs.TTSAudio = filepath.Join(m.Workdir, "tts_final_audio.wav")
	m.Outputs.VideoWithTTS = filepath.Join(m.Workdir, "video_with_tts.mp4")
	m.Outputs.HorizontalVideo = filepath.Join(m.Workdir, "horizontal_bilingual.mp4")
	m.Outputs.VerticalVideo = filepath.Join(m.Workdir, "vertical_bilingual.mp4")
	m.Outputs.TransferredVideo = filepath.Join(m.Workdir, "transferred_vertical_video.mp4")
	m.Outputs.OriginCover = filepath.Join(m.Workdir, "origin_cover.jpg")
	m.Outputs.GeneratedCover = filepath.Join(m.Workdir, "generated_cover.png")
	m.Outputs.FinalCoverPrompt = filepath.Join(m.Workdir, "cover_prompt.final.txt")
	m.Outputs.OriginText = filepath.Join(m.Workdir, "output", "origin_language.txt")
	m.Outputs.TargetText = filepath.Join(m.Workdir, "output", "target_language.txt")
	return nil
}

func (m *Manifest) MarkStage(stage Stage, ok bool, msg string) {
	m.Stages[string(stage)] = StageStatus{OK: ok, Error: msg}
}
