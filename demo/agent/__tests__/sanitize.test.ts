import { describe, it, expect } from 'vitest';
import { assertAgentSafe, BANNED_TOKENS } from '../sanitize.js';

describe('assertAgentSafe', () => {
  it('passes through a clean line unchanged', () => {
    expect(assertAgentSafe('[beat 3] pay — paid within budget; receipt 0.0.1@1.1')).toBe(
      '[beat 3] pay — paid within budget; receipt 0.0.1@1.1',
    );
  });

  it.each(BANNED_TOKENS)('throws when the line contains "%s"', (token) => {
    expect(() => assertAgentSafe(`some line mentioning ${token} in passing`)).toThrow(/presentation rule violated/);
  });

  it('is case-insensitive', () => {
    expect(() => assertAgentSafe('Settled on HEDERA testnet')).toThrow();
  });

  it('catches a mid-word occurrence, not just a whole-word one', () => {
    // "hierarchy" carries "arc" mid-word — exactly the GRAPH_API_KEY /
    // hierarchy-invariant shaped leak this check exists to catch.
    expect(() => assertAgentSafe('hierarchy invariant enforced at grant time')).toThrow();
    expect(() => assertAgentSafe('GRAPH_API_KEY not configured')).toThrow();
  });

  it('does not flag unrelated chain names the demo is allowed to mention (Ethereum, Polygon, Arbitrum)', () => {
    expect(() => assertAgentSafe('ranked markets across ethereum, polygon and arbitrum deployments')).not.toThrow();
  });
});
