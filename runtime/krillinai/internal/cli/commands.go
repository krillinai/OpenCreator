package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"krillin-ai/config"
	"krillin-ai/internal/pipeline"
	subtitlestyle "krillin-ai/internal/subtitle_style"
	"krillin-ai/internal/ttsprovider"
	"krillin-ai/internal/types"
	"krillin-ai/internal/voices"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const defaultSubtitleStylePath = "config/subtitle-style-default.json"

type subtitleStyleLoadError struct {
	err  error
	user bool
}

func (e subtitleStyleLoadError) Error() string {
	if e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e subtitleStyleLoadError) Unwrap() error {
	return e.err
}

func userStyleLoadError(err error) error {
	return subtitleStyleLoadError{err: err, user: true}
}

func defaultStyleLoadError(err error) error {
	return subtitleStyleLoadError{err: err}
}

type Command struct {
	Name              string
	Help              bool
	DryRun            bool
	SubtitleStyleFile string
	Subtitle          pipeline.SubtitleRequest
	TTS               pipeline.TTSRequest
	Speech            SpeechRequest
	Render            pipeline.RenderRequest
	Cover             pipeline.CoverRequest
	Pipeline          pipeline.PipelineRequest
	Voices            VoicesRequest
}

type VoicesRequest struct {
	Provider string
}

type SpeechRequest struct {
	Text         string
	TextFile     string
	Output       string
	Provider     string
	Voice        string
	Format       string
	Speed        float64
	Instructions string
}

func Parse(args []string) (Command, error) {
	if len(args) == 0 {
		return Command{}, errors.New("missing command")
	}
	name := args[0]
	if isHelpArg(name) {
		return Command{Help: true}, nil
	}
	switch name {
	case "subtitle":
		return parseSubtitle(name, args[1:])
	case "tts":
		return parseTTS(name, args[1:])
	case "speech":
		return parseSpeech(name, args[1:])
	case "render-horizontal":
		return parseRender(name, args[1:], true)
	case "render-vertical":
		return parseRender(name, args[1:], false)
	case "pipeline":
		return parsePipeline(name, args[1:])
	case "cover":
		return parseCover(name, args[1:])
	case "voices":
		return parseVoices(name, args[1:])
	case "status":
		if hasHelpArg(args[1:]) {
			return Command{Name: name, Help: true}, nil
		}
		return Command{Name: name}, nil
	default:
		return Command{}, fmt.Errorf("unknown command: %s", name)
	}
}

