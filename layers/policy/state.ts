// Local persisted state for the policy layer: minted Hedera account/topic ids
// and their private keys, plus the budget-policy registry. Keeps bootstrap
// idempotent (a rerun never mints duplicate accounts/topics) across process
// restarts.
//
// #16: this file MUST NOT live inside a linked worktree. A ticket-3 worktree
// minted a real treasury + spender, got `worktree:rm`'d on merge, and took
// their private keys with it — the treasury's allowance-owner key is gone
// for good, with no live path to sign a new allowance from it. Plaintext
// keys here are acceptable for local/demo use only either way — never log
// or return a value from this file's `*Key`/`*PrivateKey` fields through any
// tool response — but the file itself has to survive `worktree:rm`.
//
// Resolution order (see resolveStateDir): `FLOAT_STATE_DIR` env var, else
// auto-detected main checkout (a linked worktree's `.git` is a FILE — not a
// directory — pointing at `<main checkout>/.git/worktrees/<name>`; we read
// that pointer back to the main checkout, no hardcoded path or env var
// needed), else this checkout's own `.state/` with a loud warning that it
// won't survive a reap if this ever does turn out to be a worktree.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBlocking, acquireFailFast, type Release } from './lock.js';

const THIS_CHECKOUT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type GitKind = 'linked-worktree' | 'regular-checkout' | 'unknown';

/** A linked worktree's `.git` is a plain FILE (not a directory) containing
 * `gitdir: <main checkout>/.git/worktrees/<name>`. Reading it back gives the
 * main checkout's absolute path with no hardcoded path or env var — general
 * to any git worktree setup, not just this workspace's convention. A
 * regular checkout (the main checkout itself, or any plain clone) has
 * `.git` as a directory — that's the safe case, nothing to warn about.
 * Exported for #16's own tests; not otherwise part of this module's API. */
export function detectGit(repoRoot: string): { kind: GitKind; mainCheckoutRoot: string | null } {
  const gitPath = join(repoRoot, '.git');
  try {
    const stat = statSync(gitPath);
    if (stat.isDirectory()) return { kind: 'regular-checkout', mainCheckoutRoot: null };
    if (stat.isFile()) {
      const content = readFileSync(gitPath, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)\/\.git\/worktrees\/[^/]+$/);
      return { kind: 'linked-worktree', mainCheckoutRoot: match ? match[1] : null };
    }
    return { kind: 'unknown', mainCheckoutRoot: null };
  } catch {
    return { kind: 'unknown', mainCheckoutRoot: null };
  }
}

function resolveStateDir(): string {
  // Test runner: a scratch dir, never the real one — otherwise a plain
  // `npm test` after a live run wipes bookkeeping a live-verify run just
  // minted on real testnet (this was itself a bug, fixed alongside #11).
  //
  // Vitest runs test files across several worker processes in parallel;
  // this module's STATE_DIR is computed once per process at import time,
  // so a single shared path here means every parallel worker races on the
  // same `hedera.json` and `resetStateForTests()` in one file clobbers
  // another's fixtures mid-run. `VITEST_POOL_ID` is stable per worker
  // process for the whole run, so a per-worker subdirectory gives each
  // worker (and every test file scheduled onto it) its own state file with
  // no cross-worker interference, without serialising the suite.
  if (process.env.VITEST) {
    const poolId = process.env.VITEST_POOL_ID ?? 'main';
    return join(tmpdir(), 'float-mcp-policy-test-state', `worker-${poolId}`);
  }

  if (process.env.FLOAT_STATE_DIR) {
    console.error(`[float-mcp/policy] bootstrap state directory (from FLOAT_STATE_DIR): ${process.env.FLOAT_STATE_DIR}`);
    return process.env.FLOAT_STATE_DIR;
  }

  const git = detectGit(THIS_CHECKOUT_ROOT);
  if (git.kind === 'linked-worktree' && git.mainCheckoutRoot) {
    const dir = join(git.mainCheckoutRoot, 'layers', 'policy', '.state');
    console.error(`[float-mcp/policy] bootstrap state directory (main checkout, auto-detected from this worktree): ${dir}`);
    return dir;
  }

  const dir = join(THIS_CHECKOUT_ROOT, 'layers', 'policy', '.state');
  if (git.kind === 'regular-checkout') {
    console.error(`[float-mcp/policy] bootstrap state directory (this checkout, not a linked worktree): ${dir}`);
  } else {
    console.error(
      `[float-mcp/policy] WARNING: could not determine whether this is a linked worktree; bootstrap ` +
        `state directory defaults to ${dir}, INSIDE this checkout. If this checkout is ever removed ` +
        `(a worktree reap, a fresh clone), any treasury/spender keys written here are gone for good ` +
        `(#16). Set FLOAT_STATE_DIR to an absolute path outside any worktree to avoid that.`,
    );
  }
  return dir;
}

