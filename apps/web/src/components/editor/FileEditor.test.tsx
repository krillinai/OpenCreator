import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileEditor } from './FileEditor.js';

describe('FileEditor', () => {
  it('uses local draft save copy and calls onSave when clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <FileEditor
        path="docs/design/enterprise-agent-dashboard.md"
        content="# Dashboard"
        dirty={false}
        onChange={vi.fn()}
        onSave={onSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: '保存到本地草稿' });
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();

    await user.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('disables local draft save while saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <FileEditor
        path="docs/design/enterprise-agent-dashboard.md"
        content="# Dashboard"
        dirty={true}
        saving={true}
        onChange={vi.fn()}
        onSave={onSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: '保存到本地草稿' });
    expect(saveButton).toBeDisabled();

    await user.click(saveButton);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a lightweight file loading error without hiding the draft editor', () => {
    render(
      <FileEditor
        path="docs/design/enterprise-agent-dashboard.md"
        content={'# Dashboard\nunsaved edit'}
        dirty={true}
        loadError="无法加载文件"
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText('无法加载文件')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'docs/design/enterprise-agent-dashboard.md 编辑器' })).toHaveValue(
      '# Dashboard\nunsaved edit'
    );
  });

  it('combines load and save errors into one status region', () => {
    render(
      <FileEditor
        path="docs/design/enterprise-agent-dashboard.md"
        content="# Dashboard"
        dirty={true}
        loadError="无法加载文件"
        saveError="保存到本地草稿失败"
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('无法加载文件')).toBeInTheDocument();
    expect(screen.getByText('保存到本地草稿失败')).toBeInTheDocument();
  });

  it('keeps markdown content as raw editable text', () => {
    render(
      <FileEditor
        path="README.md"
        content={'# OpenCreator\n\n**raw**'}
        dirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole('textbox', { name: 'README.md 编辑器' })).toHaveValue('# OpenCreator\n\n**raw**');
    expect(screen.queryByRole('heading', { name: 'OpenCreator' })).not.toBeInTheDocument();
  });
});
