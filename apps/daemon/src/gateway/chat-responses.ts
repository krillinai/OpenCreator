import { randomUUID } from 'node:crypto';
import { GatewayError } from './client.js';

type Item = Record<string, any>;
type Tool = { name: string; custom: boolean; namespace?: string };
const unsupported = () => new GatewayError('capability_unsupported', 400);

// The Runtime sends full history with store=false. Never rely on supplier-side sessions.
export function responsesToChat(body: Record<string, unknown>) {
  if (body.previous_response_id) throw unsupported();
  const tools = new Map<string, Tool>();
  const nativeTools: Item[] = [];
  const addTool = (tool: Item, namespace = '') => {
    // Chat exposes client-executed tools; provider-hosted Responses tools have no Chat equivalent.
    if (['web_search', 'web_search_preview', 'tool_search'].includes(tool.type)) return;
    if (tool.type === 'namespace' && Array.isArray(tool.tools)) { tool.tools.forEach((t: Item) => addTool(t, tool.name)); return; }
    if (!['function', 'custom'].includes(tool.type) || typeof tool.name !== 'string') throw unsupported();
    const name = namespace ? `${namespace}__${tool.name}` : tool.name;
    tools.set(name, { name: tool.name, custom: tool.type === 'custom', ...(namespace ? { namespace } : {}) });
    nativeTools.push({ type: 'function', function: { name, description: tool.description,
      parameters: tool.type === 'custom' ? { type: 'object', properties: { input: { type: 'string', description: `Unmodified tool input text.${tool.format ? ` Required format: ${JSON.stringify(tool.format)}` : ''}` } }, required: ['input'], additionalProperties: false } : tool.parameters ?? { type: 'object', properties: {} } } });
  };
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw unsupported();
  (body.tools as Item[] | undefined)?.forEach(t => addTool(t));
  const messages: Item[] = [];
  if (typeof body.instructions === 'string' && body.instructions) messages.push({ role: 'system', content: body.instructions });
  const input = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input;
  if (!Array.isArray(input)) throw unsupported();
  const toolName = (name: string) => [...tools].find(([id, t]) => id === name || t.name === name)?.[0] ?? name;
  const content = (parts: unknown): unknown => {
    if (typeof parts === 'string') return parts;
    if (!Array.isArray(parts)) throw unsupported();
    return parts.map((part: Item) => {
      if (['input_text', 'output_text', 'text'].includes(part.type) && typeof part.text === 'string') return { type: 'text', text: part.text };
      if (part.type === 'input_image' && typeof part.image_url === 'string') return { type: 'image_url', image_url: { url: part.image_url, ...(part.detail ? { detail: part.detail } : {}) } };
      throw unsupported();
    });
  };
  for (const item of input as Item[]) {
    if (item.type === 'reasoning') continue;
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      const name = toolName(item.namespace ? `${item.namespace}__${item.name}` : item.name);
      const call = { id: item.call_id, type: 'function', function: { name, arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments } };
      const previous = messages.at(-1);
      if (previous?.role === 'assistant' && previous.tool_calls) previous.tool_calls.push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      const output = typeof item.output === 'string' ? item.output : Array.isArray(item.output) ? content(item.output) : JSON.stringify(item.output);
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: output });
    } else if (['user', 'assistant', 'system', 'developer'].includes(item.role)) {
      messages.push({ role: item.role === 'developer' ? 'system' : item.role, content: content(item.content) });
    } else throw unsupported();
  }
  let toolChoice = body.tool_choice;
  if (toolChoice && typeof toolChoice === 'object') {
    const choice = toolChoice as Item;
    if (!['function', 'custom'].includes(choice.type)) throw unsupported();
    toolChoice = { type: 'function', function: { name: toolName(choice.name) } };
  }
  const request: Item = { model: body.model, messages, stream: body.stream === true };
  // Chat Completions only reports token usage on streams when asked to, and the Responses usage is built from it.
  if (request.stream) request.stream_options = { include_usage: true };
  if (nativeTools.length) request.tools = nativeTools;
  if (toolChoice !== undefined) request.tool_choice = toolChoice;
  for (const key of ['temperature', 'top_p', 'parallel_tool_calls']) if (body[key] !== undefined) request[key] = body[key];
  if (body.max_output_tokens !== undefined) request.max_tokens = body.max_output_tokens;
  const format = (body.text as Item | undefined)?.format;
  if (format) request.response_format = format.type === 'json_schema' ? { type: 'json_schema', json_schema: { name: format.name, schema: format.schema, strict: format.strict } } : format;
  return { body: request, tools };
}

function outputTool(call: Item, tools: Map<string, Tool>): Item {
  const fn = call.function ?? {}; const tool = tools.get(fn.name);
  if (tool?.custom) {
    let input: unknown;
    try { input = JSON.parse(fn.arguments).input; } catch { throw new GatewayError('invalid_gateway_response'); }
    if (typeof input !== 'string') throw new GatewayError('invalid_gateway_response');
    return { id: `ct_${randomUUID()}`, type: 'custom_tool_call', call_id: call.id, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), input, status: 'completed' };
  }
  if (typeof fn.name !== 'string' || typeof fn.arguments !== 'string' || typeof call.id !== 'string') throw new GatewayError('invalid_gateway_response');
  return { id: `fc_${randomUUID()}`, type: 'function_call', call_id: call.id, name: tool?.name ?? fn.name, ...(tool?.namespace ? { namespace: tool.namespace } : {}), arguments: fn.arguments, status: 'completed' };
}

