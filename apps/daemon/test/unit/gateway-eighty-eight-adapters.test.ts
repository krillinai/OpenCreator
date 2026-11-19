import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { GatewayModel } from '@opencreator/protocol';
import { createDirectTransport } from '../../src/gateway/direct-transport.js';
import { eightyEightImageRequest, eightyEightImageResult } from '../../src/gateway/eighty-eight-image.js';
import { eightyEightVideoRequest } from '../../src/gateway/eighty-eight-video.js';
import { eightyEightTranscriptionRequest } from '../../src/gateway/eighty-eight-audio.js';
import { uploadSupplierMedia } from '../../src/gateway/supplier-media.js';
import { responsesToChat, chatToResponses } from '../../src/gateway/chat-responses.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const baseUrl = 'https://api.88api.ai/v1';
async function fixture(fetcher: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'oc-88-adapters-')); roots.push(root);
  return { transport: createDirectTransport(root, fetcher), input: { account: 'a', baseUrl, key: 'private-key', method: 'POST', contentType: 'application/json',
    identity: 'request', fingerprint: 'fingerprint', signal: AbortSignal.timeout(5000) } };
}
async function multipart(form: FormData) {
  const request = new Request('http://localhost', { method: 'POST', body: form });
  return { body: Buffer.from(await request.arrayBuffer()), contentType: request.headers.get('content-type')! };
}

it.each(['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-nano-banana-2.1'])('routes %s generation and edits through Chat and normalizes the images', async id => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] } }] }));
  const f = await fixture(fetcher);
  const model: GatewayModel = { id, modality: 'image', capabilities: ['edit'], imageOptions: { maxImages: 1, maxReferences: 16 } };
  const response = await f.transport.request({ ...f.input, model, resource: 'images/generations', body: { model: id, prompt: 'test', n: 1 } });
  expect(await response.json()).toMatchObject({ data: [{ b64_json: 'aW1hZ2U=' }] });
  expect(fetcher.mock.lastCall?.[0]).toBe(`${baseUrl}/chat/completions`);
  const form = new FormData(); form.set('model', id); form.set('prompt', 'edit'); form.set('image', new Blob(['ref'], { type: 'image/png' }), 'ref.png');
  await f.transport.request({ ...f.input, ...await multipart(form), model, identity: 'edit', resource: 'images/edits' });
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toMatchObject({ model: id, messages: [{ content: [{ type: 'text', text: 'edit' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,cmVm' } }] }] });
});

it('recognizes structured Gemini image variants and ignores ordinary text links', () => {
  for (const content of ['![image](data:image/png;base64,aW1hZ2U=)', [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }], [{ type: 'output_image', url: 'data:image/png;base64,aW1hZ2U=' }]]) {
    expect(eightyEightImageResult({ choices: [{ message: { content } }] })).toMatchObject({ data: [{ b64_json: 'aW1hZ2U=' }] });
  }
  expect(eightyEightImageResult({ choices: [{ message: { content: 'See https://assets.88api.ai/readme' } }] })).toMatchObject({ data: [] });
});

it.each(['midjourney-v8.2', 'midjourney-v8.2-fast', 'midjourney-v8.2-turbo'])('preserves %s prompt controls and all four outputs', async id => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: Array.from({ length: 4 }, () => ({ b64_json: 'aW1hZ2U=' })) }));
  const f = await fixture(fetcher);
  const model: GatewayModel = { id, modality: 'image', capabilities: [], imageOptions: { maxImages: 1, maxReferences: 0, aspectRatios: ['16:9'] } };
  const result = await f.transport.request({ ...f.input, model, resource: 'images/generations', body: { model: id, prompt: 'test --s 200', aspect_ratio: '16:9' } });
  expect((await result.json()).data).toHaveLength(4);
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({ model: id, prompt: 'test --s 200 --ar 16:9' });
  await expect(eightyEightImageRequest('images/generations', { model: id, prompt: 'test --ar 1:1', aspect_ratio: '16:9' }, 'application/json', model)).rejects.toMatchObject({ code: 'capability_unsupported' });
});

