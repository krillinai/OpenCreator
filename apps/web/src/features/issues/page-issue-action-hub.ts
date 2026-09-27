import type { IssueActionRegistry } from './IssuePresenter.js';

type Registration = { owner: symbol; actions: IssueActionRegistry };

let snapshot = new Map<string, Registration>();
const listeners = new Set<() => void>();

export function subscribePageIssueActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPageIssueActionsSnapshot(): Map<string, Registration> {
  return snapshot;
}

export function registerPageIssueActions(ids: string[], actions: IssueActionRegistry): () => void {
  if (ids.length === 0) return () => undefined;
  const owner = Symbol('page-issue-actions');
  snapshot = new Map(snapshot);
  for (const id of ids) snapshot.set(id, { owner, actions });
  notify();
  return () => {
    const next = new Map(snapshot);
    for (const id of ids) {
      if (next.get(id)?.owner === owner) next.delete(id);
    }
    if (next.size === snapshot.size) return;
    snapshot = next;
    notify();
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}
