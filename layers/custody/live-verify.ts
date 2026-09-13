// The ONE command for the live-press rehearsal: `npm run demo:ledger-press`
// (or `DRY_RUN=0 npx tsx layers/custody/live-verify.ts` directly) from
// float-mcp/. Everything up to "PRESS THE BUTTON" runs headless; the one
// human step is printed on-screen with nothing else to configure.
//
// Does, in order, against Sepolia + the attached Ledger:
//   1. wallet-cli account discover + balances (read-only, no press beyond
//      opening the Ethereum app if it isn't already open).
//   2. Builds a real, tiny (0.001 ETH) treasury-authorization transaction
//      to LEDGER_FUNDING_ADDRESS and starts the pending device operation.
//   3. Polls confirm_pending()'s own logic every 2s, printing the on-device
//      prompt, until the press lands (or 3 minutes pass).
//   4. Prints the Sepolia tx hash, a Sepolia Etherscan link, and the
//      resulting reserve-unlock bookkeeping.

import { loadConfig } from '../../src/config.js';
import { closeOperatorClient } from '../policy/hedera.js';
import { discoverSepoliaAccounts, getBalances } from './walletCli.js';
import { requestReplenishment } from './replenish.js';
import { reportPending } from './pending.js';

const POLL_MS = 2000;
const TIMEOUT_MS = 3 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();
  if (config.dryRun) {
    console.error('DRY_RUN is on -- set DRY_RUN=0 (or FLOAT_LIVE=1) to run the live press.');
    process.exit(1);
  }
  if (!config.configured.ledger) {
    console.error('LEDGER_CLI_BIN not set -- nothing to press against.');
    process.exit(1);
  }
  if (!config.raw.LEDGER_FUNDING_ADDRESS) {
    console.error('LEDGER_FUNDING_ADDRESS not set -- no earmarked destination configured.');
    process.exit(1);
  }

  console.error('--- step 1: wallet-cli account discover (opens the Ethereum app if needed) ---');
  const discovered = await discoverSepoliaAccounts(config);
  console.error(JSON.stringify(discovered, null, 2));
  if (!('ok' in discovered) || !discovered.ok) {
    console.error('discovery failed -- is the device connected and unlocked?');
    process.exit(1);
  }

  const account = (discovered.data as { accounts: { label: string }[] }).accounts[0]?.label;
  console.error('\n--- step 2: balances (read-only) ---');
  console.error(JSON.stringify(await getBalances(config, account), null, 2));

  console.error('\n--- step 3: authorize a 0.001 ETH treasury movement ---');
  const started = await requestReplenishment({ config }, { amountEth: '0.001' });
  console.error(JSON.stringify(started, null, 2));
  if (!('denied' in started) || started.reason !== 'awaiting_device') {
    console.error('unexpected result starting the replenishment -- see above');
    process.exit(1);
  }

  console.error('\n>>> PRESS THE BUTTON ON YOUR LEDGER NOW to approve the transaction. <<<\n');

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = reportPending();
    const txHash = 'ok' in status && status.ok ? (status.data as { sepoliaTxHash?: string }).sepoliaTxHash : undefined;
    if (txHash && 'ok' in status && status.ok) {
      console.error('\n--- confirmed ---');
      console.error(JSON.stringify(status.data, null, 2));
      console.error(`https://sepolia.etherscan.io/tx/${txHash}`);
      return;
    }
    if ('denied' in status && status.reason === 'awaiting_device' && !status.detail.includes('still waiting')) {
      // The pending record was cleared (rejected/error) between polls.
      console.error('\n--- did not confirm ---');
      console.error(JSON.stringify(status, null, 2));
      process.exit(1);
    }
    await sleep(POLL_MS);
  }
  console.error('\ntimed out waiting for a device press (3 minutes) -- run again when ready.');
  process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeOperatorClient); // see layers/policy/hedera.ts -- its cached gRPC channel pool otherwise holds this script's event loop open
