import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import OfficialModelSelect from './OfficialModelSelect.js';

function catalog() {
  const models = Array.from({ length: 12 }, (_, index) => ({ id: `vendor/model-${index}`, name: `Model ${index}`, modality: 'text' as const, capabilities: ['responses'] }));
  models.push({ id: 'openrouter/auto', name: 'OpenRouter Automatic', modality: 'text', capabilities: ['responses'] });
  return models;
}

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
  expect(screen.getByText('1 个匹配模型')).toBeInTheDocument();
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
