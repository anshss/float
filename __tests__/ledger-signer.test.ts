import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config.js';
import { requestLedgerGrantSignature } from '../layers/policy/ledger-signer.js';
import { resetStateForTests as resetPolicyStateForTests, loadState as loadPolicyState } from '../layers/policy/state.js';
import { resetStateForTests as resetCustodyStateForTests } from '../layers/custody/state.js';
import { reportPending } from '../layers/custody/pending.js';
import type { LedgerSigner } from '../layers/custody/ledgerSigner.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('GRANT_SIGNER=ledger (real seam)', () => {
  beforeEach(() => {
    resetPolicyStateForTests();
    resetCustodyStateForTests();
  });

  it('degrades to a structured denial with no device configured (spec R1) -- grant_budget still callable', async () => {
    const config = loadConfig({ DRY_RUN: '1' });
    const result = await requestLedgerGrantSignature(config, { childId: 'child-a', ceiling: '3', scope: 'lending' });
    expect(result).toMatchObject({ denied: true, reason: 'awaiting_device' });
  });

  it('never commits the Hedera grant before the device press resolves, and commits it for real once the press is observed', async () => {
    const config = loadConfig({ DRY_RUN: '1', LEDGER_CLI_BIN: 'wallet-cli' });
    let pressed = false;
    const fakeSigner: LedgerSigner = {
      getAddress: async () => ({ address: '0x0' }),
      signPersonalMessage: async () => {
        pressed = true;
        return { v: '00', r: '11'.repeat(32), s: '22'.repeat(32) };
      },
      signTransaction: async () => {
        throw new Error('must not sign a transaction for a grant attestation');
      },
      close: async () => {},
    };

    const started = await requestLedgerGrantSignature(
      config,
      { childId: 'child-a', ceiling: '3', scope: 'lending' },
      { openSigner: async () => fakeSigner },
    );
    expect(started).toMatchObject({ denied: true, reason: 'awaiting_device' });
    // The grant is never committed synchronously inside the call that
    // kicks off the press -- only once the background promise resolves.
    expect(loadPolicyState().policies['child-a']).toBeUndefined();

    await tick();
    await tick();

    expect(pressed).toBe(true);
    const confirmed = reportPending();
    expect(confirmed).toMatchObject({ ok: true, data: { agent_id: 'child-a', ceiling_hbar: 3, ledger_authorized: true, dry_run: true } });
    expect(loadPolicyState().policies['child-a']).toMatchObject({ agentId: 'child-a', ceilingHbar: 3 });
  });
});
