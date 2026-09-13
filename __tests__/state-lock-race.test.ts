import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Mirrors layers/policy/state.ts's own (unexported) LIVE_LOCK_DIR name --
// polling for this directory on disk is ground truth for "the lock is
// actually held", unlike a stdio marker from the child (which could in
// principle be delayed by pipe buffering one more hop than a direct fs
// check on the same filesystem this test itself is running on).
const LIVE_LOCK_DIR_NAME = '.hedera.live-lock';

async function waitFor(predicate: () => boolean, timeoutMs: number, describeFailure: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${describeFailure}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// #21: proves, with two REAL concurrent OS processes racing on one shared
// state directory (not two in-process calls — the incident was two
// different `claude`/tool-call processes, and an in-process race would
// pass trivially on Node's single-threaded event loop for anything that
// doesn't await mid-critical-section), that the fix actually closes the
// read-null -> mint -> save race that minted eight orphaned treasuries.
// NEVER does a live Hedera mint — `bootstrap-lock-probe.ts` fakes the mint
// with a sleep, same as the ticket's "prove it without spending money" ask.

const probePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bootstrap-lock-probe.ts');
const tsxBin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'tsx');

function runProbe(mode: string, stateDir: string, mintDelayMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [probePath, mode, String(mintDelayMs)], {
      env: { ...process.env, VITEST: '', FLOAT_STATE_DIR: stateDir },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`probe ${mode} exited ${code}: ${stderr}`));
      resolve(JSON.parse(stdout));
    });
  });
}

describe('bootstrap state lock closes the concurrent-mint race (#21)', () => {
  it('two concurrent processes racing withStateLock never both mint', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'float-mcp-lock-race-'));
    try {
      const [a, b] = await Promise.all([runProbe('state-lock', stateDir, 150), runProbe('state-lock', stateDir, 10)]);

      const minted = [a, b].filter((r) => r.minted === true);
      const skipped = [a, b].filter((r) => r.minted === false);
      expect(minted).toHaveLength(1);
      expect(skipped).toHaveLength(1);
      // The one that saw an existing treasury must see the SAME account the
      // minter actually created — never a null/stale read.
      expect(skipped[0].accountId).toBe(minted[0].accountId);

      const onDisk = JSON.parse(readFileSync(join(stateDir, 'hedera.json'), 'utf8'));
      expect(onDisk.treasury.accountId).toBe(minted[0].accountId);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('a live-run lock held by one process fails the second fast, naming the holder', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'float-mcp-live-lock-'));
    try {
      // Wait for the lock directory to actually exist on disk rather than a
      // fixed sleep — a flat delay races real process-spawn time under CI
      // load (node/tsx startup routinely exceeds tens of ms under load), and
      // a second probe that wins that race falsifies the "fails fast" claim
      // this test exists to prove. Polling the filesystem directly (not a
      // stdio marker from the child) is ground truth: no pipe-buffering hop
      // between "the lock is held" and this test observing it.
      const firstChild = spawn(tsxBin, [probePath, 'live-lock', '300'], {
        env: { ...process.env, VITEST: '', FLOAT_STATE_DIR: stateDir },
      });
      let firstStdout = '';
      let firstStderr = '';
      firstChild.stdout.on('data', (d) => (firstStdout += d));
      firstChild.stderr.on('data', (d) => (firstStderr += d));
      const first = new Promise<Record<string, unknown>>((resolve, reject) => {
        firstChild.on('close', (code) => {
          if (code !== 0) return reject(new Error(`probe live-lock exited ${code}: ${firstStderr}`));
          resolve(JSON.parse(firstStdout));
        });
      });
      const lockDirPath = join(stateDir, LIVE_LOCK_DIR_NAME);
      await waitFor(() => existsSync(lockDirPath), 5000, `${lockDirPath} to exist (stderr so far: ${firstStderr})`);

      const second = await runProbe('live-lock', stateDir, 0);

      expect(second.acquired).toBe(false);
      expect(typeof second.holderPid).toBe('number');
      const firstResult = await first;
      expect(firstResult.acquired).toBe(true);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
