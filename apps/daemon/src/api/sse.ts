export type SseEventInput = {
  event?: string;
  id?: string;
  data: unknown;
};

export function formatSseEvent(input: SseEventInput): string {
  const lines: string[] = [];
  if (input.id !== undefined) lines.push(`id: ${input.id}`);
  if (input.event !== undefined) lines.push(`event: ${input.event}`);
  lines.push(`data: ${JSON.stringify(input.data)}`);
  return `${lines.join('\n')}\n\n`;
}
