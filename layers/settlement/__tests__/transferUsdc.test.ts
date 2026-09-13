import { describe, it, expect } from 'vitest';
import { parseUnits, TransactionExecutionError } from 'viem';
import { AuthenticationError, PermissionDeniedError } from '@privy-io/node';
import { transferUsdc, type SettlementDeps } from '../transferUsdc.js';
import { InMemorySignalStore } from '../../../src/contracts.js';
import { InMemorySignalDigestStore, digestResult } from '../../perception/signalDigest.js';
import { loadConfig } from '../../../src/config.js';

const PRIVY_ENV = {
  // Privy alone doesn't clear C1's tri-layer DRY_RUN default (Hedera/Ledger
  // aren't wired yet) -- explicit override, exactly as config.test.ts
  // documents, so these tests exercise the real (non-stubbed) path.
  DRY_RUN: '0',
  PRIVY_APP_ID: 'app',
  PRIVY_APP_SECRET: 'secret',
  PRIVY_AUTHORIZATION_KEY: 'wallet-auth:ZmFrZS1rZXk=',
  PRIVY_WALLET_ID: 'wallet-1',
  PRIVY_WALLET_ADDRESS: '0x1111111111111111111111111111111111111111',
};

function makeDeps(overrides: Partial<SettlementDeps> = {}): { deps: SettlementDeps; signalId: string } {
  const signalStore = new InMemorySignalStore();
  const digestStore = new InMemorySignalDigestStore();
  const signal = signalStore.put({ tool: 'compare_markets', deploymentId: 'Qm123', queriedAt: new Date().toISOString() });
  digestStore.put(signal.id, digestResult({ rate: 1 }, [{ rate: 1 }]));
  const deps: SettlementDeps = {
    config: loadConfig(PRIVY_ENV),
    signalStore,
    digestStore,
    getBalanceImpl: async () => parseUnits('100', 18),
    sendTransactionImpl: async () => '0xdeadbeef' as `0x${string}`,
    ...overrides,
  };
  return { deps, signalId: signal.id };
}

describe('transferUsdc', () => {
  it('refuses an unresolvable signal_ref with no_signal_cited, before touching Privy', async () => {
    const { deps } = makeDeps();
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: 'sig_missing' }, deps);
    expect(result).toEqual({
      denied: true,
      reason: 'no_signal_cited',
      detail: 'signal_ref "sig_missing" does not resolve to a known perception-layer query result',
    });
  });

  it('refuses with deployment_unavailable when Privy is not configured (DRY_RUN explicitly off)', async () => {
    const { deps, signalId } = makeDeps({ config: loadConfig({ DRY_RUN: '0' }) });
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: signalId }, deps);
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });

  it('DRY_RUN (default true with no write layer configured) stubs the transfer, never touches Privy', async () => {
    const { deps, signalId } = makeDeps({
      config: loadConfig({}),
      sendTransactionImpl: async () => {
        throw new Error('must not be called in a dry run');
      },
    });
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: signalId }, deps);
    if (!('ok' in result) || !result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.data).toMatchObject({ dryRun: true, to: '0xabc', amount: '1', signalRef: signalId });
  });

  it('DRY_RUN still enforces no_signal_cited -- a dry run rehearses the real gate, never skips it', async () => {
    const { deps } = makeDeps({ config: loadConfig({}) });
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: 'sig_missing' }, deps);
    expect(result).toMatchObject({ denied: true, reason: 'no_signal_cited' });
  });

  it('refuses over-float amounts with awaiting_device, sourced from the wallet balance', async () => {
    const { deps, signalId } = makeDeps({ getBalanceImpl: async () => parseUnits('0.5', 18) });
    const result = await transferUsdc({ to: '0xabc', amount: '10', signal_ref: signalId }, deps);
    expect(result).toEqual({
      denied: true,
      reason: 'awaiting_device',
      detail: "requested 10 USDC exceeds the hot wallet's float (0.5 USDC available) -- awaiting treasury replenishment via C6",
    });
  });

  it('surfaces a real PrivyAPIError as provider_policy_denied, never synthesized', async () => {
    const apiError = new AuthenticationError(401, { message: 'policy rejected transaction' }, 'denied', new Headers());
    const { deps, signalId } = makeDeps({
      sendTransactionImpl: async () => {
        throw apiError;
      },
    });
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: signalId }, deps);
    expect(result).toEqual({
      denied: true,
      reason: 'provider_policy_denied',
      detail: 'Privy 401: policy rejected transaction',
    });
  });

  it('unwraps a PrivyAPIError even when viem wraps it in a TransactionExecutionError', async () => {
    const apiError = new PermissionDeniedError(403, { error: 'RPC request denied due to policy violation', code: 'policy_violation' }, 'denied', new Headers());
    const wrapped = new TransactionExecutionError(apiError as unknown as import('viem').BaseError, {
      account: null,
      to: '0xabc',
      value: 1n,
    });
    const { deps, signalId } = makeDeps({
      sendTransactionImpl: async () => {
        throw wrapped;
      },
    });
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: signalId }, deps);
    expect(result).toMatchObject({ denied: true, reason: 'provider_policy_denied' });
    if (!('denied' in result)) throw new Error('expected a denial');
    expect(result.detail).toContain('policy_violation');
  });

  it('refuses amounts over the float cap with ceiling_exceeded, without ever calling Privy', async () => {
    const { deps, signalId } = makeDeps({
      config: loadConfig({ ...PRIVY_ENV, FLOAT_CAP_DEFAULT_USD: '10' }),
      sendTransactionImpl: async () => {
        throw new Error('must not be called once the app-level cap already refused');
      },
    });
    const result = await transferUsdc({ to: '0xabc', amount: '11', signal_ref: signalId }, deps);
    expect(result).toEqual({
      denied: true,
      reason: 'ceiling_exceeded',
      detail: 'requested 11 USDC exceeds the 10 USDC per-transfer float cap',
    });
  });

  it('a non-Privy error is reported as deployment_unavailable, never mislabeled as a Privy policy denial', async () => {
    const { deps, signalId } = makeDeps({
      sendTransactionImpl: async () => {
        throw new Error('rpc timeout');
      },
    });
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: signalId }, deps);
    expect(result).toEqual({ denied: true, reason: 'deployment_unavailable', detail: 'rpc timeout' });
  });

  it('rejects a non-numeric amount without ever calling Privy', async () => {
    const { deps, signalId } = makeDeps();
    const result = await transferUsdc({ to: '0xabc', amount: 'not-a-number', signal_ref: signalId }, deps);
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });

  it('a signal-cited, in-float, policy-clean transfer lands and echoes the signal digest', async () => {
    const { deps, signalId } = makeDeps();
    const result = await transferUsdc({ to: '0xabc', amount: '1', signal_ref: signalId }, deps);
    if (!('ok' in result) || !result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.data).toMatchObject({
      txHash: '0xdeadbeef',
      explorerUrl: 'https://testnet.arcscan.app/tx/0xdeadbeef',
      to: '0xabc',
      amount: '1',
      signalRef: signalId,
    });
    expect((result.data as { signalDigest: string }).signalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.provenance).toMatchObject({ source: 'privy' });
  });
});
