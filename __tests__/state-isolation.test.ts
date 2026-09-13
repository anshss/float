import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// #18: under VITEST, resolveStateDir() used to point every worker at the
// same tmpdir() state file, so parallel test files raced on
// resetStateForTests(). This pins the fix at the level the bug actually
// occurs — two DIFFERENT PROCESSES (real vitest workers are separate
// processes, one per VITEST_POOL_ID) writing and reading state
// concurrently — rather than asserting a code-review conclusion.
const probePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pool-isolation-probe.ts');
const tsxBin = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'tsx');

function runProbe(poolId: string, delayMs: number): Promise<{ poolId: string; path: string; treasuryAccountId: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [probePath, poolId, String(delayMs)], {
      env: { ...process.env, VITEST: 'true', VITEST_POOL_ID: poolId },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`probe ${poolId} exited ${code}: ${stderr}`));
      resolve(JSON.parse(stdout));
    });
  });
}

describe('policy state isolation across concurrent vitest worker processes (#18)', () => {
  it('two concurrently-running "test files" (worker processes) never observe each other\'s state', async () => {
    // Probe A writes then sleeps past probe B's write+read, so if they
    // shared one state file, A would read back B's value instead of its own.
    const [a, b] = await Promise.all([runProbe('isolation-a', 150), runProbe('isolation-b', 0)]);

    expect(a.path).not.toBe(b.path);
    expect(a.treasuryAccountId).toBe('0.0.probe-isolation-a');
    expect(b.treasuryAccountId).toBe('0.0.probe-isolation-b');
  });
});
