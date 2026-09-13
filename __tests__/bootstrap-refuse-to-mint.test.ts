import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { ensureTreasury, TreasuryMintRefusedError } from '../layers/policy/bootstrap.js';
import { resetStateForTests, saveState, stateFilePathForDebug } from '../layers/policy/state.js';

// #21's load-bearing guard: bootstrap must STOP rather than mint when doing
// so would very likely orphan real value. Never lets a real Hedera call
// happen — the fetch mock in the second test guarantees no live network
// request occurs even by accident.

const backupsDir = join(dirname(stateFilePathForDebug()), '.backups');
const liveConfig = () => loadConfig({ DRY_RUN: '0', HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'fake' });

beforeEach(() => {
  resetStateForTests();
  if (existsSync(backupsDir)) rmSync(backupsDir, { recursive: true, force: true });
  delete process.env.FLOAT_FORCE_MINT_TREASURY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ensureTreasury refuses to mint when it would orphan value (#21)', () => {
  it('refuses when state has no treasury but the most recent backup does', async () => {
    // Manufacture the exact shape of the incident: a prior saveState wrote a
    // real treasury, a later one cleared it — the backup taken along the
    // way still remembers it.
    saveState({ treasury: { accountId: '0.0.999999', privateKey: 'k' }, topicId: null, agents: {}, policies: {} });
    saveState({ treasury: null, topicId: null, agents: {}, policies: {} });

    await expect(ensureTreasury(liveConfig())).rejects.toThrow(TreasuryMintRefusedError);
    await expect(ensureTreasury(liveConfig())).rejects.toThrow(/backup .* still records treasury 0\.0\.999999/);
  });

  it('mints normally once FLOAT_FORCE_MINT_TREASURY=1 overrides an otherwise-refused mint', async () => {
    saveState({ treasury: { accountId: '0.0.999999', privateKey: 'k' }, topicId: null, agents: {}, policies: {} });
    saveState({ treasury: null, topicId: null, agents: {}, policies: {} });
    // Also stub the mirror-node orphan check so this test can't reach the
    // network even if the backup short-circuit above ever changed.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transactions: [] }) }),
    );
    process.env.FLOAT_FORCE_MINT_TREASURY = '1';

    // The override clears the guard, but this is still a live (non-DRY_RUN)
    // config with no real Hedera credentials, so the actual mint attempt
    // fails at `requireOperator`/network — proving the guard, not the mint,
    // is what this test exercises. A refusal-shaped error here would mean
    // the override didn't work.
    await expect(ensureTreasury(liveConfig())).rejects.not.toThrow(TreasuryMintRefusedError);
  });

  it('refuses when the operator already created a funded account not recorded in state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/transactions?')) {
          return {
            ok: true,
            json: async () => ({
              transactions: [{ entity_id: '0.0.5000001', result: 'SUCCESS' }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ balance: { balance: 500_000_000 }, created_timestamp: '123.0' }),
        };
      }),
    );

    await expect(ensureTreasury(liveConfig())).rejects.toThrow(TreasuryMintRefusedError);
    await expect(ensureTreasury(liveConfig())).rejects.toThrow(/0\.0\.5000001/);
  });
});
