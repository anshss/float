// Budget engine: policy objects, the grant/revoke lifecycle, breach
// detection, and the hierarchy invariant.
//
// Scope note: this Float MCP instance represents exactly one root agent (the
// caller), matching the demo script ("agent spawns a child with a sub-
// budget") — `grant_budget` is always root-grants-to-child_id in v1, so
// there is one hierarchy level below root, not an arbitrary parent chain.
// The root's own ceiling is `FLOAT_ROOT_CEILING_HBAR` (default 10 HBAR).
//
// Hierarchy invariant: sum(active child ceilings) <= parent ceiling,
// enforced by Float at grant time and committed to HCS. Claim discipline:
// "ceilings enforced on-chain, hierarchy enforced at grant time, both
// auditable" — never claim on-chain nesting. HTS/HBAR allowances are
// strictly owner->spender; a spender cannot re-delegate (delegating-spender
// is NFT-only), so every grant here is signed by the treasury (the owner),
// never by a child account.

import { AccountAllowanceApproveTransaction, AccountId, Hbar, PrivateKey } from '@hashgraph/sdk';
import type { FloatConfig } from '../../src/config.js';
import { denied, ok, type ToolResult } from '../../src/contracts.js';
import { writeAudit } from './audit.js';
import { ensureAgentAccount, ensureTreasury } from './bootstrap.js';
import { executeAndGetReceipt, getOperatorClient } from './hedera.js';
import { requestLedgerGrantSignature } from './ledger-signer.js';
import { fetchHbarAllowances } from './mirror.js';
import { loadState, saveState, type PolicyRecord } from './state.js';

/** #17: `CRYPTOAPPROVEALLOWANCE` is 0.666 HBAR, the single most expensive
 * repeating operation this layer performs. Reads the treasury's real
 * allowances back from the mirror node and skips the approval when one
 * already covers `ceilingHbar` exactly — only a changed ceiling (or a
 * mirror-node read failure, where we can't tell) re-approves. */
async function allowanceAlreadyCoversCeiling(
  config: FloatConfig,
  treasuryAccountId: string,
  spenderAccountId: string,
  ceilingHbar: number,
): Promise<boolean> {
  const baseUrl = config.raw.HEDERA_MIRROR_NODE_URL ?? 'https://testnet.mirrornode.hedera.com';
  const result = await fetchHbarAllowances(treasuryAccountId, { baseUrl });
  if (!result.ok) return false;
  const ceilingTinybar = new Hbar(ceilingHbar).toTinybars().toNumber();
  return result.allowances.some((a) => a.spender === spenderAccountId && a.grantedTinybar === ceilingTinybar);
}

export const ROOT_AGENT_ID = 'root';

/** Root's own ceiling (HBAR). Exported so the payments layer's `pay()` can
 * check its own spend against the same number `grant_budget` enforces for
 * children — one ceiling config, read from the same place either way. */
