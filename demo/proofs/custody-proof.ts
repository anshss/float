#!/usr/bin/env node
// Rail proof for C6 (custody). Everything here is exactly what the ticket
// asked to be provable WITHOUT a human pressing a physical button:
// wallet-cli read-only discovery/balances/operations against a real
// attached device, the no-device-touch refusal preview built from our own
// transaction construction, and the spec R1 no-device degradation path for
// every custody entry point.
//
// Usage: npm run proof:custody (see package.json). Safe to re-run and safe
// in CI -- it never signs or broadcasts anything; the one thing that
// requires a physical press is `npm run demo:ledger-press` (live-verify.ts),
// intentionally kept separate.

import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.js';
import { discoverSepoliaAccounts, getBalances, getOperations } from '../../layers/custody/walletCli.js';
import { requestReplenishment } from '../../layers/custody/replenish.js';
import { requestLedgerGrantSignature } from '../../layers/policy/ledger-signer.js';
import { closeOperatorClient } from '../../layers/policy/hedera.js';
import { resetStateForTests as resetCustodyStateForTests } from '../../layers/custody/state.js';
import { resetStateForTests as resetPolicyStateForTests } from '../../layers/policy/state.js';

const lines: string[] = [];
function log(label: string, value: unknown) {
  const rendered = `\n--- ${label} ---\n${JSON.stringify(value, null, 2)}`;
  console.log(rendered);
  lines.push(rendered);
}

async function main() {
  // --- Part 1: real wallet-cli reads against the attached device (LEDGER_CLI_BIN configured) ---
  const liveConfig = loadConfig({ ...process.env, LEDGER_CLI_BIN: process.env.LEDGER_CLI_BIN ?? 'wallet-cli' });

  const discovered = await discoverSepoliaAccounts(liveConfig);
  log('wallet-cli account discover ethereum:sepolia (real device)', discovered);

  let account = 'ethereum-sepolia-1';
  if ('ok' in discovered && discovered.ok) {
    account = (discovered.data as { accounts: { label: string }[] }).accounts[0]?.label ?? account;
  }

  log('wallet-cli balances (real device, read-only)', await getBalances(liveConfig, account));
  log('wallet-cli operations (real device, read-only)', await getOperations(liveConfig, account));

  // --- Part 2: our own transaction-construction refusal preview (stands in for `send --dry-run`, which does not exist on Sepolia) ---
  resetCustodyStateForTests();
  const previewConfig = loadConfig({ ...process.env, DRY_RUN: '1', LEDGER_CLI_BIN: 'wallet-cli' });
  const preview = await requestReplenishment(
    { config: previewConfig, discoverTreasuryAddress: async () => (discovered as { ok: true; data: { accounts: { freshAddress: string }[] } }).data?.accounts?.[0]?.freshAddress as `0x${string}` | undefined ?? '0x1234567890123456789012345678901234567890' },
    { amountEth: '0.001' },
  );
  log('refusal preview (DRY_RUN, real tx construction, no device touch)', preview);

  // --- Part 3: no-device degradation (spec R1) -- every custody entry point ---
  const noDevice = loadConfig({ ...process.env, LEDGER_CLI_BIN: undefined, DRY_RUN: '0' });
  log('discoverSepoliaAccounts with no device configured', await discoverSepoliaAccounts(noDevice));
  log('getBalances with no device configured', await getBalances(noDevice, account));

  resetCustodyStateForTests();
  log(
    'requestReplenishment with no device configured',
    await requestReplenishment({ config: noDevice, discoverTreasuryAddress: async () => null }, { amountEth: '0.001' }),
  );

  resetPolicyStateForTests();
  log(
    'GRANT_SIGNER=ledger with no device configured (grant_budget stays callable)',
    await requestLedgerGrantSignature(noDevice, { childId: 'demo-child', ceiling: '3', scope: 'lending' }),
  );

  writeFileSync(new URL('./custody-proof.output.md', import.meta.url), `# C6 custody proof\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  console.log('\nWrote demo/proofs/custody-proof.output.md');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeOperatorClient); // see layers/policy/hedera.ts -- its cached gRPC channel pool otherwise holds this one-shot script's event loop open