func Help(cmd Command) string {
	switch cmd.Name {
	case "subtitle":
		return `Usage:
  krillinai-cli subtitle <input> --origin-lang <lang> --target-lang <lang> --workdir <dir> [flags]

Flags:
  --origin-lang <lang>       Source language, such as en, zh, ja
  --target-lang <lang>       Target language, such as zh_cn
  --user-lang <lang>         UI language for generated messages
  --workdir <dir>            Task working directory
  --task-id <id>             Optional task id
  --caption-source <source>  any, platform, manual, auto, or whisper
  --prepare-video            download original video for later rendering
  --source-only              generate source-language subtitles without translation
  --input-srt <file>         use existing UTF-8 SRT instead of transcription
  --srt-translated           input SRT is already translated; skip translation
  --bilingual-top            Put target subtitle on top (default true)
  --max-word-one-line <n>    Max words per subtitle line
  --subtitle-style-file <file>  JSON subtitle style override file
  --dry-run                  Validate command without external calls
  -h, --help                 Show this help
`
	case "tts":
		return `Usage:
  krillinai-cli tts --workdir <dir> --input-srt <file> [flags]

Flags:
  --workdir <dir>                 Task working directory
  --task-id <id>                  Optional task id
  --input-srt <file>              SRT file to synthesize
  --line-mode <mode>              target-only, bilingual-target-top, or bilingual-target-bottom
  --video <file>                  Optional source video for dubbed output
  --voice <voice>                 Provider-specific voice
  --voice-clone-source <source>   Optional voice clone source
  --dry-run                       Validate and write manifest without external calls
  -h, --help                      Show this help
`
	case "speech":
		return `Usage:
  krillinai-cli speech (--text <text> | --text-file <file>) --output <file> [flags]

Flags:
  --text <text>          Text to synthesize
  --text-file <file>     UTF-8 text file to synthesize
  --output <file>        Output audio file
  --provider <name>      aliyun, openai, or minimax; default current config
  --voice <voice>        Provider-specific voice
  --format <format>      wav or mp3; defaults from output extension
  --speed <value>        Speaking rate from 0.5 to 2.0 (default 1)
  --instructions <text>  Delivery instructions when supported by the provider
  --dry-run              Validate command without external calls
  -h, --help             Show this help
`
	case "render-horizontal":
		return `Usage:
  krillinai-cli render-horizontal --workdir <dir> --video <file> --subtitle <file> [flags]

Flags:
  --workdir <dir>       Task working directory
  --task-id <id>        Optional task id
  --video <file>        Input video
  --audio <file>        Optional input audio
  --subtitle <file>     Subtitle file to burn in
  --subtitle-style-file <file>  JSON subtitle style override file
  --dubbed              Render dubbed variant
  --dry-run             Validate command without external calls
  -h, --help            Show this help
`
	case "render-vertical":
		return `Usage:
  krillinai-cli render-vertical --workdir <dir> --video <file> --subtitle <file> [flags]

Flags:
  --workdir <dir>       Task working directory
  --task-id <id>        Optional task id
  --video <file>        Input video
  --audio <file>        Optional input audio
  --subtitle <file>     Subtitle file to burn in
  --subtitle-style-file <file>  JSON subtitle style override file
  --dubbed              Render dubbed variant
  --major-title <text>  Vertical video major title
  --minor-title <text>  Vertical video minor title
  --dry-run             Validate command without external calls
  -h, --help            Show this help
`
	case "pipeline":
		return `Usage:
  krillinai-cli pipeline --outputs <list> [flags]

Flags:
  --outputs <list>  Comma-separated outputs, such as subtitle,tts,vertical-bilingual
  --async           Run asynchronously when supported
  --dry-run         Validate requested outputs
  -h, --help        Show this help
`
	case "cover":
		return `Usage:
  krillinai-cli cover --workdir <dir> --prompt <text> [flags]

Flags:
  --workdir <dir>   Task working directory
  --task-id <id>    Optional task id
  --prompt <text>   Prompt for GPT image cover generation
  --size <size>     Image size, such as 1024x1024 or 1536x1024
  --dry-run         Validate and write manifest without external calls
  -h, --help        Show this help
`
	case "voices":
		return `Usage:
  krillinai-cli voices [flags]

Flags:
  --provider <name>  TTS provider to list voices for: aliyun, openai, minimax, or edge-tts; default current config
  --dry-run          Return the same local voice list without external calls
  -h, --help         Show this help
`
	case "status":
		return `Usage:
  krillinai-cli status

Status query is a reserved/planned CLI surface in the current implementation.
`
	default:
		return `Usage:
  krillinai-cli <command> [flags]

Commands:
  subtitle             Generate source, target, bilingual, and short vertical subtitles
  tts                  Generate target-language dubbing from SRT subtitles
  speech               Generate audio from plain text
  render-horizontal    Render landscape subtitle or dubbed videos
  render-vertical      Render portrait subtitle or dubbed videos
  pipeline             Plan or run multi-stage workflows when supported
  cover                Generate a cover image from a prompt
  voices               List available TTS voice codes
  status               Reserved status query surface

Run "krillinai-cli <command> --help" for command-specific flags.
`
	}
}

