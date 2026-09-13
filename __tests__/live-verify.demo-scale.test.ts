import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DEMO_CEILING_HBAR, DEMO_SPEND_HBAR, DEMO_OVERSPEND_HBAR } from '../layers/policy/live-verify.js';

// #17: the demo's ceiling/spend/funding numbers must move TOGETHER. If the
// treasury's real funding falls below the ceiling, an over-ceiling spend
// would still get denied — but on insufficient real balance, not on the
// ceiling_exceeded check the demo claims to be proving, which reads as the
// same PASS while demonstrating nothing. This test pins the relationship so
// that can't silently drift back out of sync.
describe('live-verify demo scale (#17)', () => {
  const funding = loadConfig({}).funding;

  it('a within-ceiling spend stays within the ceiling', () => {
    expect(DEMO_SPEND_HBAR).toBeLessThanOrEqual(DEMO_CEILING_HBAR);
  });

  it('the over-ceiling attempt genuinely exceeds the ceiling', () => {
    expect(DEMO_OVERSPEND_HBAR).toBeGreaterThan(DEMO_CEILING_HBAR);
  });

  it('the treasury is funded enough to cover the ceiling on-chain, so a denial fires on the ceiling check and never on real balance', () => {
    expect(funding.treasuryInitialHbar).toBeGreaterThanOrEqual(DEMO_CEILING_HBAR);
  });
});
