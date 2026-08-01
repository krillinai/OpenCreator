import { describe, expect, it } from 'vitest';
import { shouldShowComposerProjectSelector } from './composer-visibility.js';

describe('shouldShowComposerProjectSelector', () => {
  it('shows the project selector for a new conversation', () => {
    expect(shouldShowComposerProjectSelector({ conversationEmpty: true })).toBe(true);
    expect(shouldShowComposerProjectSelector({
      conversationEmpty: true,
      threadPurpose: 'conversation'
    })).toBe(true);
  });

  it('hides the project selector after a conversation has messages', () => {
    expect(shouldShowComposerProjectSelector({
      conversationEmpty: false,
      threadPurpose: 'conversation'
    })).toBe(false);
  });

  it.each(['schedule_draft', 'schedule_task'] as const)(
    'hides the project selector for %s threads',
    (threadPurpose) => {
      expect(shouldShowComposerProjectSelector({
        conversationEmpty: true,
        threadPurpose
      })).toBe(false);
      expect(shouldShowComposerProjectSelector({
        conversationEmpty: false,
        threadPurpose
      })).toBe(false);
    }
  );
});
