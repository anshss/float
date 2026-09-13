import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../../src/config.js';
import { InMemorySignalStore } from '../../../src/contracts.js';
import { InMemorySignalDigestStore } from '../../perception/signalDigest.js';
import { startResourceServer } from '../resourceServer.js';
import { encodePaymentSignatureHeader } from '@x402/core/http';

function config() {
  return loadConfig({ HEDERA_OPERATOR_ID: '0.0.10523774' });
}

describe('gated resource server (seller side)', () => {
  let server: ReturnType<typeof startResourceServer> | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('returns a real 402 challenge with the facilitator feePayer when unpaid', async () => {
    const facilitatorDeps = {
      fetchImpl: vi.fn(async () =>
        ({ ok: true, json: async () => ({ x402Version: 2, kinds: [{ network: 'hedera:testnet', extra: { feePayer: '0.0.7162784' } }] }) }) as Response,
      ),
    };
    server = startResourceServer({ config: config(), signalStore: new InMemorySignalStore(), digestStore: new InMemorySignalDigestStore(), facilitatorDeps }, 0);
    const port = (server.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${port}/premium/counterparty-risk/0xabc`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.accepts[0]).toMatchObject({ scheme: 'exact', network: 'hedera:testnet', extra: { feePayer: '0.0.7162784' } });
  });

  it('verifies+settles via the facilitator and returns 200 with the report and settlement tx', async () => {
    const facilitatorDeps = {
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.endsWith('/verify')) return { ok: true, json: async () => ({ isValid: true }) } as Response;
        if (url.endsWith('/settle')) {
          return {
            ok: true,
            json: async () => ({ success: true, transaction: '0.0.7162784@1789307602.436493719', network: 'hedera:testnet', amount: '50000' }),
          } as Response;
        }
        throw new Error(`unexpected facilitator call: ${url}`);
      }),
    };
    server = startResourceServer({ config: config(), signalStore: new InMemorySignalStore(), digestStore: new InMemorySignalDigestStore(), facilitatorDeps }, 0);
    const port = (server.address() as AddressInfo).port;

    const paymentHeader = encodePaymentSignatureHeader({
      x402Version: 2,
      accepted: { scheme: 'exact', network: 'hedera:testnet', amount: '50000', payTo: '0.0.10523774', maxTimeoutSeconds: 300, asset: '0.0.0', extra: {} },
      payload: { transaction: 'fake' },
    } as never);

    const res = await fetch(`http://127.0.0.1:${port}/premium/counterparty-risk/0xabc`, {
      headers: { 'X-PAYMENT': paymentHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.settlement.tx).toBe('0.0.7162784@1789307602.436493719');
    expect(body.report.denied).toBe(true); // GRAPH_API_KEY not configured in this test's config — still a structured response, not a throw.
  });

  it('returns 402 when the facilitator rejects settlement', async () => {
    const facilitatorDeps = {
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = input.toString();
        if (url.endsWith('/verify')) return { ok: true, json: async () => ({ isValid: true }) } as Response;
        if (url.endsWith('/settle')) return { ok: true, json: async () => ({ success: false, errorReason: 'insufficient_funds' }) } as Response;
        throw new Error(`unexpected facilitator call: ${url}`);
      }),
    };
    server = startResourceServer({ config: config(), signalStore: new InMemorySignalStore(), digestStore: new InMemorySignalDigestStore(), facilitatorDeps }, 0);
    const port = (server.address() as AddressInfo).port;

    const paymentHeader = encodePaymentSignatureHeader({
      x402Version: 2,
      accepted: { scheme: 'exact', network: 'hedera:testnet', amount: '50000', payTo: '0.0.10523774', maxTimeoutSeconds: 300, asset: '0.0.0', extra: {} },
      payload: { transaction: 'fake' },
    } as never);

    const res = await fetch(`http://127.0.0.1:${port}/premium/counterparty-risk/0xabc`, {
      headers: { 'X-PAYMENT': paymentHeader },
    });
    expect(res.status).toBe(402);
  });
});
