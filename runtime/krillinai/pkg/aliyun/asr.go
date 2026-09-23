package aliyun

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk/auth/credentials"
	"github.com/aliyun/alibaba-cloud-sdk-go/sdk/requests"
	"go.uber.org/zap"
	"krillin-ai/config"
	"krillin-ai/internal/types"
	"krillin-ai/log"
	"krillin-ai/pkg/util"
	"path/filepath"
	"strings"
	"time"
)

type AsrClient struct {
	client       *sdk.Client
	appKey       string
	regionID     string
	domain       string
	apiVersion   string
	product      string
	enableWords  bool
	pollInterval time.Duration
	maxPollTime  time.Duration
	ossClient    *OssClient
}

func NewAsrClient(accessKeyID, accessKeySecret, appKey string, enableWords bool) (*AsrClient, error) {
	const (
		regionID     = "cn-shanghai"
		domain       = "filetrans.cn-shanghai.aliyuncs.com"
		apiVersion   = "2018-08-17"
		product      = "nls-filetrans"
		pollInterval = 10 * time.Second
		maxPollTime  = 10 * time.Minute
	)

	clientcConfig := sdk.NewConfig()
	credential := credentials.NewAccessKeyCredential(accessKeyID, accessKeySecret)
	client, err := sdk.NewClientWithOptions(regionID, clientcConfig, credential)
	if err != nil {
		return nil, fmt.Errorf("failed to create alibaba cloud client: %v", err)
	}

	return &AsrClient{
		client:       client,
		appKey:       appKey,
		regionID:     regionID,
		domain:       domain,
		apiVersion:   apiVersion,
		product:      product,
		enableWords:  enableWords,
		pollInterval: pollInterval,
		maxPollTime:  maxPollTime,
		ossClient:    NewOssClient(config.Conf.Transcribe.Aliyun.Oss),
	}, nil
}

type Word struct {
	Word       string  `json:"word"`
	BeginTime  float64 `json:"beginTime"`
	EndTime    float64 `json:"endTime"`
	Confidence float64 `json:"confidence"`
}

type Sentence struct {
	Text      string  `json:"Text"`
	BeginTime float64 `json:"BeginTime"`
	EndTime   float64 `json:"EndTime"`
}

type RecognitionResult struct {
	Sentences []Sentence `json:"Sentences"`
	Words     []Word     `json:"Words,omitempty"`
}

type TaskResponse struct {
	TaskId       string             `json:"TaskId"`
	StatusText   string             `json:"StatusText"`
	RequestId    string             `json:"RequestId"`
	Result       *RecognitionResult `json:"Result,omitempty"`
	StatusCode   int                `json:"StatusCode"`
	BizDuration  float64            `json:"BizDuration"`
	pollInterval time.Duration
	maxPollTime  time.Duration
}

