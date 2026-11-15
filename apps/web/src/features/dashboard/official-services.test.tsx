import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GatewayAccountState, GatewayModel } from '@opencreator/protocol';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { OfficialModelField, OfficialModelMemoryContext, OfficialServicesContext, useOfficialServices } from './official-services.js';

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown>, jobId: 'pending:test', templateId: 'image-generation',
  taskModels: {} as Record<string, Record<string, string>>,
  remember: undefined as undefined | ((task: string, modality: GatewayModel['modality'], model: string) => Promise<GatewayAccountState>),
  updateDraft: vi.fn() }));
vi.mock('./creator-session-store.js', () => ({ useOptionalCreatorSession: () => {
  const [state, setState] = useState(fixture.state);
  return { state, updateDraft(patch: Record<string, unknown>, options?: { persist?: boolean; userEdited?: boolean }) { fixture.updateDraft(patch, options); setState(current => ({ ...current, ...patch })); }, job: { id: fixture.jobId, templateId: fixture.templateId, status: 'draft', stages: [] } };
} }));
beforeEach(() => { fixture.jobId = 'pending:test'; fixture.templateId = 'image-generation'; fixture.taskModels = {}; fixture.remember = undefined; fixture.updateDraft.mockReset(); });

function mount(modality: GatewayModel['modality'], selected: string | null = 'vendor/first', transport?: GatewayAccountState['transport'], templateId = 'image-generation') {
  fixture.templateId = templateId;
  fixture.state = selected === null ? {} : { officialModels: { [modality]: selected } };
  fixture.updateDraft.mockImplementation(patch => { fixture.state = { ...fixture.state, ...patch }; });
  const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', activationError: null,
    transport, selectedModels: { [modality]: 'vendor/first' }, taskModels: fixture.taskModels,
    models: ['first', 'second'].map(name => ({ id: `vendor/${name}`, modality, capabilities: modality === 'transcription' ? ['subtitle_timestamps'] : ['responses','chat'] })) };
  function Field() {
    const service = useOfficialServices(modality);
    return <><OfficialModelField label="Model" service={service} /><button disabled={!service.ready}>Start</button></>;
  }
  const memory = { service: { async getState() { return { ...state, taskModels: fixture.taskModels }; },
    async rememberTaskModel(task: string, choice: GatewayModel['modality'], model: string) {
    if (fixture.remember) return fixture.remember(task, choice, model);
    fixture.taskModels = { ...fixture.taskModels, [task]: { ...fixture.taskModels[task], [choice]: model } };
    return { ...state, taskModels: fixture.taskModels };
  } }, onStateChange(next: GatewayAccountState) { fixture.taskModels = next.taskModels as Record<string, Record<string, string>>; } };
  const view = render(<LanguageProvider initialPreference="zh-CN"><OfficialModelMemoryContext.Provider value={memory}>
    <OfficialServicesContext.Provider value={state}><Field /></OfficialServicesContext.Provider>
  </OfficialModelMemoryContext.Provider></LanguageProvider>);
  return { ...view, state };
}

