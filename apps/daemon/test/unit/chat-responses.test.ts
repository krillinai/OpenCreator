import { expect, it } from 'vitest';
import { chatToResponses } from '../../src/gateway/chat-responses.js';

const sse = (frames: unknown[]) => new Response(frames.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const events = async (response: Response) => (await response.text()).split('\n\n').filter(Boolean).map(frame => JSON.parse(frame.split('\n').find(l => l.startsWith('data:'))!.slice(5)));

it('reports a content-filtered non-streaming Chat response as incomplete with reason content_filter', async () => {
  const response = await chatToResponses(Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'content_filter' }] }), new Map(), 'm');
  expect(await response.json()).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [{ type: 'message' }] });
});

it('reports a content-filtered Chat stream as response.incomplete with reason content_filter', async () => {
  const response = await chatToResponses(sse([{ choices: [{ delta: { content: 'partial' } }] }, { choices: [{ delta: {}, finish_reason: 'content_filter' }] }]), new Map(), 'm');
  expect((await events(response)).at(-1)).toMatchObject({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } } });
});

it('still completes normally and keeps length as incomplete', async () => {
  const stop = await chatToResponses(Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), new Map(), 'm');
  const body = await stop.json();
  expect(body).toMatchObject({ status: 'completed' });
  expect(body).not.toHaveProperty('incomplete_details');
  const length = await chatToResponses(sse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] }]), new Map(), 'm');
  expect((await events(length)).at(-1)).toMatchObject({ type: 'response.incomplete', response: { status: 'incomplete' } });
});
