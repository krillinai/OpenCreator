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
        path="docs/design/enterprise-agent-workbench.md"
        content="# Workbench"
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
        path="docs/design/enterprise-agent-workbench.md"
        content="# Workbench"
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
});
