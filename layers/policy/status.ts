// Ground-truth status for `float_status()` (#11). `src/config.ts`'s
// `configured.hedera` only reflects env vars — a safety-critical signal the
// DRY_RUN default leans on, deliberately left untouched here (see
// docstring below and CLAUDE.md "never answer from assumption": that flag
// gates a real behavior, not a display string). This module answers a
// different question: is the money layer actually set up, ids and all,
// regardless of where those ids came from.
//
// Env-supplied treasury/topic ids win when explicitly set (so an operator
// can point a run at pre-existing accounts); otherwise this falls back to
// what the policy layer's own bootstrap persisted in `layers/policy/.state/`.
// Never returns a private key.

import type { FloatConfig } from '../../src/config.js';
import { loadState } from './state.js';
import { fetchHbarAllowances } from './mirror.js';

export type AgentBudgetStatus = {
  agent_id: string;
  account_id: string;
  scope: string;
  ceiling_hbar: number;
  /** Live on-chain allowance remaining, in HBAR — null when it couldn't be
   * read (DRY_RUN, mirror node unreachable, or no on-chain allowance yet). */
  remaining_hbar: number | null;
  revoked: boolean;
};

export type PolicyStatus = {
  /** True only once the operator can actually act AND a treasury+topic id
   * are known (from state or env) — ground truth, not "are the four env
   * vars set". */
  configured: boolean;
  treasury_account_id: string | null;
  treasury_source: 'env' | 'state' | 'unset';
  topic_id: string | null;
  topic_source: 'env' | 'state' | 'unset';
  agents: AgentBudgetStatus[];
  /** Set when a live allowance read was attempted and failed — the payload
   * still returns (never throws), just without `remaining_hbar`. */
  allowance_read_error: string | null;
};

function resolveId(envValue: string | undefined, stateValue: string | null): { id: string | null; source: 'env' | 'state' | 'unset' } {
  if (envValue) return { id: envValue, source: 'env' };
  if (stateValue) return { id: stateValue, source: 'state' };
  return { id: null, source: 'unset' };
}

export type PolicyStatusOverrides = {
  /** Test seam — injects a fake mirror-node fetch instead of a real HTTP call. */
  fetchImpl?: typeof fetch;
};

export async function getPolicyStatus(config: FloatConfig, overrides: PolicyStatusOverrides = {}): Promise<PolicyStatus> {
  const state = loadState();
  const treasury = resolveId(config.raw.HEDERA_TREASURY_ID, state.treasury?.accountId ?? null);
  const topic = resolveId(config.raw.HEDERA_TOPIC_ID, state.topicId);

  const activeAgents = Object.values(state.policies).filter((p) => !p.revoked);
  const agentAccounts = new Map(Object.entries(state.agents));

  let remainingByAccount = new Map<string, number>();
  let allowanceReadError: string | null = null;

  const canReadLive = !config.dryRun && treasury.id && !treasury.id.startsWith('dry_run.') && activeAgents.length > 0;
  if (canReadLive) {
    const baseUrl = config.raw.HEDERA_MIRROR_NODE_URL ?? 'https://testnet.mirrornode.hedera.com';
    const result = await fetchHbarAllowances(treasury.id!, { baseUrl, fetchImpl: overrides.fetchImpl });
    if (result.ok) {
      remainingByAccount = new Map(result.allowances.map((a) => [a.spender, a.remainingTinybar]));
    } else {
      allowanceReadError = result.error;
    }
  }

  const agents: AgentBudgetStatus[] = activeAgents.map((p) => {
    const accountId = agentAccounts.get(p.agentId)?.accountId ?? '';
    const remainingTinybar = remainingByAccount.get(accountId);
    return {
      agent_id: p.agentId,
      account_id: accountId,
      scope: p.scope,
      ceiling_hbar: p.ceilingHbar,
      remaining_hbar: remainingTinybar !== undefined ? remainingTinybar / 1e8 : null,
      revoked: p.revoked,
    };
  });

  const operatorConfigured = !!(config.raw.HEDERA_OPERATOR_ID && config.raw.HEDERA_OPERATOR_KEY);

  return {
    configured: operatorConfigured && treasury.id !== null && topic.id !== null,
    treasury_account_id: treasury.id,
    treasury_source: treasury.source,
    topic_id: topic.id,
    topic_source: topic.source,
    agents,
    allowance_read_error: allowanceReadError,
  };
}
