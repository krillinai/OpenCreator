import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountAvatar } from './AccountAvatar.js';

const NativeURL = URL;
beforeEach(() => {
  class TestURL extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:account-photo');
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal('URL', TestURL);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders the account photo and falls back after an image error', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:account-photo');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const loader = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
  const view = render(<AccountAvatar email="owner@example.test" accountId="a" avatarUrl="https://lh3.googleusercontent.com/photo" loadAvatar={loader}/>);
  await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:account-photo'));
  expect(loader).toHaveBeenCalledWith('a', 'https://lh3.googleusercontent.com/photo');
  fireEvent.error(view.container.querySelector('img')!);
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container).toHaveTextContent('O');
  view.unmount();
  expect(create).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith('blob:account-photo');
});

it('ignores a previous account photo after signing out', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  let resolve!: (image: Blob) => void;
  const loader = vi.fn(() => new Promise<Blob>(complete => { resolve = complete; }));
  const view = render(<AccountAvatar email="a@example.test" accountId="a" avatarUrl="https://lh3.googleusercontent.com/photo" loadAvatar={loader}/>);
  view.rerender(<AccountAvatar/>);
  await act(async () => resolve(new Blob(['image'], { type: 'image/png' })));
  expect(view.container.querySelector('img')).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

it('keeps the initial visible when a picture request fails', async () => {
  const loader = vi.fn(async () => { throw new Error('Unavailable'); });
  const view = render(<AccountAvatar email="a@example.test" accountId="a" avatarUrl="https://lh3.googleusercontent.com/photo" loadAvatar={loader}/>);
  await waitFor(() => expect(loader).toHaveBeenCalledOnce());
  expect(view.container).toHaveTextContent('A');
  expect(view.container.querySelector('img')).toBeNull();
});
