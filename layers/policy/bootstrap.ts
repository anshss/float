// Idempotent account/topic bootstrap. Only HEDERA_OPERATOR_ID/_KEY are
// supplied from outside; the treasury (allowance owner), every per-agent
// spender account, and the audit topic are minted here on first use and then
// persisted to layers/policy/.state/hedera.json so a rerun never mints
// duplicates.
//
// stdout is the MCP protocol stream (stdio transport, src/index.ts) — every
// log in this file goes to console.error, never console.log. Ids are logged
// loudly on creation; private keys never are.
//
// #21: the mint decision for each of treasury/agent-account/topic is made
// and persisted under `withStateLock` so two concurrent processes can never
// both read "unset" and both mint, and — treasury only — is gated by
// `acquireLiveRunLock` (fail fast, never queue) plus a refuse-to-mint guard
// that STOPS rather than mints when minting would very likely orphan real
// value. Minting is a deliberate act; it is never a fallback for missing
// state. See `findTreasuryMintRefusal` below.

import { AccountCreateTransaction, Hbar, PrivateKey, TopicCreateTransaction } from '@hashgraph/sdk';
import type { FloatConfig } from '../../src/config.js';
import { executeAndGetReceipt, getOperator, getOperatorClient } from './hedera.js';
import { acquireLiveRunLock, findMostRecentBackupWithTreasury, loadState, withStateLock, type AgentAccount, type PolicyState } from './state.js';
import { findOrphanedFundedAccounts } from './mirror.js';

async function createFundedAccount(config: FloatConfig, initialHbar: number): Promise<AgentAccount> {
  const client = getOperatorClient(config);
  const key = PrivateKey.generateECDSA();
  const tx = new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(initialHbar));
  const response = await executeAndGetReceipt(client, tx);
  const receipt = await response.getReceipt(client);
  const accountId = receipt.accountId;
  if (!accountId) throw new Error('AccountCreateTransaction receipt returned no accountId');
  return { accountId: accountId.toString(), privateKey: key.toStringDer() };
}

export type TreasuryMintRefusal =
  | { kind: 'backup_has_treasury'; backupPath: string; backupTreasuryId: string; backupSavedAt: string }
  | { kind: 'operator_has_funded_accounts'; accounts: Array<{ accountId: string; balanceTinybar: number }> };

function describeTreasuryMintRefusal(reason: TreasuryMintRefusal): string {
  if (reason.kind === 'backup_has_treasury') {
    return (
      `refusing to mint a new treasury: current state has none, but backup ${reason.backupPath} ` +
      `(saved ${reason.backupSavedAt}) still records treasury ${reason.backupTreasuryId}. Minting now would ` +
      `orphan real HBAR if that treasury is actually still funded — restore it from the backup instead, or ` +
      `set FLOAT_FORCE_MINT_TREASURY=1 if you have confirmed it is genuinely gone and want a fresh one.`
    );
  }
  const accounts = reason.accounts.map((a) => `${a.accountId} (${a.balanceTinybar} tinybar)`).join(', ');
  return (
    `refusing to mint a new treasury: the operator has already created funded account(s) not recorded in ` +
    `state — ${accounts}. Minting again would risk orphaning them too. Investigate those accounts first, or ` +
    `set FLOAT_FORCE_MINT_TREASURY=1 if you have confirmed this is safe.`
  );
}

/** Thrown, never returned — a refusal to mint is a hard stop, not a normal
 * denial the caller is expected to branch on (see contracts.ts: this repo's
 * `DenialReason` enum is a closed wire seam other components depend on, not
 * something this ticket may widen). The message names exactly what was
 * found, per the ticket's "Done when". */
export class TreasuryMintRefusedError extends Error {
  constructor(public readonly reason: TreasuryMintRefusal) {
    super(describeTreasuryMintRefusal(reason));
    this.name = 'TreasuryMintRefusedError';
  }
}

/** Looks for either signal that a treasury already exists somewhere this
 * process doesn't know about. `null` means neither signal fired — minting
 * is safe to proceed. An explicit `FLOAT_FORCE_MINT_TREASURY=1` skips both
 * checks outright (the ticket's "explicit flag may override"). */
async function findTreasuryMintRefusal(config: FloatConfig, state: PolicyState): Promise<TreasuryMintRefusal | null> {
  if (process.env.FLOAT_FORCE_MINT_TREASURY === '1') return null;

  const backup = findMostRecentBackupWithTreasury();
  if (backup) return { kind: 'backup_has_treasury', ...backup };

  const operatorId = config.raw.HEDERA_OPERATOR_ID;
  if (operatorId) {
    const knownAccountIds = new Set(Object.values(state.agents).map((a) => a.accountId));
    const orphans = await findOrphanedFundedAccounts(operatorId, knownAccountIds, {
      baseUrl: config.raw.HEDERA_MIRROR_NODE_URL ?? 'https://testnet.mirrornode.hedera.com',
    });
    if (orphans.length > 0) return { kind: 'operator_has_funded_accounts', accounts: orphans };
  }

  return null;
}