const STATE_DIR = resolveStateDir();
const STATE_FILE = join(STATE_DIR, 'hedera.json');
// #21: separate from the ad-hoc manual backup an operator might keep
// elsewhere — this one is maintained by `saveState` itself, on every write.
const BACKUPS_DIR = join(STATE_DIR, '.backups');
const MAX_BACKUPS = 10;
// Two distinct locks, not one: STATE_LOCK_DIR guards the JSON file's own
// load/modify/save cycle (blocking — these are short, so a brief wait is
// fine); LIVE_LOCK_DIR guards an entire live Hedera flow end to end
// (fail-fast — see `acquireLiveRunLock`'s doc comment for why the two need
// different acquisition semantics).
const STATE_LOCK_DIR = join(STATE_DIR, '.hedera.lock');
const LIVE_LOCK_DIR = join(STATE_DIR, '.hedera.live-lock');

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

/** Copies the CURRENT on-disk state into `.backups/` before it gets
 * overwritten, then prunes to the newest `MAX_BACKUPS`. #21: a lock closes
 * the race that clobbers this file; a backup is the second line of defence
 * for everything a lock can't cover (a bad write, a bug, an operator
 * mistake) — it is what would have made the 28-HBAR loss recoverable. */
function backupCurrentStateFile(): void {
  if (!existsSync(STATE_FILE)) return;
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  copyFileSync(STATE_FILE, join(BACKUPS_DIR, `hedera.${stamp}.json`));
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('hedera.') && f.endsWith('.json'))
    .sort();
  for (const stale of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    rmSync(join(BACKUPS_DIR, stale), { force: true });
  }
}

/** Backs up the outgoing file, then writes the new one to a temp path and
 * `rename()`s it into place — same directory, so same filesystem, so the
 * rename is atomic. A reader always sees either the old, fully-formed file
 * or the new one, never a half-written one (#21: a half-written state file
 * is as bad as a clobbered one). Callers that need the whole
 * load-decide-save cycle to be race-free (not just this one write) must go
 * through `withStateLock`. */
export function saveState(state: PolicyState): void {
  const isFirstWrite = !existsSync(STATE_FILE);
  mkdirSync(STATE_DIR, { recursive: true });
  backupCurrentStateFile();
  const tmpFile = join(STATE_DIR, `.hedera.json.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmpFile, STATE_FILE);
  if (isFirstWrite) {
    console.error(`[float-mcp/policy] wrote bootstrap state for the first time: ${STATE_FILE}`);
  }
}

export type StateMutation<T> = {
  /** The new state to persist, or `null` to leave the file untouched (a
   * read-only decision — e.g. the refuse-to-mint guard finding a reason to
   * stop before writing anything). */
  save: PolicyState | null;
  result: T;
};

/** Holds `STATE_LOCK_DIR` across the ENTIRE load/decide/save cycle, not
 * just the write. #21's actual bug was read-null -> mint -> save with no
 * lock at all: two processes both read null and both minted, because
 * nothing serialized the decision itself. `fn` gets the freshly-loaded
 * state and returns what (if anything) to persist; the lock is not
 * released until that decision — mint included, when `fn` mints — is
 * fully made. */
export async function withStateLock<T>(purpose: string, fn: (state: PolicyState) => Promise<StateMutation<T>>): Promise<T> {
  const release = await acquireBlocking(STATE_LOCK_DIR, purpose);
  try {
    const state = loadState();
    const { save, result } = await fn(state);
    if (save) saveState(save);
    return result;
  } finally {
    release();
  }
}

/** Fail-fast mutex for a whole live (non-DRY_RUN) Hedera flow — bootstrap's
 * mint decisions, in particular. Distinct from `withStateLock`'s blocking
 * mutex: a second live process should never sit there waiting and then act
 * on a decision made before the first process finished — it should refuse
 * immediately and say who is holding it. Throws `LockHeldError` if held. */
export function acquireLiveRunLock(purpose: string): Release {
  return acquireFailFast(LIVE_LOCK_DIR, purpose);
}

export type BackupTreasuryHit = {
  backupPath: string;
  backupTreasuryId: string;
  backupSavedAt: string;
};

/** #21's refuse-to-mint guard: if the CURRENT state has no treasury but the
 * most recent backup that does still exists, minting a new one would very
 * likely orphan whatever the backed-up treasury still holds. Scans
 * newest-first and returns the first hit; corrupt/unreadable backups are
 * skipped rather than treated as absent (never let a bad backup file read
 * as "no risk found"). */
export function findMostRecentBackupWithTreasury(): BackupTreasuryHit | null {
  if (!existsSync(BACKUPS_DIR)) return null;
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('hedera.') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const file of files) {
    const path = join(BACKUPS_DIR, file);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as PolicyState;
      if (parsed.treasury?.accountId) {
        return {
          backupPath: path,
          backupTreasuryId: parsed.treasury.accountId,
          backupSavedAt: file.slice('hedera.'.length, -'.json'.length),
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Test-only: wipes persisted state so hierarchy-invariant tests don't
 * accumulate sibling ceilings across runs. */
export function resetStateForTests(): void {
  saveState(structuredClone(EMPTY_STATE));
}

/** Exposed for #16's own tests/verification — never for tools to surface. */
export function stateFilePathForDebug(): string {
  return STATE_FILE;
}
