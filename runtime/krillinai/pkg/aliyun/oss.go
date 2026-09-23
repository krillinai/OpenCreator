package aliyun

import (
	"context"
	"fmt"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"krillin-ai/config"
	"net"
	"net/url"
	"os"
	"regexp"
	"strings"
)

type OssClient struct {
	*oss.Client
	Bucket    string
	endpoint  *url.URL
	configErr error
}

func NewOssClient(settings config.AliyunOssConfig) *OssClient {
	credProvider := credentials.NewStaticCredentialsProvider(settings.AccessKeyId, settings.AccessKeySecret)
	region := strings.TrimSpace(settings.Region)
	if region == "" {
		region = "cn-shanghai"
	}
	endpoint, err := resolveOssEndpoint(region, settings.Endpoint)

	cfg := oss.LoadDefaultConfig().
		WithCredentialsProvider(credProvider).
		WithRegion(region)
	if err == nil {
		cfg = cfg.WithEndpoint(endpoint.String())
	}

	client := oss.NewClient(cfg)

	return &OssClient{Client: client, Bucket: settings.Bucket, endpoint: endpoint, configErr: err}
}

var ossRegionPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func resolveOssEndpoint(region, endpoint string) (*url.URL, error) {
	if len(region) > 64 || !ossRegionPattern.MatchString(region) {
		return nil, fmt.Errorf("invalid OSS region")
	}
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = "https://oss-" + region + ".aliyuncs.com"
	} else if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil || strings.ContainsAny(endpoint, "?#\\") || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, fmt.Errorf("OSS endpoint must be an HTTP(S) service endpoint without a path, credentials, query or fragment")
	}
	u.Path = ""
	return u, nil
}

// ObjectURL uses the same endpoint and addressing style as the upload client.
func (o *OssClient) ObjectURL(objectKey string) (string, error) {
	if o.configErr != nil {
		return "", o.configErr
	}
	u := *o.endpoint
	if net.ParseIP(u.Hostname()) != nil {
		u.Path = "/" + o.Bucket + "/" + objectKey
	} else {
		u.Host = o.Bucket + "." + u.Host
		u.Path = "/" + objectKey
	}
	return u.String(), nil
}

func (o *OssClient) UploadFile(ctx context.Context, objectKey, filePath, bucket string) error {
	if o.configErr != nil {
		return o.configErr
	}
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	_, err = o.PutObject(ctx, &oss.PutObjectRequest{
		Bucket: &bucket,
		Key:    &objectKey,
		Body:   file,
	})
	if err != nil {
		return fmt.Errorf("failed to upload file to OSS: %v", err)
	}

	fmt.Printf("File %s uploaded successfully to bucket %s as %s\n", filePath, bucket, objectKey)
	return nil
}
