// Local persisted state for the policy layer: minted Hedera account/topic ids
// and their private keys, plus the budget-policy registry. Keeps bootstrap
// idempotent (a rerun never mints duplicate accounts/topics) across process
// restarts.
//
// Lives under layers/policy/.state/ (gitignored, see .gitignore) — plaintext
// keys are acceptable for local/demo use only. Never log or return a value
// from this file's `*Key`/`*PrivateKey` fields through any tool response.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Under the test runner, use a scratch directory instead of the real one —
// otherwise a plain `npm test` after a live run wipes the treasury/topic/
// agent-account bookkeeping a live-verify run just minted on real testnet.
const STATE_DIR = process.env.VITEST
  ? join(tmpdir(), 'float-mcp-policy-test-state')
  : join(dirname(fileURLToPath(import.meta.url)), '.state');
const STATE_FILE = join(STATE_DIR, 'hedera.json');

export type AgentAccount = {
  accountId: string;
  privateKey: string;
};

export type PolicyRecord = {
  agentId: string;
  parentId: string | null;
  ceilingHbar: number;
  period: string;
  scope: string;
  thresholdForHuman: number | null;
  allowanceTx: string | null;
  grantedAt: string;
  revoked: boolean;
};

export type PolicyState = {
  /** Allowance owner — every grant is an owner-signed allowance from this
   * account. Created once, funded from the operator. */
  treasury: AgentAccount | null;
  /** Single audit topic every grant/revoke/spend/denial is written to. */
  topicId: string | null;
  /** child_id / agent_id -> its own Hedera spender account. */
  agents: Record<string, AgentAccount>;
  /** child_id / agent_id -> its active budget policy. */
  policies: Record<string, PolicyRecord>;
};

const EMPTY_STATE: PolicyState = {
  treasury: null,
  topicId: null,
  agents: {},
  policies: {},
};

export function loadState(): PolicyState {
  if (!existsSync(STATE_FILE)) return structuredClone(EMPTY_STATE);
  const raw = readFileSync(STATE_FILE, 'utf8');
  try {
    return { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function saveState(state: PolicyState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** Test-only: wipes persisted state so hierarchy-invariant tests don't
 * accumulate sibling ceilings across runs. */
export function resetStateForTests(): void {
  saveState(structuredClone(EMPTY_STATE));
}
