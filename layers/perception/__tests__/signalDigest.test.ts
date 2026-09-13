import { describe, it, expect } from 'vitest';
import { digestResult, InMemorySignalDigestStore } from '../signalDigest.js';

describe('digestResult', () => {
  it('hashes the full payload and slices the ranked head', () => {
    const payload = { rankedRates: [1, 2, 3, 4, 5, 6] };
    const entry = digestResult(payload, payload.rankedRates, 3);
    expect(entry.digest).toHaveLength(64); // sha256 hex
    expect(entry.rankedHead).toEqual([1, 2, 3]);
  });

  it('is deterministic for identical input', () => {
    const a = digestResult({ x: 1 }, [1, 2]);
    const b = digestResult({ x: 1 }, [1, 2]);
    expect(a.digest).toBe(b.digest);
  });

  it('changes when the payload changes', () => {
    const a = digestResult({ x: 1 }, [1]);
    const b = digestResult({ x: 2 }, [1]);
    expect(a.digest).not.toBe(b.digest);
  });
});

describe('InMemorySignalDigestStore', () => {
  it('stores and retrieves by id, keyed independently of SignalStore', () => {
    const store = new InMemorySignalDigestStore();
    store.put('sig_1', { digest: 'abc', rankedHead: [1] });
    expect(store.get('sig_1')).toEqual({ digest: 'abc', rankedHead: [1] });
    expect(store.get('missing')).toBeNull();
  });
});