func Execute(ctx context.Context, svc pipeline.StageService, cmd Command) pipeline.Response {
	if cmd.DryRun {
		return dryRun(cmd)
	}
	switch cmd.Name {
	case "subtitle":
		style, err := loadSubtitleStyleForCLI(cmd.SubtitleStyleFile)
		if err != nil {
			return styleLoadFailure(pipeline.StageSubtitle, cmd.Subtitle.Workdir, cmd.Subtitle.TaskID, err)
		}
		cmd.Subtitle.SubtitleStyle = style
		resp, err := pipeline.GenerateSubtitles(ctx, svc, cmd.Subtitle)
		return responseWithError(resp, err)
	case "tts":
		resp, err := pipeline.GenerateTTS(ctx, svc, cmd.TTS)
		return responseWithError(resp, err)
	case "speech":
		return executeSpeech(ctx, cmd.Speech)
	case "render-horizontal", "render-vertical":
		style, err := loadSubtitleStyleForCLI(cmd.SubtitleStyleFile)
		if err != nil {
			return styleLoadFailure(renderStageFromCommand(cmd.Name), cmd.Render.Workdir, cmd.Render.TaskID, err)
		}
		cmd.Render.SubtitleStyle = style
		resp, err := pipeline.Render(ctx, svc, cmd.Render)
		return responseWithError(resp, err)
	case "cover":
		resp, err := pipeline.GenerateCover(ctx, svc, cmd.Cover)
		return responseWithError(resp, err)
	case "voices":
		return executeVoices(cmd.Voices)
	default:
		return pipeline.Response{
			OK: false,
			Error: &pipeline.Error{
				Kind:    pipeline.ErrorKindUsage,
				Code:    "unsupported_command",
				Message: fmt.Sprintf("unsupported command: %s", cmd.Name),
			},
		}
	}
}

func parseVoices(name string, args []string) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	provider := fs.String("provider", "", "tts provider")
	dryRun := fs.Bool("dry-run", false, "return local voice list without external calls")
	if err := fs.Parse(args); err != nil {
		return Command{}, err
	}
	if fs.NArg() != 0 {
		return Command{}, errors.New("voices does not accept positional arguments")
	}
	return Command{
		Name:   name,
		DryRun: *dryRun,
		Voices: VoicesRequest{
			Provider: *provider,
		},
	}, nil
}

func executeVoices(req VoicesRequest) pipeline.Response {
	provider := strings.TrimSpace(req.Provider)
	if provider == "" {
		provider = currentTTSProvider()
	}
	list, err := voices.List(context.Background(), provider)
	if err != nil {
		return pipeline.Response{
			OK:    false,
			Stage: pipeline.StageVoices,
			Inputs: map[string]string{
				"provider": provider,
			},
			Error: &pipeline.Error{
				Kind:    pipeline.ErrorKindUsage,
				Code:    "list_voices_failed",
				Message: err.Error(),
			},
		}
	}
	return pipeline.Response{
		OK:    true,
		Stage: pipeline.StageVoices,
		Inputs: map[string]string{
			"provider": provider,
		},
		Voices: list,
	}
}

func parseSpeech(name string, args []string) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	text := fs.String("text", "", "text")
	textFile := fs.String("text-file", "", "text file")
	output := fs.String("output", "", "output audio")
	provider := fs.String("provider", "", "tts provider")
	voice := fs.String("voice", "", "voice")
	format := fs.String("format", "", "audio format")
	speed := fs.Float64("speed", 1, "speaking rate")
	instructions := fs.String("instructions", "", "delivery instructions")
	dryRun := fs.Bool("dry-run", false, "validate command without running external services")
	if err := fs.Parse(args); err != nil {
		return Command{}, err
	}
	if fs.NArg() != 0 {
		return Command{}, errors.New("speech does not accept positional arguments")
	}
	if (strings.TrimSpace(*text) == "") == (strings.TrimSpace(*textFile) == "") {
		return Command{}, errors.New("speech requires exactly one of --text or --text-file")
	}
	if strings.TrimSpace(*output) == "" {
		return Command{}, errors.New("speech requires --output")
	}
	if *format != "" && *format != "wav" && *format != "mp3" {
		return Command{}, errors.New("speech --format must be wav or mp3")
	}
	if *speed < 0.5 || *speed > 2 {
		return Command{}, errors.New("speech --speed must be between 0.5 and 2")
	}
	return Command{
		Name:   name,
		DryRun: *dryRun,
		Speech: SpeechRequest{
			Text:         *text,
			TextFile:     *textFile,
			Output:       *output,
			Provider:     *provider,
			Voice:        *voice,
			Format:       *format,
			Speed:        *speed,
			Instructions: *instructions,
		},
	}, nil
}

