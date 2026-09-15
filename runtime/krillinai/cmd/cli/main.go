package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"krillin-ai/config"
	"krillin-ai/internal/cli"
	"krillin-ai/internal/deps"
	"krillin-ai/internal/pipeline"
	"krillin-ai/internal/service"
	"krillin-ai/log"
	"os"
	"sync"
)

func main() {
	log.InitLogger()
	defer log.GetLogger().Sync()
	output := &jsonLineWriter{output: os.Stdout}

	cmd, err := cli.Parse(os.Args[1:])
	if err != nil {
		writeAndExit(output, errorResponse(err, pipeline.ErrorKindUsage))
	}
	if cmd.Help {
		fmt.Print(cli.Help(cmd))
		return
	}
	if cmd.Name == "voices" {
		_ = config.LoadConfig()
		_ = config.CheckBaseConfig()
		writeAndExit(output, cli.Execute(context.Background(), nil, cmd))
		return
	}
	if cmd.DryRun {
		writeAndExit(output, cli.Execute(context.Background(), nil, cmd))
		return
	}
	configureOpenCreatorProgress(&cmd, output)

	if !config.LoadConfig() {
		writeAndExit(output, pipeline.Response{
			OK: false,
			Error: &pipeline.Error{
				Kind:    pipeline.ErrorKindUsage,
				Code:    "config_not_found",
				Message: "未找到配置文件",
			},
		})
	}
	if err := config.CheckBaseConfig(); err != nil {
		writeAndExit(output, errorResponse(err, pipeline.ErrorKindUsage))
	}
	if cmd.Name == "speech" {
		if err := config.ValidateTTSConfig(); err != nil {
			writeAndExit(output, errorResponse(err, pipeline.ErrorKindUsage))
		}
		writeAndExit(output, cli.Execute(context.Background(), nil, cmd))
		return
	}
	if requiresTranscriptionAtStart(cmd) {
		if err := config.ValidateTranscriptionConfig(); err != nil {
			writeAndExit(output, errorResponse(err, pipeline.ErrorKindUsage))
		}
	}
	if err := deps.CheckCoreDependencies(); err != nil {
		writeAndExit(output, errorResponse(err, pipeline.ErrorKindDependency))
	}
	if requiresTranscriptionAtStart(cmd) {
		if err := deps.CheckTranscriptionDependency(); err != nil {
			writeAndExit(output, errorResponse(err, pipeline.ErrorKindDependency))
		}
	}
	if cmd.Name == "tts" {
		if err := config.ValidateTTSConfig(); err != nil {
			writeAndExit(output, errorResponse(err, pipeline.ErrorKindUsage))
		}
		if err := deps.CheckTTSDependency(); err != nil {
			writeAndExit(output, errorResponse(err, pipeline.ErrorKindDependency))
		}
	}
	svc := service.NewService()
	adapter := pipeline.NewServiceAdapter(svc)
	writeAndExit(output, cli.Execute(context.Background(), adapter, cmd))
}

type progressFrame struct {
	Type    string `json:"type"`
	Phase   string `json:"phase"`
	Percent int    `json:"percent"`
	Message string `json:"message,omitempty"`
}

type jsonLineWriter struct {
	mu     sync.Mutex
	output io.Writer
}

func (w *jsonLineWriter) Write(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	_, err = fmt.Fprintln(w.output, string(data))
	return err
}

func configureOpenCreatorProgress(cmd *cli.Command, output *jsonLineWriter) {
	if os.Getenv("OPENCREATOR_KRILLINAI_CLI") != "1" {
		return
	}
	writeProgress := func(previous func(string, int, string)) func(string, int, string) {
		return func(phase string, percent int, message string) {
			if previous != nil {
				previous(phase, percent, message)
			}
			_ = output.Write(progressFrame{
				Type:    "progress",
				Phase:   phase,
				Percent: percent,
				Message: message,
			})
		}
	}
	switch cmd.Name {
	case "subtitle":
		cmd.Subtitle.ReportProgress = writeProgress(cmd.Subtitle.ReportProgress)
	case "tts":
		cmd.TTS.ReportProgress = writeProgress(cmd.TTS.ReportProgress)
	}
}

func requiresTranscriptionAtStart(cmd cli.Command) bool {
	if cmd.Name != "subtitle" || cmd.Subtitle.InputSRT != "" {
		return false
	}
	if cmd.Subtitle.CaptionSource == pipeline.CaptionSourceWhisper {
		return true
	}
	return !pipeline.IsYouTubeInput(cmd.Subtitle.Input)
}

func errorResponse(err error, kind pipeline.ErrorKind) pipeline.Response {
	return pipeline.Response{
		OK: false,
		Error: &pipeline.Error{
			Kind:      kind,
			Code:      string(kind),
			Message:   err.Error(),
			Retryable: kind == pipeline.ErrorKindRetryable,
		},
	}
}

func writeAndExit(output *jsonLineWriter, resp pipeline.Response) {
	if err := output.Write(resp); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, `{"ok":false,"error":{"kind":"internal","code":"json_marshal_failed","message":%q}}`+"\n", err.Error())
		os.Exit(1)
	}
	if !resp.OK {
		os.Exit(pipeline.ExitCodeForError(resp.Error))
	}
}
