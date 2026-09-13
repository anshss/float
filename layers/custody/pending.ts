// Generic pending-device-operation bookkeeping, shared by the two things
// that need a real Ledger press: a treasury replenishment (this layer) and
// a policy grant attestation (`layers/policy/ledger-signer.ts`). One
// in-flight operation at a time -- the device only has one button.
//
// `startPendingOp` returns `awaiting_device` immediately and never awaits
// the signing promise itself: a physical press can take arbitrarily long,
// and an MCP tool call has to return. The signing promise keeps running in
// the background and mutates the persisted record when it settles.
// `reportPending` only ever READS that record -- it has no path that can
// produce a result without the background promise having actually resolved
// against a real device response, so it reports state, it never bypasses it.

import { denied, ok, type ToolResult } from '../../src/contracts.js';
import { loadState, saveState, type PendingKind } from './state.js';

export function startPendingOp(
  kind: PendingKind,
  detail: string,
  run: () => Promise<unknown>,
): ToolResult<unknown> {
  const state = loadState();
  if (state.pending && state.pending.status === 'awaiting_device') {
    return denied(
      'awaiting_device',
      `a ${state.pending.kind} operation is already awaiting a device press ("${state.pending.detail}") -- call confirm_pending() first`,
    );
  }

  const createdAt = new Date().toISOString();
  state.pending = { kind, status: 'awaiting_device', detail, createdAt };
  saveState(state);

  run()
    .then((result) => {
      const s = loadState();
      if (s.pending?.createdAt === createdAt) {
        s.pending = { ...s.pending, status: 'confirmed', result };
        saveState(s);
      }
    })
    .catch((err) => {
      const s = loadState();
      if (s.pending?.createdAt === createdAt) {
        s.pending = {
          ...s.pending,
          status: 'error',
          errorDetail: err instanceof Error ? err.message : String(err),
        };
        saveState(s);
      }
    });

  return denied('awaiting_device', detail);
}

/** `confirm_pending()`'s real body. Reports the current state of whatever
 * operation is in flight; never signs or bypasses anything itself. */
export function reportPending(): ToolResult<unknown> {
  const state = loadState();
  if (!state.pending) return ok({ pending: false });

  if (state.pending.status === 'awaiting_device') {
    return denied('awaiting_device', `still waiting for a physical Ledger press: ${state.pending.detail}`);
  }

  if (state.pending.status === 'confirmed') {
    const result = state.pending.result;
    saveState({ ...state, pending: null });
    return ok(result);
  }

  // rejected / error -- clear so the next attempt can start fresh.
  const detail = `${state.pending.kind} did not complete: ${state.pending.errorDetail ?? 'device did not confirm the request'}`;
  saveState({ ...state, pending: null });
  return denied('awaiting_device', detail);
}
