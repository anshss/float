import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { discoverSepoliaAccounts, getBalances, getOperations, parseLastJsonLine } from '../walletCli.js';

describe('wallet-cli read-only wrapper -- no-device degradation (spec R1)', () => {
  it('discoverSepoliaAccounts denies without ever shelling out when LEDGER_CLI_BIN is unset', async () => {
    const result = await discoverSepoliaAccounts(loadConfig({}));
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
    expect((result as { detail: string }).detail).toMatch(/LEDGER_CLI_BIN/);
  });

  it('getBalances denies the same way with no configured binary', async () => {
    const result = await getBalances(loadConfig({}), 'ethereum-sepolia-1');
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });

  it('getOperations denies the same way with no configured binary', async () => {
    const result = await getOperations(loadConfig({}), 'ethereum-sepolia-1');
    expect(result).toMatchObject({ denied: true, reason: 'deployment_unavailable' });
  });
});

describe('parseLastJsonLine', () => {
  it('picks the final JSON line out of wallet-cli\'s streamed progress + result output', () => {
    const stdout =
      '{"type":"device-state","state":{"code":"awaiting_approval"}}\n' +
      '{"status":"success","command":"account discover","accounts":[{"label":"ethereum-sepolia-1"}]}\n';
    expect(parseLastJsonLine(stdout)).toEqual({
      status: 'success',
      command: 'account discover',
      accounts: [{ label: 'ethereum-sepolia-1' }],
    });
  });

  it('throws with the raw output when nothing parses as JSON', () => {
    expect(() => parseLastJsonLine('not json at all')).toThrow(/no parseable JSON/);
  });
});
