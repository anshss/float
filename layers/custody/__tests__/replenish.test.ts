import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { requestReplenishment, type ReplenishDeps } from '../replenish.js';
import { reportPending } from '../pending.js';
import { getReserve } from '../reserve.js';
import { resetStateForTests } from '../state.js';
import type { ChainReads } from '../txBuilder.js';
import type { LedgerSigner } from '../ledgerSigner.js';

const FROM = '0x58a8679318eaFBCbB28dC5e619886462f2A1872f' as const;
const TO = '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1' as const;

const fakeChainReads: ChainReads = {
  getTransactionCount: async () => 3,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
  estimateGas: async () => 21_000n,
};

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('requestReplenishment', () => {
  beforeEach(() => resetStateForTests());

  it('degrades to a no-device-touch preview denial under DRY_RUN, never opening a signer', async () => {
    const config = loadConfig({ LEDGER_FUNDING_ADDRESS: TO, LEDGER_CLI_BIN: 'wallet-cli', DRY_RUN: '1' });
    const deps: ReplenishDeps = {
      config,
      chainReads: fakeChainReads,
      discoverTreasuryAddress: async () => FROM,
      openSigner: async () => {
        throw new Error('must not open a signer under DRY_RUN');
      },
    };
    const result = await requestReplenishment(deps, { amountEth: '0.01' });
    expect(result).toMatchObject({ denied: true, reason: 'awaiting_device' });
    expect((result as { detail: string }).detail).toMatch(/PREVIEW ONLY, no device touched/);
    expect(getReserve(config).unlockedUsd).toBe(0);
  });

  it('degrades the same way with LIVE opted-in but LEDGER_CLI_BIN unset (spec R1: no device -> structured denial)', async () => {
    const config = loadConfig({ LEDGER_FUNDING_ADDRESS: TO, DRY_RUN: '0' });
    const deps: ReplenishDeps = { config, chainReads: fakeChainReads, discoverTreasuryAddress: async () => FROM };
    const result = await requestReplenishment(deps, { amountEth: '0.01' });
    expect(result).toMatchObject({ denied: true, reason: 'awaiting_device' });
  });

  it('LIVE + configured: starts a pending op, and confirm_pending only reports the real result after the injected press resolves', async () => {
    const config = loadConfig({
      LEDGER_FUNDING_ADDRESS: TO,
      LEDGER_CLI_BIN: 'wallet-cli',
      DRY_RUN: '0',
      FLOAT_RESERVE_UNLOCK_USD: '50',
    });
    let signedWith: { path: string; rawTxHex: string } | null = null;
    const fakeSigner: LedgerSigner = {
      getAddress: async () => ({ address: FROM }),
      signPersonalMessage: async () => ({ v: '00', r: '11'.repeat(32), s: '22'.repeat(32) }),
      signTransaction: async (path, rawTxHex) => {
        signedWith = { path, rawTxHex };
        return { v: '00', r: '11'.repeat(32), s: '22'.repeat(32) };
      },
      close: async () => {},
    };
    const deps: ReplenishDeps = {
      config,
      chainReads: fakeChainReads,
      discoverTreasuryAddress: async () => FROM,
      openSigner: async () => fakeSigner,
      broadcast: async () => '0xdeadbeef',
    };

    const started = await requestReplenishment(deps, { amountEth: '0.01' });
    expect(started).toMatchObject({ denied: true, reason: 'awaiting_device' });
    expect((started as { detail: string }).detail).toMatch(/PRESS THE BUTTON/);

    // Still pending immediately after -- the background signer promise
    // hasn't been awaited by requestReplenishment itself.
    expect(reportPending()).toMatchObject({ denied: true, reason: 'awaiting_device' });

    await tick();
    await tick();

    const confirmed = reportPending();
    expect(confirmed).toMatchObject({
      ok: true,
      data: { sepoliaTxHash: '0xdeadbeef', amountEth: '0.01', to: TO, reserveUnlockedUsd: 50 },
    });
    expect(signedWith).not.toBeNull();
    expect(getReserve(config).unlockedUsd).toBe(50);
  });
});
