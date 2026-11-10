import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import OfficialModelSelect from './OfficialModelSelect.js';
import { gatewayRecommendedModelId, type GatewayModel } from '@opencreator/protocol';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';

function catalog() {
  const models = Array.from({ length: 12 }, (_, index) => ({ id: `vendor/model-${index}`, name: `Model ${index}`, modality: 'text' as const, capabilities: ['responses'] }));
  models.push({ id: 'openrouter/auto', name: 'OpenRouter Automatic', modality: 'text', capabilities: ['responses'] });
  return models;
}

it('shows speech token tariffs alongside character rates without implying a fixed per-call charge', async () => {
  const models: GatewayModel[] = [
    { id: 'grok-tts', name: 'grok-tts', modality: 'speech', capabilities: [],
      price: { version: 'db-1', perMillionCharacters: 4706.620646375902, estimates: { call: { creditUnits: '4706621', usage: { base: 1000 } } } } },
    { id: 'gemini-2.5-flash-tts', name: 'gemini-2.5-flash-tts', modality: 'speech', capabilities: [],
      price: { version: 'db-1', inputPerMillion: 156.88735487919675, outputPerMillion: 3137.7470975839346,
        estimates: { call: { creditUnits: '3153436', usage: { input: 100, output: 1000 } } } } },
    { id: 'gemini-2.5-pro-tts', name: 'gemini-2.5-pro-tts', modality: 'speech', capabilities: [],
      price: { version: 'db-1', inputPerMillion: 313.7747097583935, outputPerMillion: 6275.494195167869,
        estimates: { call: { creditUnits: '6306872', usage: { input: 100, output: 1000 } } } } }
  ];
  const change = vi.fn();
  render(<OfficialModelSelect label="语音合成模型" models={models} value="grok-tts" onChange={change} />);
  await userEvent.setup().click(screen.getByRole('combobox', { name: '语音合成模型' }));
  expect(screen.getByRole('option', { name: 'grok-tts' })).toHaveTextContent('约 5 积分/1000字符');
  const flash = screen.getByRole('option', { name: 'gemini-2.5-flash-tts' });
  expect(flash).toHaveTextContent('文本输入 157 / 音频输出 3138 积分/百万 token');
  expect(flash.title).toContain('按实际文本输入及音频输出用量结算');
  expect(screen.getByRole('option', { name: 'gemini-2.5-pro-tts' })).toHaveTextContent('文本输入 314 / 音频输出 6275 积分/百万 token');
  expect(screen.getByRole('listbox')).not.toHaveTextContent('积分/次');
  expect(change).not.toHaveBeenCalled();
});

it('shows locally hosted brand marks and only model-supported video details', async () => {
  const models = [
    { id: 'bytedance/seedance-2', name: 'Seedance 2.0', modality: 'video' as const, capabilities: [], durations: [5, 10] },
    { id: 'google/veo-3.1', name: 'Veo 3.1', modality: 'video' as const, capabilities: [], durations: [4, 8], resolutions: ['720p'] },
    { id: 'custom/private-video', name: 'Private Video', modality: 'video' as const, capabilities: [] }
  ];
  render(<OfficialModelSelect label="视频模型" models={models} value={models[0]!.id} onChange={vi.fn()} />);
  const input = screen.getByRole('combobox');
  expect(input.parentElement?.querySelector('[data-brand="bytedance"] img')).toHaveAttribute('src', '/model-brands/bytedance-color.svg');
  await userEvent.setup().click(input);
  const veo = screen.getByRole('option', { name: 'Veo 3.1' });
  expect(veo.querySelector('[data-brand="google"] img')).toHaveAttribute('src', '/model-brands/google-color.svg');
  expect(veo).toHaveTextContent('时长 4、8 秒 · 720p');
  const unknown = screen.getByRole('option', { name: 'Private Video' });
  expect(unknown.querySelector('[data-brand="generic"] svg')).not.toBeNull();
  expect(unknown).not.toHaveTextContent(/秒|720p/);
  expect(within(unknown).queryByRole('img')).not.toBeInTheDocument();
});

it('keeps options usable if a brand image fails to load', async () => {
  const change = vi.fn();
  render(<OfficialModelSelect label="模型" models={[{ id: 'kling-v2-1-master', name: 'Kling 2.1 Master', modality: 'video', capabilities: [] }]} value="" onChange={change} />);
  await userEvent.setup().click(screen.getByRole('combobox'));
  const option = screen.getByRole('option', { name: 'Kling 2.1 Master' });
  fireEvent.error(option.querySelector('img')!);
  expect(option.querySelector('img')).toBeNull();
  expect(option.querySelector('svg')).not.toBeNull();
  await userEvent.setup().click(option);
  expect(change).toHaveBeenCalledExactlyOnceWith('kling-v2-1-master');
});

