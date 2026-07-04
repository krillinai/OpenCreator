export type JsonLineParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; line: string };

export function parseJsonLine(line: string): JsonLineParseResult {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      line
    };
  }
}