function usage(value: Item | undefined) {
  return { input_tokens: value?.prompt_tokens ?? 0, output_tokens: value?.completion_tokens ?? 0, total_tokens: value?.total_tokens ?? 0,
    input_tokens_details: { cached_tokens: value?.prompt_tokens_details?.cached_tokens ?? 0 }, output_tokens_details: { reasoning_tokens: value?.completion_tokens_details?.reasoning_tokens ?? 0 } };
}

// Unindexed fragments with an ID resume that call even when parallel calls interleave.
// A new ID or a name without an ID starts a call; bare arguments resume the last updated call.
function unindexedCallSlot(calls: Map<number, Item>, call: Item, lastIndex: number): number {
  if (call.id) {
    for (const [index, current] of calls) if (current.id === call.id) return index;
  }
  if (!calls.size) return 0;
  return call.id || call.function?.name ? Math.max(...calls.keys()) + 1 : lastIndex;
}

export async function chatToResponses(response: Response, tools: Map<string, Tool>, model: unknown): Promise<Response> {
  const id = `resp_${randomUUID()}`; const created = Math.floor(Date.now() / 1000);
  const envelope = (output: Item[], status = 'completed', tokenUsage?: Item) => ({ id, object: 'response', created_at: created, status, model, output, usage: usage(tokenUsage), error: null });
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const payload = await response.json();
    if (payload.error) return Response.json(payload);
    const choice = payload.choices?.[0];
    if (!choice || !['stop', 'tool_calls', 'length'].includes(choice.finish_reason)) throw new GatewayError('invalid_gateway_response');
    const output: Item[] = [];
    if (typeof choice.message?.content === 'string' && choice.message.content) output.push({ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: choice.message.content, annotations: [] }] });
    for (const call of choice.message?.tool_calls ?? []) output.push(outputTool(call, tools));
    return Response.json(envelope(output, choice.finish_reason === 'length' ? 'incomplete' : 'completed', payload.usage));
  }
  if (!response.body) throw new GatewayError('invalid_gateway_response');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); const encoder = new TextEncoder();
  const output: Item[] = []; const calls = new Map<number, Item>();
  let lastCallIndex = 0;
  let buffer = ''; let text = ''; let message: Item | undefined; let tokenUsage: Item | undefined; let finish: string | undefined; let sequence = 0; let receivedBytes = 0;
  const event = (type: string, fields: Item) => encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...fields })}\n\n`);
  async function* events() {
    yield event('response.created', { response: envelope([], 'in_progress') });
    let ended = false;
    for (;;) {
      const chunk = await reader.read();
      receivedBytes += chunk.value?.byteLength ?? 0;
      if (receivedBytes > 64 * 1024 * 1024) throw new GatewayError('invalid_gateway_response');
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      // Normalize after decoding so split UTF-8 and CRLF frames remain valid.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (data === '[DONE]') { ended = true; break; }
        if (!data) continue;
        const payload = JSON.parse(data);
        if (payload.error) { yield event('error', { error: payload.error }); return; }
        if (payload.usage) tokenUsage = payload.usage;
        const choice = payload.choices?.[0]; if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          if (!message) {
            message = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'in_progress', content: [] };
            output.push(message);
            yield event('response.output_item.added', { output_index: 0, item: message });
            yield event('response.content_part.added', { item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
          }
          text += delta.content;
          yield event('response.output_text.delta', { item_id: message.id, output_index: 0, content_index: 0, delta: delta.content });
        }
        for (const call of delta.tool_calls ?? []) {
          const index = typeof call.index === 'number' ? call.index : unindexedCallSlot(calls, call, lastCallIndex);
          const current = calls.get(index) ?? { id: '', function: { name: '', arguments: '' } };
          if (call.id && call.id !== current.id) current.id += call.id;
          if (call.function?.name) current.function.name += call.function.name;
          if (call.function?.arguments) current.function.arguments += call.function.arguments;
          calls.set(index, current);
          lastCallIndex = index;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (buffer.length > 1024 * 1024 || text.length > 64 * 1024 * 1024) throw new GatewayError('invalid_gateway_response');
      if (chunk.done || ended) break;
    }
    if (!finish || !['stop', 'tool_calls', 'length'].includes(finish)) throw new GatewayError('request_outcome_unknown', 409);
    if (message) {
      message.status = 'completed'; message.content = [{ type: 'output_text', text, annotations: [] }];
      yield event('response.output_text.done', { item_id: message.id, output_index: 0, content_index: 0, text });
      yield event('response.content_part.done', { item_id: message.id, output_index: 0, content_index: 0, part: message.content[0] });
      yield event('response.output_item.done', { output_index: 0, item: message });
    }
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      const item = outputTool(call, tools); const index = output.length; output.push(item);
      yield event('response.output_item.added', { output_index: index, item: { ...item, status: 'in_progress', ...(item.type === 'function_call' ? { arguments: '' } : { input: '' }) } });
      yield event(item.type === 'function_call' ? 'response.function_call_arguments.done' : 'response.custom_tool_call_input.done', { item_id: item.id, output_index: index, arguments: item.arguments, input: item.input });
      yield event('response.output_item.done', { output_index: index, item });
    }
    yield event(finish === 'length' ? 'response.incomplete' : 'response.completed', { response: envelope(output, finish === 'length' ? 'incomplete' : 'completed', tokenUsage) });
  }
  const generator = events();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const next = await generator.next(); if (next.done) { controller.close(); await reader.cancel(); } else controller.enqueue(next.value); }
      catch (error) { await reader.cancel().catch(() => undefined); controller.error(error); }
    },
    async cancel() { await reader.cancel(); await generator.return(); }
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}
