import { describe, it, expect } from 'vitest';
import { DENIAL_COPY } from '../copy.js';
import { assertAgentSafe } from '../sanitize.js';

describe('DENIAL_COPY', () => {
  it('every denial reason has agent-view-safe copy', () => {
    for (const [reason, text] of Object.entries(DENIAL_COPY)) {
      expect(() => assertAgentSafe(text), `reason "${reason}"`).not.toThrow();
    }
  });

  it('the awaiting_device copy uses the "awaiting_device" verb, not a chain-specific description', () => {
    expect(DENIAL_COPY.awaiting_device).toMatch(/^awaiting_device/);
  });
});