it('uploads multiple local Seedream references and keeps single-file edits multipart', async () => {
  const form = new FormData(); form.set('model', 'doubao-seedream-5-0-pro'); form.set('prompt', 'edit'); form.set('resolution', '2K');
  form.append('image[]', new Blob(['one'], { type: 'image/png' }), 'one.png');
  const singleRequest = await multipart(form);
  const single = await eightyEightImageRequest('images/edits', singleRequest.body, singleRequest.contentType);
  expect(single.resource).toBe('images/edits');
  form.append('image[]', new Blob(['two'], { type: 'image/png' }), 'two.png');
  const upload = vi.fn(async (bytes: Buffer) => `https://assets.88api.ai/${bytes.toString()}.png`);
  const request = await multipart(form);
  const result = await eightyEightImageRequest('images/edits', request.body, request.contentType, undefined, upload);
  expect(result).toMatchObject({ resource: 'images/generations', body: { model: 'doubao-seedream-5-0-pro', size: '2K', images: ['https://assets.88api.ai/one.png', 'https://assets.88api.ai/two.png'] } });
  expect(upload).toHaveBeenCalledTimes(2);
  expect(await eightyEightImageRequest('images/generations', { model: 'doubao-seedream-5-0-pro', prompt: 'test', size: '1024x1024', resolution: '2K' }, 'application/json')).toMatchObject({ body: { size: '2K' } });
});

it.each(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-image-quality'])('adapts %s without changing its supplier ID', async id => {
  const result = await eightyEightImageRequest('images/generations', { model: id, prompt: 'test' }, 'application/json');
  expect(result).toMatchObject({ resource: 'images/generations', body: { model: id, response_format: 'b64_json' } });
});

it('requires a reference for the Grok edit-only model', async () => {
  const model: GatewayModel = { id: 'grok-imagine-edit', modality: 'image', capabilities: ['edit', 'reference_required'], imageOptions: { maxImages: 1, maxReferences: 1 } };
  await expect(eightyEightImageRequest('images/generations', { model: model.id, prompt: 'edit' }, 'application/json', model)).rejects.toMatchObject({ code: 'capability_unsupported' });
  expect(await eightyEightImageRequest('images/edits', { model: model.id, prompt: 'edit', image: 'https://assets.88api.ai/ref.png' }, 'application/json', model)).toMatchObject({ resource: 'images/edits' });
});

it('uses scoped upload credentials with the documented SHA-256 encoding and reconciles existing objects', async () => {
  const url = 'https://assets.88api.ai/media/ref.png'; const bytes = Buffer.from('image');
  const authorize = vi.fn(async () => Response.json({ url, upload_url: url, method: 'PUT', headers: { 'Content-Type': 'image/png', 'X-Media-Upload-Token': 'scoped-token' } }));
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => options?.method === 'HEAD' ? new Response(null, { headers: { 'content-length': '5', 'content-type': 'image/png' } }) : new Response(null, { status: 409 }));
  expect(await uploadSupplierMedia(bytes, 'image/png', fetcher, authorize, AbortSignal.timeout(1000))).toBe(url);
  expect(authorize).toHaveBeenCalledWith({ size: 5, mime_type: 'image/png', sha256: createHash('sha256').update(bytes).digest('base64url') });
  const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
  expect(headers.get('authorization')).toBeNull(); expect(headers.get('x-media-upload-token')).toBe('scoped-token');
  expect(fetcher.mock.calls.map(([, options]) => options?.method)).toEqual(['PUT', 'HEAD']);
});

