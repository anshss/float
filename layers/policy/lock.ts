// Cross-process advisory locking for the shared policy state file (#21: two
// concurrent bootstrap cycles both read `treasury: null`, both minted a
// funded treasury, and one write clobbered the other — eight orphaned
// accounts, every key lost). `mkdir()` is atomic on POSIX: exactly one
// concurrent caller ever wins an `EEXIST`-free mkdir, so this needs no
// extra dependency and has no race window of its own.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

type LockInfo = {
  pid: number;
  host: string;
  purpose: string;
  acquiredAt: string;
};

export type Release = () => void;

export class LockHeldError extends Error {
  constructor(
    public readonly holder: LockInfo,
    label: string,
  ) {
    super(
      `${label} is held by pid ${holder.pid} on ${holder.host} (purpose: "${holder.purpose}", ` +
        `acquired ${holder.acquiredAt}) — refusing to run a second one concurrently.`,
    );
    this.name = 'LockHeldError';
  }
}

function readInfo(lockDir: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'info.json'), 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

/** `null` return means the caller now HOLDS the lock; a non-null `LockInfo`
 * means someone else already does. */
function tryTake(lockDir: string, purpose: string): LockInfo | null {
  try {
    mkdirSync(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readInfo(lockDir) ?? { pid: -1, host: '?', purpose: 'unknown', acquiredAt: 'unknown' };
    throw err;
  }
  const info: LockInfo = { pid: process.pid, host: hostname(), purpose, acquiredAt: new Date().toISOString() };
  writeFileSync(join(lockDir, 'info.json'), JSON.stringify(info));
  return null;
}

function isStale(info: LockInfo, staleMs: number): boolean {
  const age = Date.now() - Date.parse(info.acquiredAt);
  return Number.isFinite(age) && age > staleMs;
}

function release(lockDir: string): void {
  rmSync(lockDir, { recursive: true, force: true });
}

/** Blocking mutex around a load/modify/save cycle. Retries with backoff up
 * to `timeoutMs` rather than failing on first contention — these cycles are
 * short (a JSON read/write, occasionally a Hedera mint), so a brief wait is
 * the right behaviour, not a fast failure. A lock stuck past `staleMs` (a
 * crashed holder that never released) is force-cleared with a loud warning
 * instead of wedging every future bootstrap forever. */
export async function acquireBlocking(
  lockDir: string,
  purpose: string,
  opts: { timeoutMs?: number; staleMs?: number } = {},
): Promise<Release> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const staleMs = opts.staleMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  let delay = 25;
  for (;;) {
    const holder = tryTake(lockDir, purpose);
    if (!holder) return () => release(lockDir);
    if (isStale(holder, staleMs)) {
      console.error(
        `[float-mcp/policy] lock at ${lockDir} held by pid ${holder.pid} since ${holder.acquiredAt} is stale ` +
          `(> ${staleMs}ms) — forcing it clear (crashed holder).`,
      );
      release(lockDir);
      continue;
    }
    if (Date.now() > deadline) throw new LockHeldError(holder, `state lock at ${lockDir}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 500);
  }
}

/** Fail-fast, non-blocking mutex for an entire live Hedera flow. Never
 * queues a second concurrent live process — it names the holder and throws
 * immediately, because silently queuing is exactly the shape of #21's bug
 * (a second process waiting, then re-reading a "no treasury" state that is
 * no longer true by the time its own decision runs). */
export function acquireFailFast(lockDir: string, purpose: string, staleMs = 10 * 60_000): Release {
  let holder = tryTake(lockDir, purpose);
  if (!holder) return () => release(lockDir);
  if (isStale(holder, staleMs)) {
    console.error(
      `[float-mcp/policy] live-run lock at ${lockDir} held by pid ${holder.pid} since ${holder.acquiredAt} is ` +
        `stale (> ${staleMs}ms) — forcing it clear (crashed holder).`,
    );
    release(lockDir);
    holder = tryTake(lockDir, purpose);
    if (!holder) return () => release(lockDir);
  }
  throw new LockHeldError(holder, `live-run lock at ${lockDir}`);
}