it('localizes branded video metadata and search states in Swedish', async () => {
  render(<LanguageProvider initialPreference="sv-SE"><OfficialModelSelect label="Videomodell" models={[{
    id: 'google/veo-3.1', name: 'Veo 3.1', modality: 'video', capabilities: [], durations: [4, 8]
  }]} value="google/veo-3.1" onChange={vi.fn()} /></LanguageProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Videomodell' }));
  expect(screen.getByRole('option', { name: 'Veo 3.1' })).toHaveTextContent('Längd 4, 8 sekunder');
  expect(screen.queryByText('1 modeller')).not.toBeInTheDocument();
  await user.type(screen.getByRole('combobox'), 'zzzzzzzzzz');
  expect(screen.getByText('Inga matchande modeller')).toBeInTheDocument();
});

it('shows concise duration and per-resolution pricing for recommended video models without a menu heading', async () => {
  const video: GatewayModel = { id: 'sd-2.5', name: 'SD 2.5', modality: 'video', capabilities: [],
    durations: Array.from({ length: 27 }, (_, index) => index + 4), resolutions: ['480p', '720p', '1080p'],
    price: { version: 'db-1', videoUnitsPerSecond: { '480p': 10_000_000, '720p': 30_000_000, '1080p': 60_000_000 } } };
  const change = vi.fn();
  render(<OfficialModelSelect label="视频模型" models={[video]} value={video.id} recommendedModel={video} followsRecommendation onChange={change} />);
  await userEvent.setup().click(screen.getByRole('combobox', { name: '视频模型' }));
  expect(screen.queryByText('按秒计费，价格随清晰度变化')).not.toBeInTheDocument();
  const option = screen.getByRole('option', { name: '系统推荐 · SD 2.5' });
  expect(option).toHaveTextContent('时长 4–30 秒 · 480p / 720p / 1080p');
  expect(option).toHaveTextContent('720p：每秒约 30 积分');
  expect(option).not.toHaveTextContent('4 / 5 / 6');
  expect(option.title).toContain('费用 = 每秒积分 × 视频秒数');
  expect(option.title).toContain('例如生成 5 秒 720p 视频，约 150 积分');
  expect(option.title).toContain('1080p：每秒约 60 积分');
  expect(change).not.toHaveBeenCalled();
});

it.each([
  [[4, 5, 6, 7, 8], '时长 4–8 秒'],
  [[4, 6, 8], '时长 4、6、8 秒'],
  [[8], '时长 8 秒'],
  [[6, 4, 5, 4, 10], '时长 4–6、10 秒'],
  [[NaN, Infinity, -1, 0, 4, 6], '时长 4、6 秒'],
  [[0.5, 1.5], '时长 0.5、1.5 秒']
] as const)('compacts supported durations %j without inventing unsupported choices', async (durations, label) => {
  const video: GatewayModel = { id: 'video', name: 'Video', modality: 'video', capabilities: [], durations: [...durations] };
  render(<OfficialModelSelect label="视频模型" models={[video]} value="video" onChange={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole('combobox'));
  expect(screen.getByRole('option', { name: 'Video' })).toHaveTextContent(label);
});

it('shows search results immediately in the same control without retaining unrelated selected models', async () => {
  const models = catalog(); const change = vi.fn();
  const view = render(<OfficialModelSelect label="文本模型" models={models} value="vendor/model-0" onChange={change} />);
  const user = userEvent.setup(); const input = screen.getByRole('combobox', { name: '文本模型' });
  expect(input).toHaveValue('Model 0');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  await user.click(input);
  expect(screen.getByRole('option', { name: 'Model 0' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText(/OpenRouter/i)).not.toBeInTheDocument();
  await user.type(input, 'Model 11');
  const list = screen.getByRole('listbox', { name: '文本模型' });
  expect(within(list).getAllByRole('option')).toHaveLength(1);
  expect(screen.queryByText('1 个匹配项')).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
  await user.click(within(list).getByRole('option', { name: 'Model 11' }));
  expect(change).toHaveBeenCalledWith('vendor/model-11');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  view.rerender(<OfficialModelSelect label="文本模型" models={models} value="vendor/model-11" onChange={change} />);
  expect(input).toHaveValue('Model 11');
});

it('matches names, provider IDs, punctuation and multiple keywords, with typo tolerance', async () => {
  const models = [
    { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini', modality: 'text' as const, capabilities: ['responses'] },
    { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', modality: 'text' as const, capabilities: ['responses'] },
    ...catalog(),
  ];
  render(<OfficialModelSelect label="文本模型" models={models} value="vendor/model-0" onChange={vi.fn()} />);
  const user = userEvent.setup(); const input = screen.getByRole('combobox');
  await user.click(input);
  for (const query of ['MINI gPt 4.o', 'openai/gpt_4o_mini']) {
    await user.clear(input); await user.type(input, query);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'OpenAI: GPT-4o Mini' })).toBeInTheDocument();
  }
  await user.clear(input); await user.type(input, 'depseek');
  expect(screen.getAllByRole('option')[0]).toHaveAccessibleName('DeepSeek V3.2');
});

it('preserves the selection when no model matches or the user cancels and resets search on reopening', async () => {
  const change = vi.fn();
  render(<><OfficialModelSelect label="文本模型" models={catalog()} value="vendor/model-0" onChange={change} /><button>外部操作</button></>);
  const user = userEvent.setup(); const input = screen.getByRole('combobox');
  await user.click(input); await user.type(input, 'zzzzzzzzzzzz');
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
  expect(screen.getByText('未找到匹配模型')).toBeInTheDocument();
  await user.keyboard('{Enter}'); expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '外部操作' }));
  expect(input).toHaveValue('Model 0');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.click(input);
  expect(screen.getAllByRole('option')).toHaveLength(13);
  expect(input).toHaveValue('');
  await user.type(input, 'Model 11'); await user.keyboard('{Escape}');
  expect(input).toHaveValue('Model 0'); expect(change).not.toHaveBeenCalled();
});