func executeSpeech(ctx context.Context, req SpeechRequest) pipeline.Response {
	provider := strings.TrimSpace(req.Provider)
	if provider == "" {
		provider = currentTTSProvider()
	}
	text := req.Text
	if req.TextFile != "" {
		data, err := os.ReadFile(req.TextFile)
		if err != nil {
			return speechFailure(provider, req.Output, "speech_input_failed", err)
		}
		text = string(data)
	}
	if strings.TrimSpace(text) == "" {
		return speechFailure(provider, req.Output, "speech_input_empty", errors.New("speech text is empty"))
	}
	client, err := ttsprovider.New(provider)
	if err != nil {
		return speechFailure(provider, req.Output, "speech_provider_unsupported", err)
	}
	if err := client.Synthesize(ctx, types.TTSSpeechOptions{
		Text:         text,
		Voice:        req.Voice,
		OutputFile:   req.Output,
		Format:       req.Format,
		Speed:        req.Speed,
		Instructions: req.Instructions,
	}); err != nil {
		return speechFailure(provider, req.Output, "speech_synthesis_failed", err)
	}
	return pipeline.Response{
		OK:    true,
		Stage: pipeline.StageSpeech,
		Inputs: map[string]string{
			"provider": provider,
			"voice":    req.Voice,
		},
		Outputs: pipeline.Outputs{TTSAudio: req.Output},
	}
}

func speechFailure(provider, output, code string, err error) pipeline.Response {
	return pipeline.Response{
		OK:    false,
		Stage: pipeline.StageSpeech,
		Inputs: map[string]string{
			"provider": provider,
			"output":   output,
		},
		Error: &pipeline.Error{
			Kind:      pipeline.ErrorKindRetryable,
			Code:      code,
			Message:   err.Error(),
			Retryable: true,
		},
	}
}

func parseCover(name string, args []string) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	workdir := fs.String("workdir", "", "workdir")
	taskID := fs.String("task-id", "", "task id")
	prompt := fs.String("prompt", "", "image prompt")
	size := fs.String("size", "", "image size")
	dryRun := fs.Bool("dry-run", false, "validate command without running external services")
	if err := fs.Parse(args); err != nil {
		return Command{}, err
	}
	if strings.TrimSpace(*prompt) == "" {
		return Command{}, errors.New("cover requires --prompt")
	}
	return Command{
		Name:   name,
		DryRun: *dryRun,
		Cover: pipeline.CoverRequest{
			Workdir: *workdir,
			TaskID:  *taskID,
			Prompt:  *prompt,
			Size:    *size,
		},
	}, nil
}