const videos = ['gemini-omni-flash', 'gemini-omni-flash-1.1', 'grok-imagine-video', 'grok-imagine-video-1.5', 'kling-3.0-turbo', 'minimax_h3', 'minimax-h3',
  'SD2.0', 'SD2.5', 'Seedance-2.0-720p官方版', 'Seedance-2.0-fast-720p官方版', 'seedance-2.0-fast官方版', 'seedance-2.0-mini-480p', 'seedance-2.0-mini-720p',
  'seedance-2.0-mini官方版', 'seedance-2.0官方版', 'Seedance-2.5-720p官方版', 'seedance-2.5官方版', 'veo-3.1', 'veo-3.1-fast', 'wan3.0-video', 'wan3.0-video-prime',
  'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-5-260628',
  'doubao-seedance-2.0', 'doubao-seedance-2.0-fast', 'doubao-seedance-2.0-mini', 'doubao-seedance-2.5',
  'SD2.0 480P', 'SD2.0 720P', 'SD2.0 1080P', 'SD2.0 4K', 'SD2.5 480P', 'SD2.5 720P', 'SD2.5 1080P'];
it.each(videos)('preserves the exact video model ID %s and advanced fields', async id => {
  const result = await eightyEightVideoRequest({ model: id, prompt: 'test', duration: 4, ratio: '16:9', negative_prompt: 'blur', seed: 7 }, undefined, async () => 'unused');
  expect(result).toMatchObject({ model: id, prompt: 'test', duration: 4, negative_prompt: 'blur', seed: 7 });
  expect(result[id.startsWith('grok-') ? 'aspect_ratio' : 'ratio']).toBe('16:9');
});

it('uploads video Data URIs once, uses Wan media fields and retains audio references', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/media/uploads')) return Response.json({ url: 'https://assets.88api.ai/ref.png', upload_url: 'https://assets.88api.ai/ref.png', method: 'PUT', headers: { 'Content-Type': 'image/png', 'X-Media-Upload-Token': 'upload' } });
    if (options?.method === 'PUT') return new Response(null, { status: 201 });
    return Response.json({ id: 'task_test', status: 'queued' });
  });
  const f = await fixture(fetcher);
  const body = { model: 'wan3.0-video', prompt: 'test', duration: 2, image: 'data:image/png;base64,aW1hZ2U=' };
  await f.transport.request({ ...f.input, resource: 'video/jobs', body });
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toMatchObject({ media: [{ type: 'first_frame', url: 'https://assets.88api.ai/ref.png' }] });
  expect(String(fetcher.mock.lastCall?.[1]?.body)).not.toContain('data:');
  await f.transport.request({ ...f.input, resource: 'video/jobs', body });
  expect(fetcher).toHaveBeenCalledTimes(3);
  const audio = await eightyEightVideoRequest({ model: 'wan3.0-video', prompt: 'test', metadata: { referenceAudios: ['https://assets.88api.ai/audio.wav'] } }, undefined, async () => 'unused');
  expect(audio).toMatchObject({ media: [{ type: 'reference_audio', url: 'https://assets.88api.ai/audio.wav' }] });
});

it('accepts TTS style and speed and converts documented 24kHz mono PCM to WAV', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  const f = await fixture(fetcher);
  const response = await f.transport.request({ ...f.input, resource: 'audio/speech', body: { model: 'gemini-3.1-tts', input: 'hello', voice: 'Kore', instructions: 'Calm', speed: 1.25 } });
  const wav = Buffer.from(await response.arrayBuffer());
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.readUInt32LE(24)).toBe(24000); expect(wav.readUInt16LE(22)).toBe(1);
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toMatchObject({ instructions: 'Calm', speed: 1.25, response_format: 'wav' });
  await expect(f.transport.request({ ...f.input, identity: 'long', resource: 'audio/speech', body: { input: 'x'.repeat(7900), instructions: 'x'.repeat(101) } })).rejects.toMatchObject({ code: 'capability_unsupported' });
});

