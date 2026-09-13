// GRANT_SIGNER=ledger seam, now real. Hedera is not one of the networks
// `hw-app-eth`/wallet-cli can sign for (bitcoin/ethereum(+EVM)/solana only
// -- see the C6 ticket), so the Ledger press here is not the transaction
// signature itself: it's a physical, on-device Clear Sign of a human-
// readable attestation of the grant ("Float grant: child=... ceiling=...
// scope=..."), gating whether the Hedera-side allowance below gets
// committed at all. The allowance transaction is still signed by the
// treasury's own Hedera key exactly as the operator-signer path does; what
// changes is that nothing commits until a real physical press approved the
// attestation.
//
// Shares `layers/custody/pending.ts`'s bookkeeping with the treasury
// replenishment flow -- `confirm_pending()` reports on either kind the same
// way. The call site in `engine.ts` does not change: it still just calls
// `requestLedgerGrantSignature` and returns whatever comes back.

import { AccountAllowanceApproveTransaction, AccountId, Hbar, PrivateKey } from '@hashgraph/sdk';
import type { FloatConfig } from '../../src/config.js';
import { denied, type ToolResult } from '../../src/contracts.js';
import { openLedgerSigner, type LedgerSigner } from '../custody/ledgerSigner.js';
import { startPendingOp } from '../custody/pending.js';
import { writeAudit } from './audit.js';
import { ensureAgentAccount, ensureTreasury } from './bootstrap.js';
import { executeAndGetReceipt, getOperatorClient } from './hedera.js';
import type { GrantBudgetInput } from './engine.js';
import { loadState, saveState, type PolicyRecord } from './state.js';

export type LedgerGrantDeps = {
  /** Injectable for tests; defaults to a real USB session. */
  openSigner?: () => Promise<LedgerSigner>;
};

function derivationPath(config: FloatConfig): string {
  return config.raw.LEDGER_DERIVATION_PATH ?? "44'/60'/0'/0/0";
}

/** The same commit engine.ts's own grantBudget runs for the operator
 * signer, duplicated here rather than shared so the ledger path can commit
 * asynchronously (after a device press resolves) without engine.ts having
 * to expose or change its own call flow. */
async function commitGrant(config: FloatConfig, input: GrantBudgetInput): Promise<unknown> {
  const treasury = await ensureTreasury(config);
  const child = await ensureAgentAccount(config, input.childId);
  const ceilingHbar = Number(input.ceiling);

  let allowanceTx: string | null = null;
  if (!config.dryRun) {
    const client = getOperatorClient(config);
    const treasuryKey = PrivateKey.fromStringDer(treasury.privateKey);
    const tx = new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(AccountId.fromString(treasury.accountId), AccountId.fromString(child.accountId), new Hbar(ceilingHbar))
      .freezeWith(client);
    const signed = await tx.sign(treasuryKey);
    const response = await executeAndGetReceipt(client, signed);
    allowanceTx = response.transactionId.toString();
  }

  const state = loadState();
  const record: PolicyRecord = {
    agentId: input.childId,
    parentId: 'root',
    ceilingHbar,
    period: input.period ?? 'unbounded',
    scope: input.scope,
    thresholdForHuman: input.thresholdForHuman ?? null,
    allowanceTx,
    grantedAt: new Date().toISOString(),
    revoked: false,
  };
  state.policies[input.childId] = record;
  saveState(state);

  await writeAudit(config, {
    v: 1,
    kind: 'grant',
    agent_id: input.childId,
    ts: record.grantedAt,
    policy_id: input.childId,
    amount: String(ceilingHbar),
    tx: allowanceTx ?? undefined,
  });

  return {
    agent_id: input.childId,
    account_id: child.accountId,
    ceiling_hbar: ceilingHbar,
    scope: input.scope,
    treasury_account_id: treasury.accountId,
    allowance_tx: allowanceTx,
    ledger_authorized: true,
    dry_run: config.dryRun,
  };
}

export async function requestLedgerGrantSignature(
  config: FloatConfig,
  input: GrantBudgetInput,
  deps: LedgerGrantDeps = {},
): Promise<ToolResult<unknown>> {
  // Gated on device configuration, not DRY_RUN: DRY_RUN only stubs the
  // eventual Hedera-side commit (see `commitGrant`, exactly like the
  // operator-signer path) -- it never skips the physical press, since the
  // whole point of GRANT_SIGNER=ledger is rehearsing that press safely. No
  // LEDGER_CLI_BIN configured, on the other hand, IS the R1 no-device
  // degradation path: a structured denial, no device touch of any kind.
  if (!config.configured.ledger) {
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
      `GRANT_SIGNER=ledger: grant for "${input.childId}" (${input.ceiling} HBAR) needs an on-device Clear Signing press -- set LEDGER_CLI_BIN to authorize`,
    );
  }

  const openSigner = deps.openSigner ?? openLedgerSigner;
  const message = `Float grant: child=${input.childId} ceiling=${input.ceiling} HBAR scope=${input.scope}`;
  const detail = `PRESS THE BUTTON on the Ledger to approve: "${message}"`;

  return startPendingOp('grant', detail, async () => {
    const signer = await openSigner();
    try {
      // Clear-signs the attestation text; the signature itself is never
      // checked against anything on-chain (Hedera can't verify an
      // Ethereum-app signature) -- what matters is that `signPersonalMessage`
      // does not resolve until the human presses approve on the device.
      const messageHex = Buffer.from(message, 'utf8').toString('hex');
      await signer.signPersonalMessage(derivationPath(config), messageHex);
    } finally {
      await signer.close();
    }
    return commitGrant(config, input);
  });
}
