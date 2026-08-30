import type { CreatorJson } from '@opencreator/protocol';

export function videoTranslationArtifactRefsPatch(
  state: Record<string, CreatorJson>,
  stageId?: string
): Record<string, string[]> {
  const patch: Record<string, string[]> = {};
  const remove = (...kinds: string[]) => {
    for (const kind of kinds) patch[kind] = [];
  };

  if (stageId === 'subtitle') {
    remove('dubbed_audio', 'dubbed_video', 'horizontal_video', 'vertical_video');
  } else if (stageId === 'tts') {
    remove('horizontal_video', 'vertical_video');
  } else if (stageId === 'render-horizontal' && state.videoFormat === 'all') {
    remove('vertical_video');
  }

  if (state.dubbing !== true) remove('dubbed_audio', 'dubbed_video');
  if (state.composeVideo !== true) {
    remove('horizontal_video', 'vertical_video');
  } else if (stageId === undefined) {
    if (state.videoFormat === 'horizontal') {
      remove('vertical_video');
    } else if (state.videoFormat === 'vertical') {
      remove('horizontal_video');
    }
  }

  return patch;
}