it.each(['gemini-2.5-stt', 'gemini-3-stt', 'gemini-3.5-stt', 'gemini-3.6-stt'])('sends only documented %s multipart fields', async id => {
  const form = new FormData(); form.set('model', id); form.set('prompt', 'Names'); form.set('response_format', 'json'); form.set('language', 'zh'); form.set('temperature', '0');
  form.set('file', new Blob(['audio'], { type: 'audio/wav' }), 'audio.wav');
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const sent = await new Request('http://localhost', { method: 'POST', headers: options?.headers, body: options?.body }).formData();
    expect([...sent.keys()].sort()).toEqual(['file', 'model', 'prompt']); expect(sent.get('model')).toBe(id);
    return Response.json({ text: 'hello' });
  });
  const f = await fixture(fetcher);
  expect(await (await f.transport.request({ ...f.input, ...await multipart(form), resource: 'audio/transcriptions' })).json()).toEqual({ text: 'hello' });
  form.set('response_format', 'verbose_json');
  const data = await multipart(form);
  await expect(eightyEightTranscriptionRequest(data.body, data.contentType)).rejects.toMatchObject({ code: 'capability_unsupported' });
});

it('bridges Responses history, custom tools, images and fragmented Chat tool calls', async () => {
  const bridge = responsesToChat({ model: 'gemini-3.7-flash', instructions: 'system', tools: [{ type: 'custom', name: 'exec', description: 'shell' }],
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'test' }, { type: 'input_image', image_url: 'data:image/png;base64,AA==' }] },
      { type: 'custom_tool_call', name: 'exec', call_id: 'old', input: 'pwd' }, { type: 'custom_tool_call_output', call_id: 'old', output: '/tmp' }], stream: true });
  expect(bridge.body.messages).toMatchObject([{ role: 'system' }, { role: 'user' }, { role: 'assistant', tool_calls: [{ function: { arguments: '{"input":"pwd"}' } }] }, { role: 'tool', content: '/tmp' }]);
  const frames = [{ choices: [{ delta: { content: '你好' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'exec', arguments: '{"input":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }];
  const bytes = Buffer.from(frames.map(p => `data: ${JSON.stringify(p)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
  let index = 0;
  const response = await chatToResponses(new Response(new ReadableStream({ pull(c) { if (index < bytes.length) c.enqueue(bytes.subarray(index, ++index)); else c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }), bridge.tools, 'gemini-3.7-flash');
  const events = (await response.text()).split('\n\n').filter(Boolean).map(frame => JSON.parse(frame.split('\n').find(l => l.startsWith('data:'))!.slice(5)));
  expect(events.find(e => e.type === 'response.output_text.delta').delta).toBe('你好');
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', response: { usage: { total_tokens: 5 }, output: [{ type: 'message' }, { type: 'custom_tool_call', name: 'exec', input: 'ls', call_id: 'call' }] } });
});

it('rejects truncated Chat streams without reporting success', async () => {
  const response = await chatToResponses(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }), new Map(), 'gemini');
  await expect(response.text()).rejects.toMatchObject({ code: 'request_outcome_unknown' });
});

it('bridges a non-streaming model probe before submitting and replays the Responses result', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'call_probe', function: { name: 'probe', arguments: '{"ok":true}' } }] }, finish_reason: 'tool_calls' }] }));
  const f = await fixture(fetcher); const success = vi.fn();
  const model: GatewayModel = { id: 'gemini-3.7-flash', modality: 'text', capabilities: ['responses', 'responses_via_chat'] };
  const request = { ...f.input, model, onModelSuccess: success, resource: 'responses', body: { model: model.id, stream: false, input: 'test', tools: [{ type: 'function', name: 'probe', parameters: { type: 'object', properties: { ok: { type: 'boolean' } } } }] } };
  expect(await (await f.transport.request(request)).json()).toMatchObject({ status: 'completed', output: [{ type: 'function_call', name: 'probe', arguments: '{"ok":true}' }] });
  await f.transport.request(request);
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.lastCall?.[0]).toBe(`${baseUrl}/chat/completions`);
  expect(success).toHaveBeenCalledWith(model.id, 'text', 'responses');
});

async function chatToolCalls(frames: unknown[]) {
  const bridge = responsesToChat({ model: 'gemini-3.7-flash', tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'weather in Paris and London' }] }], stream: true });
  const body = frames.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
  const response = await chatToResponses(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), bridge.tools, 'gemini-3.7-flash');
  const events = (await response.text()).split('\n\n').filter(Boolean).map(frame => JSON.parse(frame.split('\n').find(l => l.startsWith('data:'))!.slice(5)));
  return events.at(-1).response.output.map((item: { call_id: string; name: string; arguments: string }) => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
}

it('keeps parallel Chat tool calls apart when the stream carries no index', async () => {
  // Gemini's OpenAI-compatible endpoint sends every parallel call whole, in its own chunk, without an index.
  expect(await chatToolCalls([
    { choices: [{ delta: { tool_calls: [{ id: 'call_paris', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ id: 'call_london', type: 'function', function: { name: 'get_weather', arguments: '{"city":"London"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  ])).toEqual([
    { id: 'call_paris', name: 'get_weather', arguments: '{"city":"Paris"}' },
    { id: 'call_london', name: 'get_weather', arguments: '{"city":"London"}' }
  ]);
});

it('continues the last Chat tool call for argument fragments without an index', async () => {
  expect(await chatToolCalls([
    { choices: [{ delta: { tool_calls: [{ id: 'call_paris', type: 'function', function: { name: 'get_weather', arguments: '{"city":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ id: 'call_paris', function: { arguments: '"Paris"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ id: 'call_london', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: 'ty":"London"}' } }] }, finish_reason: 'tool_calls' }] }
  ])).toEqual([
    { id: 'call_paris', name: 'get_weather', arguments: '{"city":"Paris"}' },
    { id: 'call_london', name: 'get_weather', arguments: '{"city":"London"}' }
  ]);
});

it.each([false, true])('reassembles interleaved Chat tool calls with explicit indices: %s', async indexed => {
  const calls = [
    { index: 0, id: 'call_paris', function: { name: 'get_weather', arguments: '{"ci' } },
    { index: 1, id: 'call_london', function: { name: 'get_weather', arguments: '{"ci' } },
    { index: 0, id: 'call_paris', function: { arguments: 'ty":' } },
    { index: 0, function: { arguments: '"Paris"}' } },
    { index: 1, id: 'call_london', function: { arguments: 'ty":"London"}' } }
  ];
  const frames = calls.map(({ index, ...call }) => ({ choices: [{ delta: { tool_calls: [indexed ? { ...call, index } : call] } }] }));
  expect(await chatToolCalls([
    ...frames,
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  ])).toEqual([
    { id: 'call_paris', name: 'get_weather', arguments: '{"city":"Paris"}' },
    { id: 'call_london', name: 'get_weather', arguments: '{"city":"London"}' }
  ]);
});

it('asks streamed Chat requests for usage and maps the final usage chunk onto the Responses usage', async () => {
  const streamed = responsesToChat({ model: 'gemini-3.7-flash', input: 'hi', stream: true });
  expect(streamed.body.stream_options).toEqual({ include_usage: true });
  expect(responsesToChat({ model: 'gemini-3.7-flash', input: 'hi' }).body.stream_options).toBeUndefined();
  const sse = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"prompt_tokens_details":{"cached_tokens":4}}}\n\n'
    + 'data: [DONE]\n\n';
  const response = await chatToResponses(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }), streamed.tools, 'gemini-3.7-flash');
  const completed = (await response.text()).split('\n\n').filter(f => f.includes('event: response.completed')).map(f => JSON.parse(f.split('data: ')[1]!))[0];
  expect(completed.response.usage).toMatchObject({ input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 4 } });
});
