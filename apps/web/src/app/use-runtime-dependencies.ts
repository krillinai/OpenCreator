import type { CreatorRuntimeComponent, CreatorRuntimeComponentsResponse, CreatorYtDlpStatus, OpenCreatorIssue } from '@opencreator/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageIssueState } from '../features/issues/page-issue-state.js';
import type { RuntimeDependencyService } from '../services/runtime-dependency-service.js';

export type RuntimeDependencyPhase =
  | 'idle'
  | 'loading'
  | 'checking'
  | 'updating';

export type RuntimeDependenciesController = {
  componentsStatus?: CreatorRuntimeComponentsResponse;
  componentError?: string;
  refreshComponents?(): Promise<void>;
  downloadComponents?(componentId?: CreatorRuntimeComponent['id']): Promise<void>;
  ytDlpStatus?: CreatorYtDlpStatus;
  phase: RuntimeDependencyPhase;
  /** @deprecated Runtime failures are exposed through issues. */
  error?: string;
  issues?: OpenCreatorIssue[];
  dismissIssue?(issueId: string): void;
  checkYtDlpUpdate(force?: boolean): Promise<CreatorYtDlpStatus>;
  updateYtDlp(): Promise<CreatorYtDlpStatus>;
};

export function useRuntimeDependencies(input: {
  connected: boolean;
  service: RuntimeDependencyService | null;
}): RuntimeDependenciesController {
  const [ytDlpStatus, setYtDlpStatus] = useState<CreatorYtDlpStatus>();
  const [componentsStatus, setComponentsStatus] = useState<CreatorRuntimeComponentsResponse>();
  const [componentError, setComponentError] = useState<string>();
  const componentsRef = useRef<CreatorRuntimeComponentsResponse>();
  const componentDownloadActive = componentsStatus?.components.some(component => ['downloading', 'verifying', 'extracting'].includes(component.state)) ?? false;
  const [phase, setPhase] = useState<RuntimeDependencyPhase>('idle');
  const ytDlpOperation = useRef({ revision: 0, pending: 0 });
  const pageIssues = usePageIssueState('runtime');
  const refreshComponents = useCallback(async () => {
    if (!input.connected || !input.service?.getComponentsStatus) return;
    try {
      const status = await input.service.getComponentsStatus();
      componentsRef.current = status;
      setComponentsStatus(status);
      setComponentError(undefined);
    } catch (error) {
      setComponentError(error instanceof Error ? error.message : 'Unable to read local components');
    }
  }, [input.connected, input.service]);

  useEffect(() => {
    if (!input.connected) { setComponentsStatus(undefined); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refreshComponents();
      const busy = componentsRef.current?.components.some(component => ['downloading', 'verifying', 'extracting'].includes(component.state));
      if (!stopped) timer = setTimeout(() => { void poll(); }, busy ? 1000 : 15_000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [input.connected, refreshComponents, componentDownloadActive]);

  const downloadComponents = useCallback(async (componentId?: CreatorRuntimeComponent['id']) => {
    if (!input.connected || !input.service?.downloadComponents) return;
    try {
      const status = await input.service.downloadComponents(componentId);
      componentsRef.current = status;
      setComponentsStatus(status);
      setComponentError(undefined);
    } catch (error) {
      setComponentError(error instanceof Error ? error.message : 'Unable to download local components');
    }
  }, [input.connected, input.service]);

  useEffect(() => {
    let active = true;
    let loaded = false;
    let timer: ReturnType<typeof setTimeout>;
    const service = input.service;
    if (!input.connected || service === null) {
      setYtDlpStatus(undefined);
      setPhase('idle');
      pageIssues.clearIssues();
      return () => {
        active = false;
      };
    }

    setPhase('loading');
    const poll = async () => {
      const operation = ytDlpOperation.current;
      const revision = operation.revision;
      try {
        const { ytDlp } = await service.getYtDlpStatus();
        if (active && revision === operation.revision && operation.pending === 0) {
          setYtDlpStatus(current => current !== undefined
            && (Object.keys(ytDlp) as Array<keyof CreatorYtDlpStatus>).every(key => current[key] === ytDlp[key]) ? current : ytDlp);
          if (!loaded) pageIssues.resolveOperation('runtime.load-yt-dlp');
          loaded = true;
        }
      } catch (caught) {
        if (active && !loaded && revision === operation.revision && operation.pending === 0) {
          pageIssues.captureOperationFailure(
            'runtime.load-yt-dlp',
            caught,
            'Could not read or check Runtime components. Connect the local Runtime and try again.',
            { retryable: true }
          );
        }
      } finally {
        if (active) {
          setPhase(current => current === 'loading' ? 'idle' : current);
          timer = setTimeout(() => { void poll(); }, 15_000);
        }
      }
    };
    void poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    input.connected,
    input.service,
    pageIssues.captureOperationFailure,
    pageIssues.clearIssues,
    pageIssues.resolveOperation
  ]);

  const checkYtDlpUpdate = useCallback(async (force = true) => {
    if (!input.connected || input.service === null) {
      throw new Error('runtime_dependency_unavailable');
    }
    ytDlpOperation.current.pending += 1;
    ytDlpOperation.current.revision += 1;
    setPhase('checking');
    try {
      const response = await input.service.checkYtDlpUpdate(force);
      setYtDlpStatus(response.ytDlp);
      pageIssues.resolveOperation('runtime.check-yt-dlp');
      pageIssues.resolveOperation('runtime.load-yt-dlp');
      return response.ytDlp;
    } catch (caught) {
      pageIssues.captureOperationFailure(
        'runtime.check-yt-dlp',
        caught,
        'Could not check Runtime component updates. Try again later.',
        { retryable: true }
      );
      throw caught;
    } finally {
      ytDlpOperation.current.pending -= 1;
      ytDlpOperation.current.revision += 1;
      setPhase('idle');
    }
  }, [input.connected, input.service, pageIssues.captureOperationFailure, pageIssues.resolveOperation]);

  const updateYtDlp = useCallback(async () => {
    if (!input.connected || input.service === null) {
      throw new Error('runtime_dependency_unavailable');
    }
    ytDlpOperation.current.pending += 1;
    ytDlpOperation.current.revision += 1;
    setPhase('updating');
    try {
      const response = await input.service.updateYtDlp();
      setYtDlpStatus(response.ytDlp);
      pageIssues.resolveOperation('runtime.update-yt-dlp');
      return response.ytDlp;
    } catch (caught) {
      pageIssues.captureOperationFailure(
        'runtime.update-yt-dlp',
        caught,
        'Runtime component update failed. Check the network and disk space before retrying.',
        { retryable: true }
      );
      throw caught;
    } finally {
      ytDlpOperation.current.pending -= 1;
      ytDlpOperation.current.revision += 1;
      setPhase('idle');
    }
  }, [input.connected, input.service, pageIssues.captureOperationFailure, pageIssues.resolveOperation]);

  return {
    componentsStatus, componentError, refreshComponents, downloadComponents,
    ytDlpStatus,
    phase,
    issues: pageIssues.issues,
    dismissIssue: pageIssues.dismissIssue,
    checkYtDlpUpdate,
    updateYtDlp
  };
}
