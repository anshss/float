// GRANT_SIGNER=ledger seam. #5 (C6, `layers/custody/`) builds the Ledger
// Wallet CLI subprocess wrapper; until it exists every ledger-mode grant
// returns `awaiting_device` and never touches the chain. Replace the body of
// `requestLedgerGrantSignature` in place once the custody wrapper lands —
// the call site in engine.ts does not need to change.

import type { FloatConfig } from '../../src/config.js';
import { denied, type ToolResult } from '../../src/contracts.js';
import { writeAudit } from './audit.js';
import type { GrantBudgetInput } from './engine.js';

export async function requestLedgerGrantSignature(
  config: FloatConfig,
  input: GrantBudgetInput,
): Promise<ToolResult<unknown>> {
  await writeAudit(config, {
    v: 1,
    kind: 'denial',
    agent_id: input.childId,
    ts: new Date().toISOString(),
    policy_id: input.childId,
    reason: 'awaiting_device',
  });
  return denied(
    'awaiting_device',
    `GRANT_SIGNER=ledger: grant for "${input.childId}" (${input.ceiling} HBAR) needs an on-device Clear Signing press via the C6 custody wrapper (#5), which is not built yet`,
  );
}
