import type { ThreadPurpose } from '@clawee/protocol';

export function shouldShowComposerProjectSelector(input: {
  conversationEmpty: boolean;
  threadPurpose?: ThreadPurpose;
}): boolean {
  return input.conversationEmpty
    && (input.threadPurpose === undefined || input.threadPurpose === 'conversation');
}