export function rootCeilingHbar(): number {
  const raw = process.env.FLOAT_ROOT_CEILING_HBAR;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function activeChildCeilingSum(parentId: string, excludingAgentId?: string): number {
  const state = loadState();
  return Object.values(state.policies)
    .filter((p) => p.parentId === parentId && !p.revoked && p.agentId !== excludingAgentId)
    .reduce((sum, p) => sum + p.ceilingHbar, 0);
}

export type GrantBudgetInput = {
  childId: string;
  ceiling: string;
  scope: string;
  period?: string;
  thresholdForHuman?: number;
};

/** grant_budget(child_id, ceiling, scope) — parent-only (root, per the scope
 * note above). Enforces the hierarchy invariant before touching the chain,
 * then submits one owner-signed `AccountAllowanceApproveTransaction` from
 * the treasury and writes the grant to HCS either way. */
export async function grantBudget(config: FloatConfig, input: GrantBudgetInput): Promise<ToolResult<unknown>> {
  const ceilingHbar = Number(input.ceiling);
  if (!Number.isFinite(ceilingHbar) || ceilingHbar <= 0) {
    return denied('ceiling_exceeded', `ceiling must be a positive number of HBAR, got "${input.ceiling}"`);
  }

  const parentId = ROOT_AGENT_ID;
  const parentCeiling = rootCeilingHbar();
  const siblingSum = activeChildCeilingSum(parentId, input.childId);
  const proposedTotal = siblingSum + ceilingHbar;

  if (proposedTotal > parentCeiling) {
    const detail = `sum(child ceilings) ${proposedTotal} HBAR would exceed parent "${parentId}" ceiling ${parentCeiling} HBAR (siblings already hold ${siblingSum} HBAR) — hierarchy invariant enforced at grant time`;
    await writeAudit(config, {
      v: 1,
      kind: 'denial',
      agent_id: input.childId,
      ts: new Date().toISOString(),
      reason: 'ceiling_exceeded',
    });
    return denied('ceiling_exceeded', detail);
  }

  const signerMode = (process.env.GRANT_SIGNER ?? 'operator').toLowerCase();
  if (signerMode === 'ledger') {
    // Seam for #5 (C6 custody wrapper): every grant becomes a device press.
    // The wrapper doesn't exist yet, so we surface the same `awaiting_device`
    // shape #5 will make real and stop here without touching the chain.
    return requestLedgerGrantSignature(config, input);
  }

  const treasury = await ensureTreasury(config);
  const child = await ensureAgentAccount(config, input.childId);

  let allowanceTx: string | null = null;
  if (!config.dryRun) {
    // Carry the previous grant's tx id forward when we skip re-approving —
    // there's no new tx to report, but the old one is still the one in force.
    allowanceTx = loadState().policies[input.childId]?.allowanceTx ?? null;
    const alreadyCovered = await allowanceAlreadyCoversCeiling(config, treasury.accountId, child.accountId, ceilingHbar);
    if (alreadyCovered) {
      console.error(
        `[float-mcp/policy] allowance for "${input.childId}" already covers ${ceilingHbar} HBAR — skipping CRYPTOAPPROVEALLOWANCE`,
      );
    } else {
      const client = getOperatorClient(config);
      const treasuryKey = PrivateKey.fromStringDer(treasury.privateKey);
      const tx = new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(
          AccountId.fromString(treasury.accountId),
          AccountId.fromString(child.accountId),
          new Hbar(ceilingHbar),
        )
        .freezeWith(client);
      const signed = await tx.sign(treasuryKey);
      const response = await executeAndGetReceipt(client, signed);
      allowanceTx = response.transactionId.toString();
    }
  }

  const state = loadState();
  const record: PolicyRecord = {
    agentId: input.childId,
    parentId,
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

  return ok({
    agent_id: input.childId,
    account_id: child.accountId,
    ceiling_hbar: ceilingHbar,
    scope: input.scope,
    treasury_account_id: treasury.accountId,
    allowance_tx: allowanceTx,
    dry_run: config.dryRun,
  });
}

export async function revokeBudget(config: FloatConfig, childId: string): Promise<ToolResult<unknown>> {
  const state = loadState();
  const record = state.policies[childId];
  if (!record || record.revoked) {
    return denied('deployment_unavailable', `no active policy for agent "${childId}"`);
  }

  const treasury = await ensureTreasury(config);
  const child = await ensureAgentAccount(config, childId);

  if (!config.dryRun) {
    const client = getOperatorClient(config);
    const treasuryKey = PrivateKey.fromStringDer(treasury.privateKey);
    const tx = new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(
        AccountId.fromString(treasury.accountId),
        AccountId.fromString(child.accountId),
        new Hbar(0),
      )
      .freezeWith(client);
    const signed = await tx.sign(treasuryKey);
    await executeAndGetReceipt(client, signed);
  }

  record.revoked = true;
  saveState(state);

  await writeAudit(config, {
    v: 1,
    kind: 'revoke',
    agent_id: childId,
    ts: new Date().toISOString(),
    policy_id: childId,
  });

  return ok({ agent_id: childId, revoked: true });
}

export type SpendInput = {
  agentId: string;
  amountHbar: number;
  service: string;
  toAccountId: string;
};

/** Not an MCP tool in this ticket (`pay` is #4's) — exercised directly by
 * the live-verify script and tests to prove the ceiling-breach denial path
 * end to end: an over-ceiling spend must be refused AND written to HCS. */
export async function spend(config: FloatConfig, input: SpendInput): Promise<ToolResult<unknown>> {
  const state = loadState();
  const record = state.policies[input.agentId];
  if (!record || record.revoked) {
    return denied('ceiling_exceeded', `no active budget for agent "${input.agentId}"`);
  }
  if (input.amountHbar > record.ceilingHbar) {
    const detail = `spend ${input.amountHbar} HBAR exceeds granted ceiling ${record.ceilingHbar} HBAR for agent "${input.agentId}"`;
    await writeAudit(config, {
      v: 1,
      kind: 'denial',
      agent_id: input.agentId,
      ts: new Date().toISOString(),
      policy_id: input.agentId,
      reason: 'ceiling_exceeded',
    });
    return denied('ceiling_exceeded', detail);
  }

  const treasury = await ensureTreasury(config);
  const child = await ensureAgentAccount(config, input.agentId);

  let tx: string | null = null;
  if (!config.dryRun) {
    const client = getOperatorClient(config);
    const childKey = PrivateKey.fromStringDer(child.privateKey);
    const { TransferTransaction } = await import('@hashgraph/sdk');
    const transfer = new TransferTransaction()
      .addApprovedHbarTransfer(AccountId.fromString(treasury.accountId), new Hbar(-input.amountHbar))
      .addHbarTransfer(AccountId.fromString(input.toAccountId), new Hbar(input.amountHbar))
      .setTransactionId(await import('@hashgraph/sdk').then((m) => m.TransactionId.generate(AccountId.fromString(child.accountId))))
      .freezeWith(client);
    const signed = await transfer.sign(childKey);
    const response = await executeAndGetReceipt(client, signed);
    tx = response.transactionId.toString();
  }

  await writeAudit(config, {
    v: 1,
    kind: 'spend',
    agent_id: input.agentId,
    ts: new Date().toISOString(),
    policy_id: input.agentId,
    service: input.service,
    amount: String(input.amountHbar),
    tx: tx ?? undefined,
  });

  return ok({ agent_id: input.agentId, amount_hbar: input.amountHbar, tx, dry_run: config.dryRun });
}