func (c *AsrClient) Transcription(audioFile, language, workDir string) (*types.TranscriptionData, error) {
	const (
		postRequestAction = "SubmitTask"
		getRequestAction  = "GetTaskResult"
		keyTask           = "Task"
		keyTaskId         = "TaskId"
		statusSuccess     = "SUCCESS"
		statusRunning     = "RUNNING"
		statusQueueing    = "QUEUEING"
	)

	// 处理音频
	processedAudioFile, err := util.ProcessAudio(audioFile)
	if err != nil {
		log.GetLogger().Error("处理音频失败", zap.Error(err), zap.String("audio file", audioFile))
		return nil, err
	}

	// 上传音频文件
	fileKey := util.GenerateRandStringWithUpperLowerNum(5) + filepath.Ext(audioFile)
	err = c.ossClient.UploadFile(context.Background(), fileKey, processedAudioFile, c.ossClient.Bucket)
	if err != nil {
		log.GetLogger().Error("StartVideoSubtitleTask UploadFile err", zap.Any("audio file", audioFile), zap.Error(err))
		return nil, errors.New("上传声音克隆源失败")
	}
	audioUrl, err := c.ossClient.ObjectURL(fileKey)
	if err != nil {
		return nil, err
	}
	log.GetLogger().Info("上传待转录音频到阿里云oss成功", zap.String("local file name", audioFile), zap.String("oss url", audioUrl))

	// 提交识别任务
	taskParams := map[string]string{
		"appkey":       c.appKey,
		"file_link":    audioUrl,
		"version":      "4.0",
		"enable_words": fmt.Sprintf("%v", c.enableWords),
	}

	task, err := json.Marshal(taskParams)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal task params: %v", err)
	}

	postRequest := requests.NewCommonRequest()
	postRequest.Domain = c.domain
	postRequest.Version = c.apiVersion
	postRequest.Product = c.product
	postRequest.ApiName = postRequestAction
	postRequest.Method = "POST"
	postRequest.FormParams[keyTask] = string(task)

	postResponse, err := c.client.ProcessCommonRequest(postRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to submit task: %v", err)
	}

	if postResponse.GetHttpStatus() != 200 {
		return nil, fmt.Errorf("recognition request failed, HTTP error code: %d", postResponse.GetHttpStatus())
	}

	var postResult TaskResponse
	if err := json.Unmarshal([]byte(postResponse.GetHttpContentString()), &postResult); err != nil {
		return nil, fmt.Errorf("failed to parse response: %v", err)
	}

	if postResult.StatusText != statusSuccess {
		return nil, fmt.Errorf("recognition request failed with status: %s (code: %d)",
			postResult.StatusText, postResult.StatusCode)
	}

	taskID := postResult.TaskId
	if taskID == "" {
		return nil, fmt.Errorf("empty task ID in response")
	}

	// 查询识别结果
	getRequest := requests.NewCommonRequest()
	getRequest.Domain = c.domain
	getRequest.Version = c.apiVersion
	getRequest.Product = c.product
	getRequest.ApiName = getRequestAction
	getRequest.Method = "GET"
	getRequest.QueryParams[keyTaskId] = taskID

	startTime := time.Now()
	var resultData *types.TranscriptionData

	for {
		if time.Since(startTime) > c.maxPollTime {
			return nil, fmt.Errorf("polling timeout after %v", c.maxPollTime)
		}

		getResponse, err := c.client.ProcessCommonRequest(getRequest)
		if err != nil {
			return nil, fmt.Errorf("failed to get task result: %v", err)
		}

		if getResponse.GetHttpStatus() != 200 {
			return nil, fmt.Errorf("result query request failed, HTTP error code: %d", getResponse.GetHttpStatus())
		}

		var getResult TaskResponse
		if err := json.Unmarshal([]byte(getResponse.GetHttpContentString()), &getResult); err != nil {
			return nil, fmt.Errorf("failed to parse result: %v", err)
		}

		switch getResult.StatusText {
		case statusRunning, statusQueueing:
			time.Sleep(c.pollInterval)
			continue
		case statusSuccess:
			if getResult.Result == nil || len(getResult.Result.Sentences) == 0 {
				return nil, fmt.Errorf("empty recognition result")
			}

			// 构建返回结果
			resultData = &types.TranscriptionData{
				Language: language,
			}

			for _, sentence := range getResult.Result.Sentences {
				resultData.Text += sentence.Text
			}

			var words []types.Word
			if c.enableWords && getResult.Result.Words != nil {
				for i, v := range getResult.Result.Words {
					words = append(words, types.Word{
						Num:   i,
						Text:  strings.TrimSpace(v.Word), // 阿里云这边的word后面会有空格
						Start: v.BeginTime / 1000,
						End:   v.EndTime / 1000,
					})
				}
			}
			resultData.Words = words

			return resultData, nil
		default:
			return nil, fmt.Errorf("aliyun asr recognition failed with status: %s (code: %d)",
				getResult.StatusText, getResult.StatusCode)
		}
	}
}