func parseSubtitle(name string, args []string) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	originLang := fs.String("origin-lang", "", "origin language")
	targetLang := fs.String("target-lang", "", "target language")
	userLang := fs.String("user-lang", "", "user interface language")
	workdir := fs.String("workdir", "", "workdir")
	taskID := fs.String("task-id", "", "task id")
	captionSource := fs.String("caption-source", string(pipeline.CaptionSourceAny), "caption source")
	prepareVideo := fs.Bool("prepare-video", false, "prepare original video for later rendering")
	sourceOnly := fs.Bool("source-only", false, "generate source-language subtitles without translation")
	inputSRT := fs.String("input-srt", "", "existing UTF-8 SRT")
	srtTranslated := fs.Bool("srt-translated", false, "SRT is already translated")
	bilingualTop := fs.Bool("bilingual-top", true, "put target subtitle on top")
	maxWordOneLine := fs.Int("max-word-one-line", 0, "max words per line")
	subtitleStyleFile := fs.String("subtitle-style-file", "", "subtitle style JSON file")
	dryRun := fs.Bool("dry-run", false, "validate command without running external services")
	input := ""
	parseArgs := args
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		input = args[0]
		parseArgs = args[1:]
	}
	if err := fs.Parse(parseArgs); err != nil {
		return Command{}, err
	}
	if input == "" && fs.NArg() == 1 {
		input = fs.Arg(0)
	}
	if input == "" || fs.NArg() > 1 {
		return Command{}, errors.New("subtitle requires input")
	}
	return Command{
		Name:              name,
		DryRun:            *dryRun,
		SubtitleStyleFile: *subtitleStyleFile,
		Subtitle: pipeline.SubtitleRequest{
			Input:          input,
			Workdir:        *workdir,
			TaskID:         *taskID,
			OriginLang:     *originLang,
			TargetLang:     *targetLang,
			UserLang:       *userLang,
			CaptionSource:  pipeline.CaptionSource(*captionSource),
			PrepareVideo:   *prepareVideo,
			SourceOnly:     *sourceOnly,
			InputSRT:       *inputSRT,
			SRTTranslated:  *srtTranslated,
			BilingualTop:   *bilingualTop,
			MaxWordOneLine: *maxWordOneLine,
		},
	}, nil
}

func parseTTS(name string, args []string) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	workdir := fs.String("workdir", "", "workdir")
	taskID := fs.String("task-id", "", "task id")
	inputSRT := fs.String("input-srt", "", "input srt")
	lineMode := fs.String("line-mode", string(pipeline.LineModeTargetOnly), "line mode")
	video := fs.String("video", "", "input video")
	voice := fs.String("voice", "", "voice")
	voiceCloneSource := fs.String("voice-clone-source", "", "voice clone source")
	dryRun := fs.Bool("dry-run", false, "validate command without running external services")
	if err := fs.Parse(args); err != nil {
		return Command{}, err
	}
	if *inputSRT == "" {
		return Command{}, errors.New("tts requires --input-srt")
	}
	return Command{
		Name:   name,
		DryRun: *dryRun,
		TTS: pipeline.TTSRequest{
			Workdir:          *workdir,
			TaskID:           *taskID,
			InputSRT:         *inputSRT,
			LineMode:         pipeline.LineMode(*lineMode),
			Video:            *video,
			Voice:            *voice,
			VoiceCloneSource: *voiceCloneSource,
		},
	}, nil
}

func parseRender(name string, args []string, horizontal bool) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	workdir := fs.String("workdir", "", "workdir")
	taskID := fs.String("task-id", "", "task id")
	video := fs.String("video", "", "input video")
	audio := fs.String("audio", "", "input audio")
	subtitle := fs.String("subtitle", "", "subtitle")
	dubbed := fs.Bool("dubbed", false, "render dubbed video")
	majorTitle := fs.String("major-title", "", "vertical major title")
	minorTitle := fs.String("minor-title", "", "vertical minor title")
	subtitleStyleFile := fs.String("subtitle-style-file", "", "subtitle style JSON file")
	dryRun := fs.Bool("dry-run", false, "validate command without running external services")
	if err := fs.Parse(args); err != nil {
		return Command{}, err
	}
	return Command{
		Name:              name,
		DryRun:            *dryRun,
		SubtitleStyleFile: *subtitleStyleFile,
		Render: pipeline.RenderRequest{
			Workdir:    *workdir,
			TaskID:     *taskID,
			Video:      *video,
			Audio:      *audio,
			Subtitle:   *subtitle,
			Horizontal: horizontal,
			Dubbed:     *dubbed,
			MajorTitle: *majorTitle,
			MinorTitle: *minorTitle,
		},
	}, nil
}

func parsePipeline(name string, args []string) (Command, error) {
	if hasHelpArg(args) {
		return Command{Name: name, Help: true}, nil
	}
	fs := newFlagSet(name)
	outputs := fs.String("outputs", "subtitle", "outputs")
	async := fs.Bool("async", false, "run async")
	dryRun := fs.Bool("dry-run", false, "validate command without running external services")
	if err := fs.Parse(args); err != nil {
		return Command{}, err
	}
	if _, err := pipeline.PlanOutputs(*outputs); err != nil {
		return Command{}, err
	}
	return Command{
		Name:   name,
		DryRun: *dryRun,
		Pipeline: pipeline.PipelineRequest{
			Outputs: *outputs,
			Async:   *async,
		},
	}, nil
}

