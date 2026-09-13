import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { InMemorySignalStore } from '../../../src/contracts.js';
import { InMemorySignalDigestStore } from '../../perception/signalDigest.js';
import { resetStateForTests } from '../../policy/state.js';
import { pay } from '../pay.js';

// Signing is exercised for real by demo/proofs/x402-rail-proof.mjs (the
// live rail proof) — here we mock it so pay()'s policy/retry logic is
// tested without real Hedera crypto or network calls.
vi.mock('../signer.js', () => ({
  signPayment: vi.fn(async (_id: string, _key: string, requirements: unknown) => ({
    x402Version: 2,
    scheme: 'exact',
    network: 'hedera:testnet',
    accepted: requirements,
    payload: { transaction: 'fake-base64-tx' },
  })),
}));

function jsonRes(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return { ok: init.ok ?? true, status: init.status ?? (init.ok === false ? 402 : 200), json: async () => body } as Response;
}

const CHALLENGE = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'hedera:testnet',
      amount: '50000', // 0.0005 HBAR
      payTo: '0.0.10524025',
      maxTimeoutSeconds: 300,
      asset: '0.0.0',
      extra: { feePayer: '0.0.7162784' },
    },
  ],
};

function baseConfig() {
  return loadConfig({
    DRY_RUN: '1',
    HEDERA_OPERATOR_ID: '0.0.10523774',
    HEDERA_OPERATOR_KEY: 'a'.repeat(64),
    HEDERA_TOPIC_ID: '0.0.10524028',
  });
}

function deps(fetchImpl: typeof fetch) {
  return {
    config: baseConfig(),
    signalStore: new InMemorySignalStore(),
    digestStore: new InMemorySignalDigestStore(),
    fetchImpl,
  };
}

describe('pay()', () => {
  const originalCeiling = process.env.FLOAT_ROOT_CEILING_HBAR;

  beforeEach(() => {
    resetStateForTests();
    process.env.FLOAT_ROOT_CEILING_HBAR = '1'; // 1 HBAR root ceiling for these tests
  });

  afterEach(() => {
    if (originalCeiling === undefined) delete process.env.FLOAT_ROOT_CEILING_HBAR;
    else process.env.FLOAT_ROOT_CEILING_HBAR = originalCeiling;
  });

  it('denies without configured operator credentials, never throws', async () => {
    const result = await pay(
      { url: 'https://example.com/gated', max: '1' },
      { config: loadConfig({}), signalStore: new InMemorySignalStore(), digestStore: new InMemorySignalDigestStore() },
    );
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });

  it('denies without paying when the challenge amount exceeds the caller max', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(CHALLENGE, { ok: false, status: 402 }));
    const result = await pay({ url: 'https://example.com/gated', max: '0.0001' }, deps(fetchImpl));
    expect(result).toMatchObject({ denied: true, reason: 'ceiling_exceeded' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the initial GET — no payment sent.
  });

  it('denies without paying when the amount would exceed the root budget ceiling', async () => {
    // Root ceiling is 1 HBAR (beforeEach); challenge + mirror node "already
    // spent" pushes it over.
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes('example.com')) return jsonRes(CHALLENGE, { ok: false, status: 402 });
      if (url.includes('mirrornode')) {
        return jsonRes({
          messages: [
            {
              consensus_timestamp: '1',
              topic_id: '0.0.10524028',
              sequence_number: 1,
              payer_account_id: '0.0.10523774',
              // {"v":1,"kind":"spend","agent_id":"root","ts":"...","amount":"1.5"} — already over the 1 HBAR ceiling.
              message: Buffer.from(
                JSON.stringify({ v: 1, kind: 'spend', agent_id: 'root', ts: '2026-09-13T00:00:00Z', amount: '1.5' }),
              ).toString('base64'),
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await pay({ url: 'https://example.com/gated', max: '1' }, deps(fetchImpl));
    expect(result).toMatchObject({ denied: true, reason: 'ceiling_exceeded' });
    // Only the challenge GET and the mirror-node budget read — never a
    // payment retry.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([u]) => !String(u).includes('X-PAYMENT'))).toBe(true);
  });

  it('completes 402 -> pay -> retry -> 200 and returns the settlement tx', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('mirrornode')) return jsonRes({ messages: [] });
      if (url.includes('example.com')) {
        if (init?.headers && (init.headers as Record<string, string>)['X-PAYMENT']) {
          return jsonRes({
            report: { address: '0xabc', score: 90 },
            settlement: { tx: '0.0.7162784@1789307602.436493719', network: 'hedera:testnet', amount: '50000' },
          });
        }
        return jsonRes(CHALLENGE, { ok: false, status: 402 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const result = await pay({ url: 'https://example.com/gated', max: '1' }, deps(fetchImpl));
    expect(result).toMatchObject({
      ok: true,
      data: { tx: '0.0.7162784@1789307602.436493719', amountHbar: 0.0005 },
    });
  });
});
