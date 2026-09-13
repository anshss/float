import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('config', () => {
  it('with no env vars set: every layer reports unconfigured and dryRun defaults true', () => {
    const config = loadConfig({});
    expect(config.configured).toEqual({
      graph: false,
      hedera: false,
      privy: false,
      ledger: false,
    });
    expect(config.dryRun).toBe(true);
  });

  it('never crashes on missing config — loadConfig always returns, never throws', () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it('DRY_RUN=0 with every write layer configured turns dryRun off', () => {
    const config = loadConfig({
      DRY_RUN: '0',
      HEDERA_OPERATOR_ID: '0.0.1',
      HEDERA_OPERATOR_KEY: 'k',
      HEDERA_TREASURY_ID: '0.0.2',
      HEDERA_TREASURY_KEY: 'k',
      HEDERA_TOPIC_ID: '0.0.3',
      PRIVY_APP_ID: 'a',
      PRIVY_APP_SECRET: 's',
      PRIVY_WALLET_ID: 'w',
      LEDGER_CLI_BIN: '/usr/local/bin/ledger',
    });
    expect(config.configured.hedera).toBe(true);
    expect(config.configured.privy).toBe(true);
    expect(config.configured.ledger).toBe(true);
    expect(config.dryRun).toBe(false);
  });

  it('DRY_RUN unset defaults true when a write layer is missing creds', () => {
    const config = loadConfig({});
    expect(config.dryRun).toBe(true);
  });

  it('an explicit DRY_RUN=0 is honored even with write layers missing (explicit env wins over the default)', () => {
    const config = loadConfig({ DRY_RUN: '0' });
    expect(config.dryRun).toBe(false);
  });

  it('GRAPH_API_KEY alone configures the graph layer only', () => {
    const config = loadConfig({ GRAPH_API_KEY: 'k' });
    expect(config.configured.graph).toBe(true);
    expect(config.configured.hedera).toBe(false);
  });

  it('caps fall back to defaults when FLOAT_CAP_* are unset', () => {
    const config = loadConfig({});
    expect(config.caps.defaultUsd).toBeGreaterThan(0);
    expect(config.caps.hotBalanceUsd).toBeGreaterThan(0);
  });

  it('caps are read from FLOAT_CAP_* when set', () => {
    const config = loadConfig({ FLOAT_CAP_DEFAULT_USD: '75', FLOAT_CAP_HOT_BALANCE_USD: '500' });
    expect(config.caps.defaultUsd).toBe(75);
    expect(config.caps.hotBalanceUsd).toBe(500);
  });

  it('never returns key material fields verbatim in configured/caps output', () => {
    const config = loadConfig({ HEDERA_OPERATOR_KEY: 'super-secret-key' });
    const publicShape = { dryRun: config.dryRun, configured: config.configured, caps: config.caps };
    expect(JSON.stringify(publicShape)).not.toContain('super-secret-key');
  });
});
