import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

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
      const first = runProbe('live-lock', stateDir, 300);
      // Give the first probe a moment to actually take the lock before the
      // second one tries — this proves fail-fast, not "eventually acquires".
      await new Promise((r) => setTimeout(r, 80));
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
