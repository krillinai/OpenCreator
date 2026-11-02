import { gatewayModelCompatible, gatewayModelReady, type GatewayAccountState } from '@opencreator/protocol';
import type { AppServerRuntimeExecution, AppServerRuntimeManager, AppServerRuntimeTurnInput } from '../codex/app-server-runtime-manager.js';
import { GatewayError } from './client.js';

export function createRuntimeSource(manual: AppServerRuntimeManager, readState: () => GatewayAccountState, readOfficial: () => AppServerRuntimeManager | undefined): AppServerRuntimeManager {
  const officialThreads = new Map<string, string>();
  function current() {
    const state = readState();
    if (state.source === 'manual') return manual;
    const official = readOfficial();
    if (state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    if (state.activationState !== 'ready' || !official) throw new GatewayError('services_not_ready');
    return official;
  }
  function turn(input: AppServerRuntimeTurnInput): AppServerRuntimeExecution {
    const state = readState();
    const manager = current();
    if (state.source === 'manual') return manager.startTurn(input);
    const models = state.models.filter(model => model.modality === 'text' && model.capabilities.includes('responses')
      && gatewayModelReady(model) && (state.transport !== 'gateway' || gatewayModelCompatible(model)));
    const model = input.model ? models.find(model => model.id === input.model)
      : models.find(model => model.id === state.selectedModels?.text) ?? (state.transport === 'gateway' ? undefined : models[0]);
    if (!model) throw new GatewayError('invalid_model', 400);
    const identity = JSON.stringify([state.account?.id, state.bindingVersion, input.scope.kind, input.scope.id, input.thread.id]);
    return manager.startTurn({ ...input, profile: 'default', model: model.id, codexThreadId: officialThreads.get(identity), runtimeInjection: undefined,
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
