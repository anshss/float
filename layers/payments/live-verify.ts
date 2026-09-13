// Standalone, re-runnable live-verify script for ticket #4. Run with
// `npm run demo:pay-live-verify` (equivalent to
// `DRY_RUN=0 npx tsx --env-file=.env layers/payments/live-verify.ts`) from
// float-mcp/. Requires HEDERA_TOPIC_ID set to the live audit topic (#3) —
// reuses it rather than minting a new one.
//
// Does, in order, against Hedera testnet + the real Blocky402 facilitator:
//   1. Starts the gated resource server in-process (seller side).
//   2. pay() against it: 402 -> policy check -> real settlement -> retry ->
//      200. Prints the settlement tx id.
//   3. Reads spend_history back for agent_id "root" and confirms the tx
//      from step 2 is present — proving the receipt round-trips through
//      Mirror Node, not just that pay() claims success.
//   4. Sets FLOAT_ROOT_CEILING_HBAR to something already exceeded and
//      attempts a second pay() — must be denied WITHOUT any facilitator
//      call (asserted via a wrapped fetch that throws if the gated URL is
//      hit a second time).

import { loadConfig } from '../../src/config.js';
import { InMemorySignalStore } from '../../src/contracts.js';
import { InMemorySignalDigestStore } from '../perception/signalDigest.js';
import { spendHistory } from '../perception/tools.js';
import { startResourceServer } from './resourceServer.js';
import { pay } from './pay.js';

async function main() {
  const config = loadConfig();
  if (config.dryRun) {
    console.error('DRY_RUN is on — set DRY_RUN=0 to run this against real testnet.');
    process.exit(1);
  }
  if (!config.raw.HEDERA_TOPIC_ID) {
    console.error('HEDERA_TOPIC_ID not set — point it at the live audit topic (#3) before running.');
    process.exit(1);
  }

  const signalStore = new InMemorySignalStore();
  const digestStore = new InMemorySignalDigestStore();

  console.error('--- step 1: start gated resource server (seller side) ---');
  const server = startResourceServer({ config, signalStore, digestStore }, 0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/premium/counterparty-risk/0.0.10523774`;
  console.error(`gated endpoint: ${url}`);

  try {
    console.error('\n--- step 2: pay() — 402 -> policy check -> pay -> retry -> 200 ---');
    const result = await pay({ url, max: '1' }, { config, signalStore, digestStore });
    console.error('pay() result:', JSON.stringify(result, null, 2));
    if (!('ok' in result) || !result.ok) throw new Error('expected pay() to succeed');
    const tx = (result.data as { tx: string }).tx;

    console.error('\n--- step 3: read the receipt back via spend_history ---');
    // Mirror node lags consensus by a few seconds.
    let found = false;
    for (let attempt = 0; attempt < 6 && !found; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const history = await spendHistory({ agent_id: 'root' }, { config, signalStore, digestStore });
      if (!('ok' in history) || !history.ok) throw new Error('spend_history denied: ' + JSON.stringify(history));
      const entries = (history.data as { entries: Array<{ tx?: string }> }).entries;
      found = entries.some((e) => e.tx === tx);
      console.error(`  attempt ${attempt + 1}: ${entries.length} entries, tx present: ${found}`);
    }
    if (!found) throw new Error(`receipt for tx ${tx} never appeared in spend_history`);

    console.error('\n--- step 4: over-budget pay() must be denied WITHOUT paying ---');
    const originalCeiling = process.env.FLOAT_ROOT_CEILING_HBAR;
    process.env.FLOAT_ROOT_CEILING_HBAR = '0.00000001'; // already exceeded by step 2's spend
    let facilitatorCalledAgain = false;
    const guardedFetch: typeof fetch = async (input, init) => {
      const s = input.toString();
      if (s === url) facilitatorCalledAgain = facilitatorCalledAgain || !!init?.headers;
      return fetch(input, init);
    };
    const overBudget = await pay({ url, max: '1' }, { config, signalStore, digestStore, fetchImpl: guardedFetch });
    if (originalCeiling === undefined) delete process.env.FLOAT_ROOT_CEILING_HBAR;
    else process.env.FLOAT_ROOT_CEILING_HBAR = originalCeiling;
    console.error('over-budget pay() result:', JSON.stringify(overBudget, null, 2));
    if (!('denied' in overBudget) || overBudget.reason !== 'ceiling_exceeded') {
      throw new Error('expected over-budget pay() to be denied with ceiling_exceeded');
    }
    if (facilitatorCalledAgain) throw new Error('over-budget pay() sent a payment — it must deny without paying');

    console.error('\nlive-verify: ALL STEPS PASSED');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('live-verify FAILED:', err);
  process.exit(1);
});
