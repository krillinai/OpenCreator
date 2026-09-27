import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreateProjectDropdown } from './CreateProjectDropdown.js';

describe('CreateProjectDropdown', () => {
  it('creates the selected project type without a dialog', async () => {
    const onCreateProject = vi.fn().mockResolvedValue(true);
    render(
      <LanguageProvider>
        <CreateProjectDropdown onCreate={onCreateProject} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    expect(screen.getByRole('menu', { name: '项目类型' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /图像生成/ }));

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledOnce());
    expect(onCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: 'image-generation' })
    );
    await waitFor(() => expect(screen.queryByRole('menu', { name: '项目类型' }))
      .not.toBeInTheDocument());
  });

  it('keeps the menu open without a duplicate local error when creation fails', async () => {
    const onCreateProject = vi.fn().mockResolvedValue(false);
    render(
      <LanguageProvider>
        <CreateProjectDropdown onCreate={onCreateProject} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /图像生成/ }));

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledOnce());
    expect(screen.getByRole('menu', { name: '项目类型' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('supports end alignment for right-side triggers', () => {
    render(
      <LanguageProvider>
        <CreateProjectDropdown align="end" onCreate={vi.fn()} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));

    expect(screen.getByRole('menu', { name: '项目类型' }))
      .toHaveClass('create-project-menu--end');
  });
});
