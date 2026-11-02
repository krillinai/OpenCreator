import { expect, it, vi } from 'vitest';
import type { GatewayAccountState } from '@opencreator/protocol';
import type { AppServerRuntimeExecution, AppServerRuntimeManager, AppServerRuntimeTurnInput } from '../../src/codex/app-server-runtime-manager.js';
import { GatewayError } from '../../src/gateway/client.js';
import { createRuntimeSource } from '../../src/gateway/runtime-source.js';

function fixture() {
  const execution: AppServerRuntimeExecution = {
    started: Promise.resolve({ pid: 1, reused: false, generation: 1 }),
    result: Promise.resolve({ threadId: 'upstream-thread', turnId: 'turn', turnStatus: 'completed', stderr: '',
      terminationReason: 'completed', outputTruncation: { stderr: { truncated: false, droppedItems: 0, droppedBytes: 0 }, frames: { truncated: false, droppedItems: 0, droppedBytes: 0 } } }),
    cancel: vi.fn(), steer: vi.fn(async () => ({ turnId: 'turn' }))
  };
  const startTurn = vi.fn(() => execution);
  const official = { startTurn } as unknown as AppServerRuntimeManager;
  const manual = { startTurn: vi.fn(() => execution) } as unknown as AppServerRuntimeManager;
  const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'account', email: 'test@example.test', verified: true }, bindingVersion: '1', activationError: null,
    selectedModels: { text: 'vendor/text' }, models: [{ id: 'vendor/text', modality: 'text', capabilities: ['responses'] }] };
  const input: AppServerRuntimeTurnInput = { scope: { kind: 'project', id: 'project' }, runId: 'run',
    cwd: '/tmp', sandbox: 'danger-full-access', model: 'vendor/text', profile: 'default', prompt: 'Hello',
    thread: { id: 'thread', projectId: 'project', title: null, origin: 'opencreator_created', cwd: '/tmp', canonicalCwd: '/tmp',
      workspaceMode: 'external', profile: 'default', sandbox: 'danger-full-access', status: 'active', purpose: 'conversation',
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } };
  return { execution, startTurn, official, manual, state, input };
}

it('starts a catalog-compatible turn immediately without an extra inference request', async () => {
  const f = fixture();
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  const execution = source.startTurn(f.input);
  expect(execution).toBe(f.execution);
  expect(f.startTurn).toHaveBeenCalledOnce();
  await expect(execution.started).resolves.toMatchObject({ pid: 1 });
  await expect(execution.result).resolves.toMatchObject({ turnStatus: 'completed' });
  expect(f.startTurn).toHaveBeenCalledOnce();
  await execution.steer!({ message: 'Continue' });
  execution.cancel();
  expect(f.execution.steer).toHaveBeenCalledWith({ message: 'Continue' });
  expect(f.execution.cancel).toHaveBeenCalledOnce();
});

it('rejects incompatible models before starting a user turn', () => {
  const f = fixture();
  f.state.models[0]!.capabilities = [];
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  expect(() => source.startTurn(f.input)).toThrow(expect.objectContaining({ code: 'invalid_model' }));
  expect(f.startTurn).not.toHaveBeenCalled();
});

it('passes actual inference failures through without submitting a second turn', async () => {
  const f = fixture();
  f.execution.result = Promise.reject(new GatewayError('credits_insufficient', 402));
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  const execution = source.startTurn(f.input);
  await expect(execution.result).rejects.toMatchObject({ code: 'credits_insufficient' });
  expect(f.startTurn).toHaveBeenCalledOnce();
});

it('keeps manual service turns free of official probes', () => {
  const f = fixture(); f.state.source = 'manual';
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  expect(source.startTurn(f.input)).toBe(f.execution);
});

it.each([
  ['expired', 'expired', 'inactive', 'auth_required', 401],
  ['signed_out', 'signed_out', 'inactive', 'auth_required', 401],
  ['loading', 'signed_in', 'loading', 'services_not_ready', 503],
  ['blocked', 'signed_in', 'blocked', 'services_not_ready', 503]
] as const)('reports gateway %s as %s without changing service readiness semantics', (_label, authState, activationState, code, status) => {
  const f = fixture();
  f.state.authState = authState;
  f.state.activationState = activationState;
  if (authState === 'signed_out') {
    f.state.account = null;
    f.state.bindingVersion = null;
  }
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  expect(() => source.startTurn(f.input)).toThrow(expect.objectContaining({ code, status }));
  expect(f.startTurn).not.toHaveBeenCalled();
});

it('rejects a missing selected model without silently using another model', () => {
  const f = fixture();
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  expect(() => source.startTurn({ ...f.input, model: 'removed-model' })).toThrow(expect.objectContaining({ code: 'invalid_model' }));
  expect(f.startTurn).not.toHaveBeenCalled();
});

it('uses the same selected text model as workflows and never substitutes the first gateway model', () => {
  const f = fixture(); f.state.transport = 'gateway';
  f.state.models = [{ id: 'gpt-6.1-sol', modality: 'text', capabilities: ['responses', 'chat'] },
    { id: 'gpt-6.2-sol', modality: 'text', capabilities: ['responses', 'chat'] }];
  f.state.selectedModels = { text: 'gpt-6.2-sol' };
  const source = createRuntimeSource(f.manual, () => f.state, () => f.official);
  source.startTurn({ ...f.input, model: undefined });
  expect(f.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'gpt-6.2-sol' }));
  f.state.selectedModels = {};
  expect(() => source.startTurn({ ...f.input, model: undefined })).toThrow(expect.objectContaining({ code: 'invalid_model' }));
});
