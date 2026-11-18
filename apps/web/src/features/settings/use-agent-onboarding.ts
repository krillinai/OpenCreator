import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenCreatorSettingsService } from '../../services/opencreator-settings-service.js';

export function useAgentOnboarding(
  service: Pick<OpenCreatorSettingsService, 'claimAgentOnboarding'> | null,
  canOffer: boolean
) {
  const [phase, setPhase] = useState<'pending' | 'offered' | 'closed'>(canOffer ? 'pending' : 'closed');
  const claim = useRef<Promise<{ show: boolean }> | undefined>(undefined);
  const dismiss = useCallback(() => setPhase('closed'), []);

  useEffect(() => {
    if (!canOffer) dismiss();
  }, [canOffer, dismiss]);

  useEffect(() => {
    if (phase !== 'pending') return;
    const timer = setTimeout(dismiss, 4_000);
    return () => clearTimeout(timer);
  }, [dismiss, phase]);

  useEffect(() => {
    if (!service) return;
    let canceled = false;
    claim.current ??= service.claimAgentOnboarding(canOffer && phase === 'pending').catch(() => ({ show: false }));
    void claim.current.then(({ show }) => {
      if (!canceled) setPhase(current => current === 'pending' ? (show && canOffer ? 'offered' : 'closed') : current);
    });
    return () => { canceled = true; };
  }, [canOffer, phase, service]);

  return { phase: canOffer ? phase : 'closed', dismiss } as const;
}
