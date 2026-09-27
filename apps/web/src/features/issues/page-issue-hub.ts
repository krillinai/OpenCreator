import type { OpenCreatorIssue } from '@opencreator/protocol';

type Listener = () => void;

let snapshot: OpenCreatorIssue[] = [];
const listeners = new Set<Listener>();

export function subscribePageIssues(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPageIssues(): OpenCreatorIssue[] {
  return snapshot;
}

export function publishPageIssue(issue: OpenCreatorIssue): void {
  const existing = snapshot.find(candidate => candidate.fingerprint === issue.fingerprint);
  const next = existing === undefined ? issue : {
    ...issue,
    id: existing.id,
    diagnosticId: existing.diagnosticId,
    occurredAt: existing.occurredAt,
    occurrenceCount: existing.occurrenceCount + 1
  };
  snapshot = [
    ...snapshot.filter(candidate => candidate.fingerprint !== issue.fingerprint),
    next
  ].slice(-30);
  notify();
}

export function resolvePageIssue(surface: string, operation: string): void {
  const next = snapshot.filter(issue => (
    issue.scope.kind !== 'page'
    || issue.scope.surface !== surface
    || issue.operation !== operation
  ));
  if (next.length === snapshot.length) return;
  snapshot = next;
  notify();
}

export function dismissPageIssue(id: string): void {
  const next = snapshot.filter(issue => issue.id !== id);
  if (next.length === snapshot.length) return;
  snapshot = next;
  notify();
}

export function clearPageIssues(): void {
  if (snapshot.length === 0) return;
  snapshot = [];
  notify();
}

export function clearPageIssuesForSurface(surface: string): void {
  const next = snapshot.filter(issue => issue.scope.kind !== 'page' || issue.scope.surface !== surface);
  if (next.length === snapshot.length) return;
  snapshot = next;
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}
