import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

const projects = [
  {
    id: 'content-design',
    name: 'content-design',
    cwd: '~/develop/content-design',
    sandbox: 'danger-full-access' as const,
    profile: 'default',
    model: null,
    reasoning: null
  },
  {
    id: 'playground',
    name: 'Playground',
    cwd: '~/develop/clawee/playground',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null
  },
  {
    id: 'cover',
    name: 'cover',
    cwd: '~/develop/clawee/cover',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null
  }
];

const defaultProps = {
  projectId: 'content-design',
  projectName: 'content-design',
  projects,
  permission: 'danger-full-access' as const,
  profile: 'default',
  model: null,
  reasoning: null,
  onSelectProject: vi.fn(),
  onSubmit: vi.fn()
};

describe('Composer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows codex-style composer controls', () => {
    render(<Composer {...defaultProps} permission="workspace-write" />);

    expect(screen.getByRole('button', { name: '选择项目 content-design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 工作区读写' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.queryByText('跟随全局配置')).not.toBeInTheDocument();
    expect(screen.queryByText('本地模式')).not.toBeInTheDocument();
    expect(screen.queryByText('open-clawee')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('随心输入')).toBeInTheDocument();
  });

  it('searches projects and switches the conversation workspace', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    render(<Composer {...defaultProps} onSelectProject={onSelectProject} />);

    await user.click(screen.getByRole('button', { name: '选择项目 content-design' }));

    expect(screen.getByRole('dialog', { name: '选择项目' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'content-design' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.type(screen.getByRole('searchbox', { name: '搜索项目' }), 'play');

    expect(screen.getByRole('option', { name: 'Playground' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'cover' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Playground' }));

    expect(onSelectProject).toHaveBeenCalledWith('playground');
    expect(screen.queryByRole('dialog', { name: '选择项目' })).not.toBeInTheDocument();
  });

  it('closes the project menu without resetting the current project', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    render(<Composer {...defaultProps} onSelectProject={onSelectProject} />);

    await user.click(screen.getByRole('button', { name: '选择项目 content-design' }));
    await user.click(screen.getByRole('option', { name: 'content-design' }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '选择项目' })).not.toBeInTheDocument();
  });

  it('opens menus and submits selected permission and model config', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} permission="workspace-write" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: '选择访问权限 工作区读写' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));

    await user.click(screen.getByRole('button', { name: '选择模型 默认模型' }));
    await user.click(screen.getByRole('menuitemradio', { name: /默认模型 超高/ }));

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: 'xhigh'
    }, []);
    expect(textbox).toHaveValue('');
  });

  it('hides Profile controls while preserving the configured Profile', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Composer
        {...defaultProps}
        profile="review"
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Profile' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '检查改动');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('检查改动', {
      permission: 'danger-full-access',
      profile: 'review',
      model: null,
      reasoning: null
    }, []);
  });

  it('does not expose the Profile for an existing conversation', () => {
    render(
      <Composer
        {...defaultProps}
        profile="review"
      />
    );

    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
  });

  it('opens the add context menu', async () => {
    const user = userEvent.setup();
    render(<Composer {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '添加上下文' }));

    expect(screen.getByRole('menu', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '添加图片' })).toBeInTheDocument();
  });

  it('is disabled when current thread has an active run', () => {
    render(<Composer {...defaultProps} disabled disabledReason="当前对话有任务运行中" />);

    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.getByPlaceholderText('当前对话有任务运行中')).toBeInTheDocument();
  });

  it('keeps input available while running and submits queued or interrupting follow-ups', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer
        {...defaultProps}
        running
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    expect(textbox).toBeEnabled();
    await user.type(textbox, '排队任务');
    await user.click(screen.getByRole('button', { name: '排队发送' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      '排队任务',
      expect.any(Object),
      [],
      'enqueue'
    );

    await user.type(textbox, '打断任务');
    await user.click(screen.getByRole('button', { name: '选择发送方式' }));
    await user.click(screen.getByRole('menuitemradio', { name: /立即打断并继续/ }));
    await user.click(screen.getByRole('button', { name: '立即打断并继续' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      '打断任务',
      expect.any(Object),
      [],
      'interrupt_and_enqueue'
    );

    await user.click(screen.getByRole('button', { name: '停止任务' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <Composer
        {...defaultProps}
        running
        canceling
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('button', { name: '正在停止任务' })).toBeDisabled();
  });

  it('keeps permission and model controls visible when disabled', () => {
    render(<Composer {...defaultProps} disabled />);

    expect(screen.getByRole('button', { name: '选择访问权限 完全访问' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
  });

  it('submits the trimmed prompt and clears the textbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: null
    }, []);
    expect(textbox).toHaveValue('');
  });

  it('auto-sizes the textbox to its content and resets after submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get() {
        return textbox.value.includes('\n') ? 52 : 28;
      }
    });

    await user.type(textbox, 'first line');
    await waitFor(() => expect(textbox.style.height).toBe('28px'));

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textbox, 'second line');
    await waitFor(() => expect(textbox.style.height).toBe('52px'));

    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('first line\nsecond line', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: null
    }, []);
    await waitFor(() => expect(textbox.style.height).toBe('28px'));
  });

  it('caps the textbox at three lines and scrolls to keep the latest input visible', async () => {
    render(<Composer {...defaultProps} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    let assignedScrollTop = 0;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get() {
        const lineCount = textbox.value.split('\n').length;
        if (lineCount >= 4) return 100;
        if (lineCount === 3) return 76;
        if (lineCount === 2) return 52;
        return 28;
      }
    });
    Object.defineProperty(textbox, 'scrollTop', {
      configurable: true,
      get() {
        return assignedScrollTop;
      },
      set(value: number) {
        assignedScrollTop = value;
      }
    });

    fireEvent.change(textbox, { target: { value: 'first\nsecond\nthird\nfourth' } });

    await waitFor(() => {
      expect(textbox.style.height).toBe('76px');
      expect(textbox.style.overflowY).toBe('auto');
      expect(textbox.scrollTop).toBe(100);
    });
  });

  it('submits with Enter and keeps Shift+Enter for new lines', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, 'hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('hello\n');

    await user.type(textbox, 'world');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('hello\nworld', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: null
    }, []);
    expect(textbox).toHaveValue('');
  });

  it('does not submit Enter during IME composition', () => {
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '你好' } });
    fireEvent.keyDown(textbox, {
      key: 'Enter',
      code: 'Enter',
      isComposing: true
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('你好');
  });

  it('does not submit when disabled even if the form submit event fires', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '  hello  ' } });
    rerender(<Composer {...defaultProps} disabled onSubmit={onSubmit} />);
    fireEvent.submit(textbox.closest('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit an empty trimmed prompt', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '   ');

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uploads a selected image, blocks submit while uploading, and submits attachment metadata', async () => {
    const user = userEvent.setup();
    let resolveUpload!: (value: ReturnType<typeof attachment>) => void;
    const onUploadAttachment = vi.fn(() => new Promise<ReturnType<typeof attachment>>(resolve => {
      resolveUpload = resolve;
    }));
    const onSubmit = vi.fn(async () => true);
    mockObjectUrls();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported
        onUploadAttachment={onUploadAttachment}
        onSubmit={onSubmit}
      />
    );
    const file = new File(['png'], 'screen.png', { type: 'image/png' });

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.upload(screen.getByLabelText('选择图片'), file);
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '描述图片');

    expect(screen.getByText('正在上传 screen.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();

    resolveUpload(attachment());
    expect(await screen.findByRole('img', { name: 'screen.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      '描述图片',
      expect.objectContaining({ permission: 'danger-full-access' }),
      [{
        attachment: attachment(),
        previewUrl: 'blob:screen.png'
      }]
    ));
    await waitFor(() => expect(screen.queryByText('screen.png')).not.toBeInTheDocument());
  });

  it('keeps an accepted attachment preview alive when submission changes the composer key', async () => {
    const user = userEvent.setup();
    mockObjectUrls();

    function Harness() {
      const [composerKey, setComposerKey] = useState('draft');
      return (
        <Composer
          key={composerKey}
          {...defaultProps}
          imageInputSupported
          onUploadAttachment={async () => attachment()}
          onSubmit={() => {
            setComposerKey('thread');
            return true;
          }}
        />
      );
    }

    render(<Harness />);
    const file = new File(['png'], 'screen.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('选择图片'), file);
    await screen.findByRole('img', { name: 'screen.png' });
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '描述图片');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:screen.png');
  });

  it('supports pasted and dropped images through the same upload path', async () => {
    const onUploadAttachment = vi.fn(async (file: File) => attachment(file.name));
    mockObjectUrls();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported
        onUploadAttachment={onUploadAttachment}
      />
    );
    const pasted = new File(['one'], 'pasted.png', { type: 'image/png' });
    const dropped = new File(['two'], 'dropped.webp', { type: 'image/webp' });
    const textbox = screen.getByRole('textbox', { name: '输入任务' });

    fireEvent.paste(textbox, {
      clipboardData: { files: [pasted] }
    });
    fireEvent.drop(textbox.closest('form')!, {
      dataTransfer: { files: [dropped] }
    });

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('pasted.png')).toBeInTheDocument();
    expect(await screen.findByText('dropped.webp')).toBeInTheDocument();
  });

  it('removes uploaded attachments and retries failed uploads', async () => {
    const user = userEvent.setup();
    const onUploadAttachment = vi.fn()
      .mockRejectedValueOnce(new Error('上传失败'))
      .mockResolvedValueOnce(attachment());
    const onDeleteAttachment = vi.fn(async () => undefined);
    mockObjectUrls();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported
        onUploadAttachment={onUploadAttachment}
        onDeleteAttachment={onDeleteAttachment}
      />
    );
    const file = new File(['png'], 'screen.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('选择图片'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('上传失败');
    await user.click(screen.getByRole('button', { name: '重试上传 screen.png' }));
    expect(await screen.findByRole('img', { name: 'screen.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移除附件 screen.png' }));

    await waitFor(() => expect(onDeleteAttachment).toHaveBeenCalledWith(attachment()));
    expect(screen.queryByText('screen.png')).not.toBeInTheDocument();
  });

  it('disables image input and prompts for a Codex update when unsupported', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported={false}
        imageInputUnsupportedReason="当前 Codex 版本不支持图片输入，请更新 Codex"
      />
    );

    await user.click(screen.getByRole('button', { name: '添加上下文' }));

    expect(screen.getByRole('menuitem', { name: /添加图片/ })).toBeDisabled();
    expect(screen.getByText('当前 Codex 版本不支持图片输入，请更新 Codex')).toBeInTheDocument();
    expect(screen.getByLabelText('选择图片')).toBeDisabled();
  });

  it('applies an external draft once and focuses the textarea', async () => {
    const user = userEvent.setup();
    const onDraftApplied = vi.fn();
    const { rerender } = render(
      <Composer
        {...defaultProps}
        draftRequest={{ id: 1, text: '$frontend-slides ' }}
        onDraftApplied={onDraftApplied}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await waitFor(() => {
      expect(textbox).toHaveValue('$frontend-slides ');
      expect(textbox).toHaveFocus();
    });
    expect(onDraftApplied).toHaveBeenCalledWith(1);

    await user.type(textbox, '生成季度汇报');
    rerender(<Composer {...defaultProps} onDraftApplied={onDraftApplied} />);
    expect(textbox).toHaveValue('$frontend-slides 生成季度汇报');
  });

  it('applies an external draft after RAF focus and caret placement in StrictMode', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const calls: string[] = [];
    const onDraftApplied = vi.fn(() => calls.push('applied'));

    render(
      <StrictMode>
        <Composer
          {...defaultProps}
          draftRequest={{ id: 7, text: '$frontend-slides ' }}
          onDraftApplied={onDraftApplied}
        />
      </StrictMode>
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    const originalFocus = textbox.focus.bind(textbox);
    vi.spyOn(textbox, 'focus').mockImplementation(() => {
      calls.push('focus');
      originalFocus();
    });
    const originalSetSelectionRange = textbox.setSelectionRange.bind(textbox);
    vi.spyOn(textbox, 'setSelectionRange').mockImplementation((start, end, direction) => {
      calls.push(`selection:${start}:${end}`);
      originalSetSelectionRange(start, end, direction);
    });

    expect(textbox).toHaveValue('$frontend-slides ');
    expect(callbacks.size).toBe(1);
    expect(onDraftApplied).not.toHaveBeenCalled();

    const callback = Array.from(callbacks.values())[0]!;
    act(() => {
      callback(16);
    });

    expect(calls).toEqual(['focus', 'selection:17:17', 'applied']);
    expect(textbox).toHaveFocus();
    expect(textbox.selectionStart).toBe(17);
    expect(textbox.selectionEnd).toBe(17);
    expect(onDraftApplied).toHaveBeenCalledWith(7);
  });

  it('cancels a pending draft RAF on unmount without applying the draft', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const onDraftApplied = vi.fn();

    const { unmount } = render(
      <Composer
        {...defaultProps}
        draftRequest={{ id: 9, text: '$frontend-slides ' }}
        onDraftApplied={onDraftApplied}
      />
    );

    expect(callbacks.size).toBe(1);
    unmount();

    expect(callbacks.size).toBe(0);
    expect(onDraftApplied).not.toHaveBeenCalled();
  });

  it('typing slash opens skills, MCP, and goal commands and inserts the selected command', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          },
          {
            id: 'goal:create',
            category: 'goal',
            label: '设置 Goal',
            description: '为这次任务声明目标',
            insertText: '目标：'
          }
        ]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/');

    expect(screen.getByRole('listbox', { name: '能力菜单' })).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
    expect(screen.getByText('Goal')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /brainstorming/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /github/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /设置 Goal/ })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /brainstorming/ }));

    expect(textbox).toHaveValue('$brainstorming ');
    expect(screen.queryByRole('listbox', { name: '能力菜单' })).not.toBeInTheDocument();
  });

  it('filters slash commands and selects the active command with Enter', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          }
        ]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/git');

    expect(screen.queryByRole('option', { name: /brainstorming/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /github/ })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');

    expect(textbox).toHaveValue('使用 MCP：github ');
  });
});

function attachment(fileName = 'screen.png') {
  return {
    id: 'attachment-1',
    fileName,
    mime: fileName.endsWith('.webp') ? 'image/webp' : 'image/png',
    size: 3,
    sha256: 'a'.repeat(64),
    storageKey: 'at/attachment-1.bin',
    draftId: 'draft-1',
    status: 'draft' as const,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  };
}

function mockObjectUrls() {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((file: File) => `blob:${file.name}`)
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
}
