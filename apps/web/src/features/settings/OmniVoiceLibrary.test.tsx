import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { OmniVoiceLibrary } from './OmniVoiceLibrary.js';

// jsdom does not implement the browser's modal top layer.
const dialogProto = HTMLDialogElement.prototype;
const originalShow = dialogProto.showModal;
const originalClose = dialogProto.close;
beforeAll(() => {
  dialogProto.showModal = function () { this.open = true; };
  dialogProto.close = function () { this.open = false; };
});
afterAll(() => { dialogProto.showModal = originalShow; dialogProto.close = originalClose; });

it('adds a voice with the same name in a different language alongside a legacy voice', async () => {
  const uploadOmniVoiceReference = vi.fn().mockResolvedValue({ path: '/recordings/second.wav' });
  const onAdd = vi.fn().mockReturnValue(true);
  render(<LanguageProvider><OmniVoiceLibrary onAdd={onAdd}
    service={{ uploadOmniVoiceReference } as unknown as CreatorServicesSettingsService}
    profiles={[{ id: 'one', name: 'Rina', region: '印尼', language: 'id', referenceAudio: '/recordings/first.wav' }]} />
  </LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '管理 OmniVoice 音色库' }));
  expect(screen.getByRole('dialog', { name: 'OmniVoice 音色库' })).toBeVisible();
  expect(screen.getByText('Rina')).toBeVisible();
  expect(screen.queryByLabelText('国家/地区')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '添加音色' }));
  fireEvent.change(screen.getByLabelText('配音语言'), { target: { value: 'ms' } });
  fireEvent.change(screen.getByLabelText('声音性别'), { target: { value: 'male' } });
  fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: 'Rina' } });
  const file = new File(['recording'], 'reference.wav', { type: 'audio/wav' });
  fireEvent.change(screen.getByLabelText(/参考录音/), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '保存音色' }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
    id: expect.stringMatching(/^omnivoice-custom-/), gender: 'male', name: 'Rina', language: 'ms', referenceAudio: '/recordings/second.wav'
  })));
  expect(uploadOmniVoiceReference).toHaveBeenCalledWith(file);
  expect(screen.getByRole('button', { name: '添加音色' })).toHaveFocus();
});

it('opens an empty library, cancels an import and applies the optional reference path', async () => {
  const onSaveReference = vi.fn().mockResolvedValue(true);
  render(<LanguageProvider><OmniVoiceLibrary service={{ uploadOmniVoiceReference: vi.fn() } as unknown as CreatorServicesSettingsService} onAdd={() => true}
    referenceAudio="/old.wav" onSaveReference={onSaveReference} /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: '管理 OmniVoice 音色库' });
  fireEvent.click(trigger);
  expect(screen.getByText('还没有自定义音色')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '添加音色' }));
  expect(screen.getByRole('button', { name: '保存音色' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByText('高级设置'));
  fireEvent.change(screen.getByLabelText('默认参考录音路径（选填）'), { target: { value: '/new.wav' } });
  fireEvent.click(screen.getByRole('button', { name: '应用路径' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '关闭音色库' })).toBeEnabled());
  expect(onSaveReference).toHaveBeenCalledWith('/new.wav');
  fireEvent.click(screen.getByRole('button', { name: '关闭音色库' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('rejects a duplicate and retains the uploaded recording when a save needs a retry', async () => {
  const uploadOmniVoiceReference = vi.fn().mockResolvedValue({ path: '/voice.wav' });
  const onAdd = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<LanguageProvider><OmniVoiceLibrary onAdd={onAdd}
    profiles={[{ name: 'Rina', language: 'id', region: '印尼', id: 'one', referenceAudio: '/first.wav' }]}
    service={{ uploadOmniVoiceReference } as unknown as CreatorServicesSettingsService} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: '管理 OmniVoice 音色库' }));
  fireEvent.click(screen.getByRole('button', { name: '添加音色' }));
  fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: 'Rina' } });
  fireEvent.change(screen.getByLabelText('参考录音'), { target: { files: [new File(['audio'], 'voice.wav')] } });
  const save = screen.getByRole('button', { name: '保存音色' });
  expect(save).toBeDisabled();
  const gender = screen.getByRole('combobox', { name: '声音性别' });
  expect(within(gender).getAllByRole('option').map(option => option.textContent)).toEqual(['男声', '女声']);
  fireEvent.change(gender, { target: { value: 'female' } });
  fireEvent.click(save);
  expect(screen.getByRole('alert')).toHaveTextContent('已有同名音色');
  expect(uploadOmniVoiceReference).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: 'Ayu' } });
  fireEvent.click(save);
  expect(await screen.findByText('音色未保存，请重试。')).toBeVisible();
  fireEvent.click(save);
  await screen.findByRole('button', { name: '添加音色' });
  expect(uploadOmniVoiceReference).toHaveBeenCalledTimes(1);
  expect(onAdd).toHaveBeenCalledTimes(2);
});