it('supports keyboard navigation, selection and tab dismissal without moving focus into the menu', async () => {
  const change = vi.fn();
  render(<><OfficialModelSelect label="文本模型" models={catalog()} value="vendor/model-0" onChange={change} /><button>下一个控件</button></>);
  const user = userEvent.setup(); const input = screen.getByRole('combobox');
  await user.tab();
  expect(input).toHaveFocus(); expect(input).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{ArrowDown}');
  expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Model 1' }).id);
  await user.keyboard('{Enter}'); expect(change).toHaveBeenCalledWith('vendor/model-1');
  expect(input).toHaveFocus(); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { name: '下一个控件' })).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('clears a query without changing the selection and does not resubmit the selected model', async () => {
  const change = vi.fn(); render(<OfficialModelSelect label="文本模型" models={catalog()} value="vendor/model-0" onChange={change} />);
  const user = userEvent.setup(); const input = screen.getByRole('combobox');
  await user.click(input); await user.type(input, 'Model 11');
  await user.click(screen.getByRole('button', { name: '清空模型搜索' }));
  expect(input).toHaveFocus(); expect(input).toHaveValue('');
  expect(screen.getAllByRole('option')).toHaveLength(13);
  await user.click(screen.getByRole('option', { name: 'Model 0' }));
  expect(change).not.toHaveBeenCalled(); expect(input).toHaveValue('Model 0');
});

