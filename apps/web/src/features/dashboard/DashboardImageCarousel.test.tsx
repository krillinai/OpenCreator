import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import DashboardImageCarousel from './DashboardImageCarousel.js';

afterEach(() => {
  vi.useRealTimers();
});

it('rotates image generation examples every 1.8 seconds', () => {
  vi.useFakeTimers();
  const { container } = render(
    <LanguageProvider initialPreference="zh-CN">
      <DashboardImageCarousel />
    </LanguageProvider>
  );
  const images = Array.from(container.querySelectorAll('img'));
  expect(images).toHaveLength(8);
  expect(images[0]).toHaveClass('is-active');

  for (let index = 1; index < images.length; index += 1) {
    act(() => { vi.advanceTimersByTime(1800); });
    expect(images[index]).toHaveClass('is-active');
  }
  act(() => { vi.advanceTimersByTime(1800); });
  expect(images[0]).toHaveClass('is-active');
});