/** Creates the treasury (allowance owner) if `state.treasury` is unset.
 * DRY_RUN never mints a real account — it fabricates a placeholder id so
 * downstream code has something to reference, and nothing is persisted. */
export async function ensureTreasury(config: FloatConfig): Promise<AgentAccount> {
  const existing = loadState().treasury;
  if (existing) return existing;

  if (config.dryRun) {
    return { accountId: 'dry_run.treasury', privateKey: '' };
  }

  const releaseLive = acquireLiveRunLock('bootstrap: mint treasury');
  try {
    return await withStateLock('ensureTreasury', async (state) => {
      // Re-check inside the lock: another process may have minted the
      // treasury while this one was waiting for the live-run lock above.
      if (state.treasury) return { save: null, result: state.treasury };

      const refusal = await findTreasuryMintRefusal(config, state);
      if (refusal) throw new TreasuryMintRefusedError(refusal);

      const treasury = await createFundedAccount(config, config.funding.treasuryInitialHbar);
      console.error(`[float-mcp/policy] created treasury account ${treasury.accountId} (allowance owner)`);
      return { save: { ...state, treasury }, result: treasury };
    });
  } finally {
    releaseLive();
  }
}

/** Creates a spender account for `agentId` if one doesn't already exist. */
export async function ensureAgentAccount(config: FloatConfig, agentId: string): Promise<AgentAccount> {
  const existing = loadState().agents[agentId];
  if (existing) return existing;

  if (config.dryRun) {
    return { accountId: `dry_run.agent.${agentId}`, privateKey: '' };
  }

  const releaseLive = acquireLiveRunLock(`bootstrap: mint agent account "${agentId}"`);
  try {
    return await withStateLock(`ensureAgentAccount:${agentId}`, async (state) => {
      const already = state.agents[agentId];
      if (already) return { save: null, result: already };

      const account = await createFundedAccount(config, config.funding.agentInitialHbar);
      console.error(`[float-mcp/policy] created spender account for agent "${agentId}": ${account.accountId}`);
      return { save: { ...state, agents: { ...state.agents, [agentId]: account } }, result: account };
    });
  } finally {
    releaseLive();
  }
}

/** Creates the single audit topic if `HEDERA_TOPIC_ID`/`state.topicId` is
 * unset. Every grant/revoke/spend/denial writes one AuditMessage here. */
export async function ensureTopic(config: FloatConfig): Promise<string> {
  const envTopic = config.raw.HEDERA_TOPIC_ID;
  if (envTopic) {
    // Persist an explicitly-supplied topic id into state too (not just env)
    // — #16: this is how an existing topic (its history worth keeping) gets
    // remembered by future runs even if HEDERA_TOPIC_ID isn't set again.
    if (!config.dryRun) {
      await withStateLock('ensureTopic:env-persist', async (state) => {
        if (state.topicId === envTopic) return { save: null, result: undefined };
        return { save: { ...state, topicId: envTopic }, result: undefined };
      });
    }
    return envTopic;
  }

  const existing = loadState().topicId;
  if (existing) return existing;

  if (config.dryRun) {
    return 'dry_run.topic';
  }

  const releaseLive = acquireLiveRunLock('bootstrap: mint audit topic');
  try {
    return await withStateLock('ensureTopic', async (state) => {
      if (state.topicId) return { save: null, result: state.topicId };

      const client = getOperatorClient(config);
      const operator = getOperator(config);
      const tx = new TopicCreateTransaction()
        .setAdminKey(operator.privateKey.publicKey)
        .setSubmitKey(operator.privateKey.publicKey)
        .setTopicMemo('float-mcp audit log (grants, revokes, spends, denials)');
      const response = await executeAndGetReceipt(client, tx);
      const receipt = await response.getReceipt(client);
      const topicId = receipt.topicId;
      if (!topicId) throw new Error('TopicCreateTransaction receipt returned no topicId');

      console.error(`[float-mcp/policy] created HCS audit topic ${topicId.toString()}`);
      return { save: { ...state, topicId: topicId.toString() }, result: topicId.toString() };
    });
  } finally {
    releaseLive();
  }
}

export function getState(): PolicyState {
  return loadState();
}
