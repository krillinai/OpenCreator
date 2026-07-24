import { describe, expect, it } from 'vitest';
import {
  BoundedFrameBuffer,
  BoundedLineBuffer,
  BoundedTextBuffer
} from '../../src/codex/bounded-buffer.js';

describe('bounded Codex buffers', () => {
  it('keeps only the newest text bytes', () => {
    const buffer = new BoundedTextBuffer(8);
    buffer.append('123456');
    buffer.append('7890');
    expect(buffer.text()).toBe('34567890');
    expect(buffer.truncation().truncated).toBe(true);
  });

  it('keeps lines within both count and byte limits', () => {
    const buffer = new BoundedLineBuffer(3, 8);
    for (const line of ['aa', 'bb', 'cc', 'dddd']) buffer.append(line);
    expect(buffer.lines()).toEqual(['bb', 'cc', 'dddd']);
    expect(buffer.truncation()).toMatchObject({
      truncated: true,
      droppedItems: 1
    });
  });

  it('drops an oversized unterminated frame and resumes after newline', () => {
    const buffer = new BoundedFrameBuffer(8);
    expect(buffer.push('x'.repeat(12))).toEqual([]);
    expect(buffer.push('discard\n{"ok":1}\n')).toEqual(['{"ok":1}']);
    expect(buffer.truncation().truncated).toBe(true);
  });
});
