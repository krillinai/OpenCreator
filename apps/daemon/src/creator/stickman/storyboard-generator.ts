import { z } from 'zod';
import type { StickmanScriptSegment } from './script-generator.js';

const shotSchema = z.object({
  segmentId: z.string().min(1),
  imagePrompt: z.string().min(1),
  motion: z.enum(['static', 'push-in', 'pan-left', 'pan-right', 'zoom-out'])
}).strict();

const storyboardSchema = z.object({ shots: z.array(shotSchema).min(1).max(24) }).strict();

export type StickmanStoryboardShot = z.infer<typeof shotSchema>;

export function parseStickmanStoryboard(
  value: unknown,
  segments: StickmanScriptSegment[]
): StickmanStoryboardShot[] {
  const parsed = storyboardSchema.parse(value);
  const segmentIds = new Set(segments.map(segment => segment.id));
  const shotIds = new Set<string>();
  for (const shot of parsed.shots) {
    if (!segmentIds.has(shot.segmentId)) throw new Error(`unknown_storyboard_segment: ${shot.segmentId}`);
    if (shotIds.has(shot.segmentId)) throw new Error(`duplicate_storyboard_segment: ${shot.segmentId}`);
    shotIds.add(shot.segmentId);
  }
  if (shotIds.size !== segmentIds.size) throw new Error('storyboard_segment_missing');
  return parsed.shots;
}

export async function generateStickmanStoryboard(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  style: string;
  characterPrompt: string;
  segments: StickmanScriptSegment[];
  fetchImpl?: typeof fetch;
}): Promise<StickmanStoryboardShot[]> {
  const response = await (input.fetchImpl ?? fetch)(
    `${input.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'}/chat/completions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: input.model,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            '把脚本转换为严格 JSON 分镜，每个 segmentId 必须且只能出现一次。',
            '格式：{"shots":[{"segmentId":"s1","imagePrompt":"...","motion":"push-in"}]}。',
            `统一角色：${input.characterPrompt || '极简黑白火柴人'}。画面风格：${input.style}。`,
            JSON.stringify(input.segments)
          ].join('\n')
        }]
      })
    }
  );
  if (!response.ok) throw new Error(`stickman_storyboard_failed: HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('stickman_storyboard_invalid_response');
  return parseStickmanStoryboard(JSON.parse(content), input.segments);
}
