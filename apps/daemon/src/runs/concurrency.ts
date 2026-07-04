export type RunConcurrencyState = {
  activeRunIds: string[];
};

export function createEmptyRunConcurrencyState(): RunConcurrencyState {
  return { activeRunIds: [] };
}
