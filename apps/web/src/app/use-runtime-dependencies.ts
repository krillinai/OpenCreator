import type { CreatorYtDlpStatus } from '@opencreator/protocol';
import { useCallback, useEffect, useState } from 'react';
import type { RuntimeDependencyService } from '../services/runtime-dependency-service.js';

export type RuntimeDependencyPhase =
  | 'idle'
  | 'loading'
  | 'checking'
  | 'updating';

export type RuntimeDependenciesController = {
  ytDlpStatus?: CreatorYtDlpStatus;
  phase: RuntimeDependencyPhase;
  error?: string;
  checkYtDlpUpdate(force?: boolean): Promise<CreatorYtDlpStatus>;
  updateYtDlp(): Promise<CreatorYtDlpStatus>;
};

export function useRuntimeDependencies(input: {
  connected: boolean;
  service: RuntimeDependencyService | null;
}): RuntimeDependenciesController {
  const [ytDlpStatus, setYtDlpStatus] = useState<CreatorYtDlpStatus>();
  const [phase, setPhase] = useState<RuntimeDependencyPhase>('idle');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!input.connected || input.service === null) {
      setYtDlpStatus(undefined);
      setPhase('idle');
      setError(undefined);
      return () => {
        active = false;
      };
    }

    setPhase('loading');
    setError(undefined);
    void input.service.getYtDlpStatus()
      .then(async response => {
        if (!active) return;
        setYtDlpStatus(response.ytDlp);
        if (!response.ytDlp.checkDue) return;
        setPhase('checking');
        const checked = await input.service?.checkYtDlpUpdate(false);
        if (active && checked !== undefined) setYtDlpStatus(checked.ytDlp);
      })
      .catch(caught => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setPhase('idle');
      });

    return () => {
      active = false;
    };
  }, [input.connected, input.service]);

  const checkYtDlpUpdate = useCallback(async (force = true) => {
    if (!input.connected || input.service === null) {
      throw new Error('runtime_dependency_unavailable');
    }
    setPhase('checking');
    setError(undefined);
    try {
      const response = await input.service.checkYtDlpUpdate(force);
      setYtDlpStatus(response.ytDlp);
      return response.ytDlp;
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setPhase('idle');
    }
  }, [input.connected, input.service]);

  const updateYtDlp = useCallback(async () => {
    if (!input.connected || input.service === null) {
      throw new Error('runtime_dependency_unavailable');
    }
    setPhase('updating');
    setError(undefined);
    try {
      const response = await input.service.updateYtDlp();
      setYtDlpStatus(response.ytDlp);
      return response.ytDlp;
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setPhase('idle');
    }
  }, [input.connected, input.service]);

  return {
    ytDlpStatus,
    phase,
    error,
    checkYtDlpUpdate,
    updateYtDlp
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
