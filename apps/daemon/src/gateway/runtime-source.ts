import type { GatewayAccountState } from '@opencreator/protocol';
import type { AppServerRuntimeManager, AppServerRuntimeTurnInput } from '../codex/app-server-runtime-manager.js';
import { GatewayError } from './client.js';

export function createRuntimeSource(manual: AppServerRuntimeManager, readState: () => GatewayAccountState, readOfficial: () => AppServerRuntimeManager | undefined): AppServerRuntimeManager {
  const officialThreads = new Map<string, string>();
  function current() {
    const state = readState();
    if (state.source === 'manual') return manual;
    const official = readOfficial();
    if (state.authState !== 'signed_in' || state.activationState !== 'ready' || !official) throw new GatewayError('services_not_ready');
    return official;
  }
  function turn(input: AppServerRuntimeTurnInput) {
    const state = readState();
    const manager = current();
    const model = state.models.find(model => model.modality === 'text' && model.id === input.model) ?? state.models.find(model => model.modality === 'text' && model.id === state.selectedModels?.text) ?? state.models.find(model => model.modality === 'text');
    if (state.source === 'manual') return manager.startTurn(input);
    const identity = JSON.stringify([state.account?.id, state.bindingVersion, input.scope.kind, input.scope.id, input.thread.id]);
    return manager.startTurn({ ...input, profile: 'default', model: model?.id, codexThreadId: officialThreads.get(identity), runtimeInjection: undefined,
      async onThreadStarted(id) { officialThreads.set(identity, id); await input.onThreadStarted?.(id); }
    });
  }
  return {
    startTurn: turn,
    acquireScope(scope) {
      const manager = current();
      const acquired = manager.acquireScope(scope);
      return { ...acquired, startTurn(input) { return turn({ ...input, scope }); } };
    },
    closeScope(scope, reason) { return current().closeScope(scope, reason); },
    async closeScopes(predicate, reason) { await manual.closeScopes(predicate, reason); await readOfficial()?.closeScopes(predicate, reason); },
    invalidate(reason) { return manual.invalidate(reason); },
    isScopeBusy(scope) { return manual.isScopeBusy(scope) || readOfficial()?.isScopeBusy(scope) === true; },
    listScopes() { return [...manual.listScopes(), ...(readOfficial()?.listScopes() ?? [])]; },
    async sweepIdle() { await manual.sweepIdle(); await readOfficial()?.sweepIdle(); },
    async close() { await manual.close(); await readOfficial()?.close(); }
  };
}
