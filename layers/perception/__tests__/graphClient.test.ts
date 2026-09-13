import { describe, it, expect, vi } from 'vitest';
import { queryGraph, mapWithConcurrency } from '../graphClient.js';
import { loadFixture } from './fixtures.js';

describe('queryGraph', () => {
  it('returns real recorded market data on success', async () => {
    const fixture = loadFixture('markets.aave-v3-ethereum.json');
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture }) as Response);
    const result = await queryGraph('JCNW...', '{ markets { name } }', undefined, { apiKey: 'k', fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { markets: unknown[] }).markets.length).toBeGreaterThan(0);
    }
  });

  it('surfaces the real dead-deployment GraphQL error recorded from aave-v3-base', async () => {
    const fixture = loadFixture('meta.aave-v3-base.json');
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture }) as Response);
    const result = await queryGraph('D7ma...', '{ _meta { deployment } }', undefined, { apiKey: 'k', fetchImpl });
    expect(result).toEqual({ ok: false, error: 'subgraph not found: no allocations' });
  });

  it('turns a non-2xx response into a structured error, never a throw', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    const result = await queryGraph('x', '{}', undefined, { apiKey: 'k', fetchImpl });
    expect(result).toEqual({ ok: false, error: 'gateway http 503' });
  });

  it('turns a network exception into a structured error, never a throw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const result = await queryGraph('x', '{}', undefined, { apiKey: 'k', fetchImpl });
    expect(result).toEqual({ ok: false, error: 'ECONNRESET' });
  });
});

describe('mapWithConcurrency', () => {
  it('runs every item exactly once and never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 3, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i * 2;
    });
    expect(results).toEqual(items.map((i) => i * 2));
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