it.each(['text', 'image', 'video', 'speech', 'transcription'] as const)('saves a catalog-compatible %s task model without inference', async modality => {
  mount(modality);
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
  fireEvent.click(screen.getByRole('option', { name: 'second' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('second'));
  expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  expect(fixture.updateDraft).toHaveBeenCalledWith({
    officialModels: { [modality]: 'vendor/second' }, __creatorUserSelected: true
  }, undefined);
});

it('does not change an existing choice during initial model display', () => {
  mount('text');
  expect(fixture.updateDraft).not.toHaveBeenCalled();
});

it('remembers an explicitly chosen image model for the next new task', async () => {
  const first = mount('image', null, 'gateway');
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
  fireEvent.click(screen.getByRole('option', { name: 'second' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('second'));
  await waitFor(() => expect(fixture.taskModels['image-generation']?.image).toBe('vendor/second'));
  first.unmount();

  mount('image', null, 'gateway');
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('second');
});

it('keeps recent model choices separate for each task type', async () => {
  const first = mount('image', null, 'gateway', 'image-generation');
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
  fireEvent.click(screen.getByRole('option', { name: 'second' }));
  await waitFor(() => expect(fixture.taskModels['image-generation']?.image).toBe('vendor/second'));
  first.unmount();

  mount('image', null, 'gateway', 'cover');
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('first');
});

it('shows the last choice in a new task before preference persistence finishes', () => {
  let finish!: (state: GatewayAccountState) => void;
  fixture.remember = () => new Promise(resolve => { finish = resolve; });
  const first = mount('image', null, 'gateway');
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
  fireEvent.click(screen.getByRole('option', { name: 'second' }));
  first.unmount();

  mount('image', null, 'gateway');
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('second');
  finish(first.state);
});

it.each(['text', 'image', 'video', 'speech', 'transcription'] as const)('restores the last %s model for a new task', modality => {
  fixture.taskModels = { 'image-generation': { [modality]: 'vendor/second' } };
  mount(modality, null, 'gateway');
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('second');
});

it('excludes transcription models without subtitle timestamps', () => {
  fixture.state = {};
  const state: GatewayAccountState = {
    source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', activationError: null,
    selectedModels: {}, models: [
      { id: 'plain-asr', modality: 'transcription', catalogSchema: 2, capabilities: [] },
      { id: 'timestamp-asr', modality: 'transcription', catalogSchema: 2, capabilities: ['subtitle_timestamps'] }
    ]
  };
  function Field() { return <OfficialModelField label="ASR" service={useOfficialServices('transcription')} />; }
  render(<LanguageProvider initialPreference="zh-CN"><OfficialServicesContext.Provider value={state}><Field /></OfficialServicesContext.Provider></LanguageProvider>);
  fireEvent.click(screen.getByRole('combobox', { name: 'ASR' }));
  expect(screen.queryByRole('option', { name: 'plain-asr' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'timestamp-asr' })).toBeVisible();
});

it.each([false, true])('initializes only the requested modality when opening a speech field (text default: %s)', async hasTextDefault => {
  fixture.state = { officialModels: { image: 'saved-image' } };
  const state: GatewayAccountState = {
    source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', activationError: null,
    selectedModels: { speech: 'speech-model', ...(hasTextDefault ? { text: 'chosen-text' } : {}) },
    models: [
      { id: 'arbitrary-text', modality: 'text', capabilities: ['responses', 'chat'] },
      { id: 'chosen-text', modality: 'text', capabilities: ['responses', 'chat'] },
      { id: 'speech-model', modality: 'speech', capabilities: [] }
    ]
  };
  function Field() {
    const service = useOfficialServices('speech');
    return <OfficialModelField label="Speech" service={service} />;
  }
  render(<LanguageProvider initialPreference="zh-CN"><OfficialServicesContext.Provider value={state}><Field /></OfficialServicesContext.Provider></LanguageProvider>);
  await waitFor(() => expect(fixture.updateDraft).toHaveBeenCalledWith({ officialModels: { speech: 'speech-model' } }, { persist: false, userEdited: false }));
  expect(fixture.updateDraft.mock.calls.every(([patch]) => !('text' in patch.officialModels))).toBe(true);
});

it('syncs an automatic model to an existing task without recording a user choice', async () => {
  fixture.jobId = 'job_existing';
  fixture.state = {};
  const state: GatewayAccountState = {
    source: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', activationError: null,
    selectedModels: { speech: 'speech-model' },
    models: [{ id: 'speech-model', modality: 'speech', capabilities: [] }]
  };
  function Field() { return <OfficialModelField label="Speech" service={useOfficialServices('speech')} />; }
  render(<LanguageProvider initialPreference="zh-CN"><OfficialServicesContext.Provider value={state}><Field /></OfficialServicesContext.Provider></LanguageProvider>);

  await waitFor(() => expect(fixture.updateDraft).toHaveBeenCalledWith(
    { officialModels: { speech: 'speech-model' } },
    { persist: undefined, userEdited: false }
  ));
  expect(fixture.updateDraft.mock.calls.every(([patch]) => !('__creatorUserSelected' in patch))).toBe(true);
});

it('keeps a removed task choice visible and lets the user replace it without silently changing the draft', async () => {
  mount('text', 'removed-model', 'gateway');
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('removed-model');
  expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  expect(fixture.updateDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }));
  fireEvent.click(screen.getByRole('option', { name: 'second' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
});
