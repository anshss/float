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

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (process.env.VITEST) return join(tmpdir(), 'float-mcp-policy-test-state');

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
  const isFirstWrite = !existsSync(STATE_FILE);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  if (isFirstWrite) {
    console.error(`[float-mcp/policy] wrote bootstrap state for the first time: ${STATE_FILE}`);
  }
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
