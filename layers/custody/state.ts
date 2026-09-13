// Local persisted state for the custody layer: the single in-flight ledger
// operation (grant attestation or treasury replenishment) and the reserve
// tranche ledger. No private key material is ever written here -- the
// Ledger device never gives one up in the first place, unlike
// `layers/policy/state.ts`'s treasury key.
//
// Same worktree-survival requirement as the policy layer's state file (a
// linked worktree gets `worktree:rm`'d on merge): resolved the same way,
// duplicated here rather than imported so this layer has no dependency on
// `layers/policy/`.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_CHECKOUT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolveStateDir(): string {
  // Vitest runs test files across several worker processes in parallel;
  // this module's STATE_DIR is computed once per process at import time, so
  // a single shared path would mean every parallel worker races on the same
  // file. `VITEST_POOL_ID` is stable per worker process for the whole run
  // (same fix as layers/policy/state.ts).
  if (process.env.VITEST) {
    const poolId = process.env.VITEST_POOL_ID ?? 'main';
    return join(tmpdir(), 'float-mcp-custody-test-state', `worker-${poolId}`);
  }
  if (process.env.FLOAT_STATE_DIR) return join(process.env.FLOAT_STATE_DIR, '..', 'custody');

  const gitPath = join(THIS_CHECKOUT_ROOT, '.git');
  try {
    const stat = statSync(gitPath);
    if (stat.isFile()) {
      const content = readFileSync(gitPath, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)\/\.git\/worktrees\/[^/]+$/);
      if (match) return join(match[1], 'layers', 'custody', '.state');
    }
  } catch {
    // fall through to this checkout's own state dir
  }
  return join(THIS_CHECKOUT_ROOT, 'layers', 'custody', '.state');
}

const STATE_DIR = resolveStateDir();
const STATE_FILE = join(STATE_DIR, 'custody.json');

export type PendingKind = 'grant' | 'replenish';
export type PendingStatus = 'awaiting_device' | 'confirmed' | 'rejected' | 'error';

export type PendingRecord = {
  kind: PendingKind;
  status: PendingStatus;
  detail: string;
  createdAt: string;
  /** Set once `status` is `confirmed` -- the value `confirm_pending()` reports. */
  result?: unknown;
  /** Set once `status` is `rejected` or `error`. */
  errorDetail?: string;
};

export type ReserveUnlockEvent = {
  ts: string;
  amountUsd: number;
  sepoliaTxHash: string;
};

export type ReserveLedger = {
  lockedUsd: number;
  unlockedUsd: number;
  history: ReserveUnlockEvent[];
};

export type CustodyState = {
  pending: PendingRecord | null;
  reserve: ReserveLedger | null;
};

const EMPTY_STATE: CustodyState = { pending: null, reserve: null };

export function loadState(): CustodyState {
  if (!existsSync(STATE_FILE)) return structuredClone(EMPTY_STATE);
  try {
    return { ...structuredClone(EMPTY_STATE), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function saveState(state: CustodyState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** Test-only: wipes persisted state between test files. */
export function resetStateForTests(): void {
  saveState(structuredClone(EMPTY_STATE));
}
