# Hy-MT2 local translation endpoint

OpenCreator uses the existing OpenAI-compatible text model connection for Hy-MT2. The user deploys and operates the model service. OpenCreator does not download model weights or start a model process.

The [official Hy-MT2 repository](https://github.com/Tencent-Hunyuan/Hy-MT2) publishes an Apache-2.0 [license](https://github.com/Tencent-Hunyuan/Hy-MT2/blob/main/LICENSE.txt), recommends `vllm serve tencent/Hy-MT2-30B-A3B --tensor-parallel-size 1`, and describes Transformers and SGLang inference as alternatives. The [Hy-MT2-1.8B model files](https://huggingface.co/tencent/Hy-MT2-1.8B/blob/main/LICENSE.txt) also state Apache-2.0. [vLLM's OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html) serves `/v1/models` and `/v1/chat/completions`. The model repository does not publish a separate Hy-MT2 HTTP protocol. Check the selected model's own distribution terms before downloading it.

In **Settings → AI services → Model provider**, select **Custom model service**, then **Hy-MT2 (self-hosted)**. Enter the Base URL ending in `/v1`, the exact served model ID, an optional API key, and a request timeout. Use **Test connection** to check `/v1/models`; a successful check confirms that the selected model is advertised, not that translation quality is acceptable. If vLLM was started without a `--served-model-name`, use the model ID returned by that endpoint.

The video subtitle Stage continues to use the shared KrillinAI translation contract, including existing segmentation and context prompts. Its target subtitle Artifact records the translation provider and model, without recording the credential. A failed local request ends the Stage with an error; it does not select a cloud model. The model-specific request omits a system message because the official Hy-MT2 README states that these models have no default system prompt.

For deployment, prefer binding the service to `127.0.0.1` unless remote access is intentionally configured. The default example URL in OpenCreator is `http://127.0.0.1:8000/v1`; it does not start a service.
