import { describe, it, expect } from 'vitest';
import { ok, denied, InMemorySignalStore } from '../src/contracts.js';

describe('contracts', () => {
  it('ok() round-trips data and omits provenance when not given', () => {
    const result = ok({ hello: 'world' });
    expect(result).toEqual({ ok: true, data: { hello: 'world' } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('ok() carries provenance when given', () => {
    const provenance = { source: 'graph' as const, queriedAt: '2026-01-01T00:00:00.000Z', deploymentId: 'Qm123' };
    const result = ok({ rate: 1 }, provenance);
    expect(result.provenance).toEqual(provenance);
  });

  it('denied() round-trips through JSON with the exact denial shape', () => {
    const d = denied('ceiling_exceeded', 'over the $50 cap');
    expect(JSON.parse(JSON.stringify(d))).toEqual({
      denied: true,
      reason: 'ceiling_exceeded',
      detail: 'over the $50 cap',
    });
  });

  it('every DenialReason from the spec is assignable', () => {
    const reasons = [
      'ceiling_exceeded',
      'no_signal_cited',
      'awaiting_device',
      'deployment_unavailable',
      'provider_policy_denied',
    ] as const;
    for (const reason of reasons) {
      expect(denied(reason, 'x').reason).toBe(reason);
    }
  });

  it('InMemorySignalStore: put() then get() returns the same ref; unknown id returns null', () => {
    const store = new InMemorySignalStore();
    const ref = store.put({ tool: 'compare_markets', deploymentId: 'Qm123', queriedAt: '2026-01-01T00:00:00.000Z' });
    expect(store.get(ref.id)).toEqual(ref);
    expect(store.get('nonexistent')).toBeNull();
  });

  it('InMemorySignalStore: distinct put() calls get distinct ids', () => {
    const store = new InMemorySignalStore();
    const a = store.put({ tool: 'compare_markets', deploymentId: 'Qm1', queriedAt: '2026-01-01T00:00:00.000Z' });
    const b = store.put({ tool: 'compare_markets', deploymentId: 'Qm2', queriedAt: '2026-01-01T00:00:00.000Z' });
    expect(a.id).not.toBe(b.id);
  });
});
