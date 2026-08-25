import { z } from 'zod';

const candidateSchema = z.object({
  id: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  reason: z.string().min(1),
  scores: z.object({
    hook: z.number().min(0).max(10),
    information: z.number().min(0).max(10),
    emotion: z.number().min(0).max(10),
    completeness: z.number().min(0).max(10)
  }).strict()
}).strict();

const responseSchema = z.object({ candidates: z.array(candidateSchema) }).strict();
export type ClipCandidate = z.infer<typeof candidateSchema>;

export function parseClipCandidates(value: unknown, duration: number): ClipCandidate[] {
  const parsed = responseSchema.parse(value);
  const sorted = parsed.candidates.slice().sort((a, b) => a.start - b.start);
  for (let index = 0; index < sorted.length; index += 1) {
    const candidate = sorted[index]!;
    if (candidate.end <= candidate.start || candidate.end > duration) throw new Error(`invalid_clip_range: ${candidate.id}`);
    if (index > 0 && candidate.start < sorted[index - 1]!.end) throw new Error(`overlapping_clip_range: ${candidate.id}`);
  }
  return sorted;
}

export async function analyzeClips(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  transcript: string;
  duration: number;
  fetchImpl?: typeof fetch;
}): Promise<ClipCandidate[]> {
  const response = await (input.fetchImpl ?? fetch)(`${input.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `从字幕中选择不重叠的高光区间，输出 {"candidates":[{"id":"...","start":0,"end":10,"reason":"...","scores":{"hook":0,"information":0,"emotion":0,"completeness":0}}]}。媒体时长 ${input.duration} 秒。字幕：\n${input.transcript}`
      }]
    })
  });
  if (!response.ok) throw new Error(`clip_analyzer_failed: HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('clip_analyzer_invalid_response');
  return parseClipCandidates(JSON.parse(content), input.duration);
}