func dryRun(cmd Command) pipeline.Response {
	switch cmd.Name {
	case "subtitle":
		if _, err := loadSubtitleStyleForCLI(cmd.SubtitleStyleFile); err != nil {
			return styleLoadFailure(pipeline.StageSubtitle, cmd.Subtitle.Workdir, cmd.Subtitle.TaskID, err)
		}
		return dryRunResponse(pipeline.StageSubtitle, cmd.Subtitle.Workdir, cmd.Subtitle.TaskID)
	case "tts":
		return dryRunManifest(cmd.TTS.Workdir, cmd.TTS.TaskID, pipeline.StageTTS, nil)
	case "speech":
		return pipeline.Response{
			OK:    true,
			Stage: pipeline.StageSpeech,
			Inputs: map[string]string{
				"provider": cmd.Speech.Provider,
				"voice":    cmd.Speech.Voice,
				"output":   cmd.Speech.Output,
				"format":   cmd.Speech.Format,
			},
		}
	case "render-horizontal":
		if _, err := loadSubtitleStyleForCLI(cmd.SubtitleStyleFile); err != nil {
			return styleLoadFailure(pipeline.StageRenderHorizontal, cmd.Render.Workdir, cmd.Render.TaskID, err)
		}
		return dryRunResponse(pipeline.StageRenderHorizontal, cmd.Render.Workdir, cmd.Render.TaskID)
	case "render-vertical":
		if _, err := loadSubtitleStyleForCLI(cmd.SubtitleStyleFile); err != nil {
			return styleLoadFailure(pipeline.StageRenderVertical, cmd.Render.Workdir, cmd.Render.TaskID, err)
		}
		return dryRunResponse(pipeline.StageRenderVertical, cmd.Render.Workdir, cmd.Render.TaskID)
	case "cover":
		return dryRunManifest(cmd.Cover.Workdir, cmd.Cover.TaskID, pipeline.StageCover, func(m *pipeline.Manifest) {
			m.Outputs.FinalCoverPrompt = m.Outputs.FinalCoverPrompt
		})
	case "pipeline":
		return pipeline.Response{OK: true, Stage: pipeline.StagePipeline}
	case "voices":
		return executeVoices(cmd.Voices)
	default:
		return pipeline.Response{
			OK: false,
			Error: &pipeline.Error{
				Kind:    pipeline.ErrorKindUsage,
				Code:    "unsupported_dry_run",
				Message: fmt.Sprintf("unsupported dry-run command: %s", cmd.Name),
			},
		}
	}
}

var currentTTSProvider = func() string {
	return config.Conf.Tts.Provider
}

func dryRunResponse(stage pipeline.Stage, workdir, taskID string) pipeline.Response {
	return pipeline.Response{
		OK:      true,
		Stage:   stage,
		Workdir: workdir,
		TaskID:  taskID,
	}
}

func dryRunManifest(workdir, taskID string, stage pipeline.Stage, update func(*pipeline.Manifest)) pipeline.Response {
	if workdir == "" {
		workdir = "."
	}
	manifest := pipeline.NewManifest(taskID, workdir)
	if update != nil {
		update(manifest)
	}
	if err := manifest.ApplyDefaultOutputs(); err != nil {
		return dryRunError(stage, workdir, taskID, "apply_outputs_failed", err)
	}
	manifest.MarkStage(stage, true, "dry-run")
	if err := manifest.Save(); err != nil && !errors.Is(err, os.ErrExist) {
		return dryRunError(stage, workdir, taskID, "save_manifest_failed", err)
	}
	return pipeline.Response{
		OK:      true,
		Stage:   stage,
		Workdir: manifest.Workdir,
		TaskID:  manifest.TaskID,
		Outputs: manifest.Outputs,
	}
}