it('does not select a model when Enter confirms an IME composition', async () => {
  const change = vi.fn(); render(<OfficialModelSelect label="文本模型" models={catalog()} value="vendor/model-0" onChange={change} />);
  const input = screen.getByRole('combobox');
  await userEvent.setup().click(input); fireEvent.change(input, { target: { value: 'Model 11' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(change).not.toHaveBeenCalled(); expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter' }); expect(change).toHaveBeenCalledWith('vendor/model-11');
});

it('closes when disabled and retains accessibility descriptions and the selected model', async () => {
  const change = vi.fn(); const models = catalog();
  const view = render(<OfficialModelSelect label="文本模型" describedBy="model-count" models={models} value="vendor/model-0" onChange={change} />);
  const input = screen.getByRole('combobox'); await userEvent.setup().click(input);
  view.rerender(<OfficialModelSelect label="文本模型" describedBy="model-count" models={models} value="vendor/model-0" disabled onChange={change} />);
  expect(input).toBeDisabled(); expect(input).toHaveValue('Model 0');
  expect(input).toHaveAttribute('aria-describedby', 'model-count');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(change).not.toHaveBeenCalled();
});

it('lists the recommended model once and can search its original ID', async () => {
  const recommended: GatewayModel = { id: 'openai/gpt-image-2.5-flare', name: 'GPT Image Flare', vendor: 'OpenAI', modality: 'image', capabilities: [], price: { version: 'v1', billing: 'usage', inputPerMillion: 5229.58, outputPerMillion: 31377.47, estimates: { image: { creditUnits: '64000000', images: 1 } } } };
  const other: GatewayModel = { ...recommended, id: 'openai/gpt-image-2.5-sunburst', name: 'GPT Image Sunburst' };
  const change = vi.fn();
  render(<OfficialModelSelect label="图片模型" models={[recommended, other]} value={recommended.id} recommendedModel={recommended} followsRecommendation onChange={change} />);
  const user = userEvent.setup();
  const input = screen.getByRole('combobox');
  await user.click(input);
  expect(screen.queryByText('2 个模型')).not.toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.queryByRole('option', { name: 'GPT Image Flare' })).not.toBeInTheDocument();
  const option = screen.getByRole('option', { name: '系统推荐 · GPT Image Flare' });
  expect(option).toHaveAttribute('aria-selected', 'true');
  expect(within(option).getByText('约 64 积分/张')).toBeInTheDocument();
  expect(option.title).toContain('按服务器提供的图片规格估算');
  await user.type(input, recommended.id);
  expect(screen.getAllByRole('option')).toHaveLength(1);
  await user.keyboard('{Enter}');
  expect(change).not.toHaveBeenCalled();
  expect(input).toHaveValue('系统推荐 · GPT Image Flare');
});

it('preserves a manual selection matching the recommendation and can enable future recommendations', async () => {
  const recommended = catalog()[0]!;
  const change = vi.fn();
  const view = render(<OfficialModelSelect label="文本模型" models={catalog()} value={recommended.id} recommendedModel={recommended} followsRecommendation={false} onChange={change} />);
  const input = screen.getByRole('combobox');
  const user = userEvent.setup();
  expect(input).toHaveValue('系统推荐 · Model 0');
  await user.click(input);
  expect(screen.getAllByRole('option')).toHaveLength(13);
  await user.click(screen.getByRole('option', { name: '系统推荐 · Model 0', selected: true }));
  expect(change).toHaveBeenCalledWith(gatewayRecommendedModelId);
  const next = catalog()[1]!;
  view.rerender(<OfficialModelSelect label="文本模型" models={catalog()} value={recommended.id} recommendedModel={next} followsRecommendation={false} onChange={change} />);
  expect(input).toHaveValue('Model 0');
  await user.click(input);
  expect(screen.getByRole('option', { name: 'Model 0' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('option')).toHaveLength(13);
  expect(screen.queryByRole('option', { name: 'Model 1' })).not.toBeInTheDocument();
  view.rerender(<OfficialModelSelect label="文本模型" models={catalog()} value={next.id} recommendedModel={next} followsRecommendation onChange={change} />);
  await user.keyboard('{Escape}');
  expect(input).toHaveValue('系统推荐 · Model 1');
});


it('never displays relay routing in names, groups, details or tooltips, including saved IDs', async () => {
  const models: GatewayModel[] = [{ id: '88api/gpt-image-2', name: 'gpt-image-2', vendor: '88api', modality: 'image', capabilities: [] },
    { id: 'chatanywhere/gpt-6-luna', name: 'ChatAnywhere: gpt-6-luna', vendor: 'ChatAnywhere', modality: 'text', capabilities: ['responses'] }];
  const change = vi.fn();
  const view = render(<OfficialModelSelect label="模型" models={models} value="88api/gpt-image-2" onChange={change} />);
  const input = screen.getByRole('combobox');
  expect(input).toHaveValue('gpt-image-2');
  await userEvent.setup().click(input);
  expect(document.body.textContent).not.toMatch(/88api|chatanywhere/i);
  for (const node of document.querySelectorAll('[title], [aria-label]')) expect(`${node.getAttribute('title')} ${node.getAttribute('aria-label')}`).not.toMatch(/88api|chatanywhere/i);
  await userEvent.setup().click(screen.getByRole('option', { name: 'gpt-6-luna' }));
  expect(change).toHaveBeenCalledWith('chatanywhere/gpt-6-luna');
  view.rerender(<OfficialModelSelect label="模型" models={[]} value="88api/gpt-image-2" onChange={change} />);
  expect(screen.getByRole('combobox')).toHaveValue('gpt-image-2');
});

it('keeps catalog brand navigation without a model count or billing heading', async () => {
  const models: GatewayModel[] = [{ id: 'bytedance/seedance-2', name: 'Seedance 2.0', modality: 'video', capabilities: [], durations: [5, 10] }];
  render(<LanguageProvider initialPreference="en-US"><OfficialModelSelect label="视频模型" layout="catalog" models={models} value={models[0]!.id} onChange={vi.fn()} /></LanguageProvider>);

  await userEvent.setup().click(screen.getByRole('combobox', { name: '视频模型' }));
  expect(document.querySelector('.official-model-menu-count')).not.toBeInTheDocument();
  expect(screen.getByText('MODELS')).toBeVisible();
  expect(screen.getByRole('option', { name: 'Seedance 2.0' })).toBeVisible();
});