func dryRunError(stage pipeline.Stage, workdir, taskID, code string, err error) pipeline.Response {
	return pipeline.Response{
		OK:      false,
		Stage:   stage,
		Workdir: workdir,
		TaskID:  taskID,
		Error: &pipeline.Error{
			Kind:    pipeline.ErrorKindInternal,
			Code:    code,
			Message: err.Error(),
		},
	}
}

func loadSubtitleStyleForCLI(styleFile string) (*subtitlestyle.StyleSet, error) {
	base := subtitlestyle.DefaultStyleSet()
	if defaultPath, ok, err := findDefaultSubtitleStylePath(); err != nil {
		return nil, defaultStyleLoadError(err)
	} else if ok {
		fileStyle, err := subtitlestyle.LoadOverrideFile(defaultPath)
		if err != nil {
			return nil, defaultStyleLoadError(err)
		}
		base, err = subtitlestyle.Merge(base, fileStyle)
		if err != nil {
			return nil, defaultStyleLoadError(err)
		}
	}
	if strings.TrimSpace(styleFile) == "" {
		return base, nil
	}
	override, err := subtitlestyle.LoadOverrideFile(styleFile)
	if err != nil {
		return nil, userStyleLoadError(err)
	}
	merged, err := subtitlestyle.Merge(base, override)
	if err != nil {
		return nil, userStyleLoadError(err)
	}
	return merged, nil
}

func findDefaultSubtitleStylePath() (string, bool, error) {
	paths := []string{defaultSubtitleStylePath}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		paths = appendDefaultStyleParentPaths(paths, exeDir)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", false, err
	}
	if _, sourceFile, _, ok := runtime.Caller(0); ok {
		paths = appendDefaultStyleParentPaths(paths, filepath.Dir(sourceFile))
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = appendDefaultStyleParentPaths(paths, cwd)
	} else {
		return "", false, err
	}
	seen := make(map[string]bool, len(paths))
	for _, path := range paths {
		clean := filepath.Clean(path)
		if seen[clean] {
			continue
		}
		seen[clean] = true
		if _, err := os.Stat(clean); err == nil {
			return clean, true, nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", false, err
		}
	}
	return "", false, nil
}

func appendDefaultStyleParentPaths(paths []string, dir string) []string {
	for {
		paths = append(paths, filepath.Join(dir, defaultSubtitleStylePath))
		parent := filepath.Dir(dir)
		if parent == dir {
			return paths
		}
		dir = parent
	}
}

func styleLoadFailure(stage pipeline.Stage, workdir, taskID string, err error) pipeline.Response {
	kind := pipeline.ErrorKindUsage
	code := "subtitle_style_load_failed"
	var styleErr subtitleStyleLoadError
	if errors.As(err, &styleErr) && !styleErr.user {
		kind = pipeline.ErrorKindInternal
		code = "default_subtitle_style_load_failed"
	}
	return pipeline.Response{
		OK:      false,
		Stage:   stage,
		Workdir: workdir,
		TaskID:  taskID,
		Error: &pipeline.Error{
			Kind:    kind,
			Code:    code,
			Message: err.Error(),
		},
	}
}

func renderStageFromCommand(name string) pipeline.Stage {
	if name == "render-horizontal" {
		return pipeline.StageRenderHorizontal
	}
	return pipeline.StageRenderVertical
}

func newFlagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

func hasHelpArg(args []string) bool {
	for _, arg := range args {
		if isHelpArg(arg) {
			return true
		}
	}
	return false
}

func isHelpArg(arg string) bool {
	return arg == "-h" || arg == "--help" || arg == "help"
}

func responseWithError(resp pipeline.Response, err error) pipeline.Response {
	if err == nil {
		return resp
	}
	if resp.Error != nil {
		return resp
	}
	resp.OK = false
	resp.Error = &pipeline.Error{
		Kind:      pipeline.ErrorKindRetryable,
		Code:      "command_failed",
		Message:   err.Error(),
		Retryable: true,
	}
	return resp
}
