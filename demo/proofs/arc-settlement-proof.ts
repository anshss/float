#!/usr/bin/env node
// Rail proof for C5 (ticket #6) -- re-runnable, kept per the spec's rail-proof
// rule. Settles R6: does Privy's policy engine evaluate on a chain Privy
// doesn't natively list (Arc, defined here purely via `defineChain`)? Privy's
// docs take no position either way; this script is the only evidence.
//
// Two phases, both idempotent:
//   1. Provision (only runs while PRIVY_WALLET_ID is unset): creates a policy
//      with a per-transaction USDC cap mirroring FLOAT_CAP_DEFAULT_USD, then a
//      Privy server wallet owned by the 1-of-1 key quorum and gated by that
//      policy. Prints the wallet id/address (never key material) and stops --
//      the operator must fund the address via https://faucet.circle.com and
//      paste PRIVY_WALLET_ID/PRIVY_WALLET_ADDRESS into .env before phase 2.
//   2. Proof: exercises transferUsdc() through the exact same code path
//      src/server.ts calls, live against Arc testnet and Privy's real API --
//      no signal_ref cited, over-cap, over-float, and (once funded) a real
//      landed transfer with an arcscan link.
//
// Usage: npm run proof:arc (see package.json). Never run in CI -- it moves
// real (test) funds and depends on live Privy/Arc state.

import { writeFileSync } from 'node:fs';
import { formatUnits, parseUnits } from 'viem';
import { createPublicClient, http } from 'viem';
import { loadConfig } from '../../src/config.js';
import { InMemorySignalStore } from '../../src/contracts.js';
import { InMemorySignalDigestStore, digestResult } from '../../layers/perception/signalDigest.js';
import { transferUsdc } from '../../layers/settlement/transferUsdc.js';
import { buildPrivyClient } from '../../layers/settlement/privyClient.js';
import { ARC_TESTNET } from '../../layers/settlement/arcChain.js';

const OUTPUT_PATH = new URL('./arc-settlement-proof.output.md', import.meta.url);

type LogLine = string;
const lines: LogLine[] = [];
function log(line: string) {
  console.log(line);
  lines.push(line);
}

async function provision(config: ReturnType<typeof loadConfig>) {
  if (!config.raw.PRIVY_KEY_QUORUM_ID) {
    console.error('provision: PRIVY_KEY_QUORUM_ID is not set -- cannot provision a wallet');
    process.exit(1);
  }
  const privy = buildPrivyClient(config);
  const capUsd = config.caps.defaultUsd;
  const capWei = parseUnits(String(capUsd), 18).toString();

  log(`provision: creating a policy capping eth_sendTransaction value at ${capUsd} USDC (${capWei} wei, native)...`);
  const policy = await privy.policies().create({
    version: '1.0',
    name: `float-arc-cap-${capUsd}usd`,
    chain_type: 'ethereum',
    owner_id: config.raw.PRIVY_KEY_QUORUM_ID,
    rules: [
      {
        name: 'allow-under-cap',
        method: 'eth_sendTransaction',
        action: 'ALLOW',
        conditions: [{ field_source: 'ethereum_transaction', field: 'value', operator: 'lte', value: capWei }],
      },
      {
        name: 'deny-over-cap',
        method: 'eth_sendTransaction',
        action: 'DENY',
        conditions: [{ field_source: 'ethereum_transaction', field: 'value', operator: 'gt', value: capWei }],
      },
    ],
  });
  log(`provision: policy ${policy.id} created`);

  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    display_name: 'float-arc-settlement',
    owner_id: config.raw.PRIVY_KEY_QUORUM_ID,
    policy_ids: [policy.id],
  });
  log(`provision: wallet ${wallet.id} created at address ${wallet.address}`);
  log('');
  log('Next: fund this address via https://faucet.circle.com, then add to .env:');
  log(`  PRIVY_WALLET_ID=${wallet.id}`);
  log(`  PRIVY_WALLET_ADDRESS=${wallet.address}`);
  log('Then re-run this script to execute the rail proof.');
}

async function proof(config: ReturnType<typeof loadConfig>) {
  const signalStore = new InMemorySignalStore();
  const digestStore = new InMemorySignalDigestStore();
  const signal = signalStore.put({
    tool: 'compare_markets',
    deploymentId: 'demo-core-rail-proof',
    queriedAt: new Date().toISOString(),
  });
  digestStore.put(signal.id, digestResult({ rankedRates: [{ rate: 0.041 }] }, [{ rate: 0.041 }]));

  const deps = { config, signalStore, digestStore };
  const address = config.raw.PRIVY_WALLET_ADDRESS as `0x${string}`;

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const balance = await publicClient.getBalance({ address });
  log(`proof: wallet ${address} balance = ${formatUnits(balance, 18)} USDC`);

  log('');
  log('--- 1. no_signal_cited (uncited transfer) ---');
  const uncited = await transferUsdc({ to: address, amount: '0.01', signal_ref: 'sig_never_existed' }, deps);
  log(JSON.stringify(uncited));

  const capUsd = config.caps.defaultUsd;
  const overCapAmount = String(capUsd + 1);

  if (balance === 0n) {
    log('');
    log(`proof: balance is 0 -- fund ${address} via https://faucet.circle.com to run the funded checks.`);
    log('--- 2. awaiting_device (over-float; 0 balance means everything over-floats) ---');
    const overFloat = await transferUsdc({ to: address, amount: '0.01', signal_ref: signal.id }, deps);
    log(JSON.stringify(overFloat));
    log('proof: over-cap and successful-transfer checks require funding -- stopping here.');
    return;
  }

  log('');
  log(`--- 2. provider_policy_denied (over-cap: ${overCapAmount} USDC > ${capUsd} USDC cap) ---`);
  if (balance < parseUnits(overCapAmount, 18)) {
    log(`proof: balance too low to reach the over-cap check (need > ${overCapAmount} USDC) -- fund more and re-run.`);
  } else {
    const overCap = await transferUsdc({ to: address, amount: overCapAmount, signal_ref: signal.id }, deps);
    log(JSON.stringify(overCap));
  }

  log('');
  log('--- 3. real settlement (signal-cited, in-cap, in-float) ---');
  const settled = await transferUsdc({ to: address, amount: '0.01', signal_ref: signal.id }, deps);
  log(JSON.stringify(settled));

  log('');
  log('--- 4. awaiting_device (over-float: requesting more than current balance) ---');
  const postBalance = await publicClient.getBalance({ address });
  const overFloatAmount = formatUnits(postBalance + parseUnits('1', 18), 18);
  const overFloat = await transferUsdc({ to: address, amount: overFloatAmount, signal_ref: signal.id }, deps);
  log(JSON.stringify(overFloat));
}

async function main() {
  const config = loadConfig();
  if (!config.raw.PRIVY_APP_ID || !config.raw.PRIVY_APP_SECRET || !config.raw.PRIVY_AUTHORIZATION_KEY) {
    console.error('arc-settlement-proof: PRIVY_APP_ID/PRIVY_APP_SECRET/PRIVY_AUTHORIZATION_KEY must be set');
    process.exit(1);
  }

  if (!config.raw.PRIVY_WALLET_ID || !config.raw.PRIVY_WALLET_ADDRESS) {
    await provision(config);
  } else {
    await proof(config);
  }

  writeFileSync(
    OUTPUT_PATH,
    `# Arc settlement rail proof -- recorded ${new Date().toISOString()}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`,
  );
  console.log(`\narc-settlement-proof: recorded output to ${OUTPUT_PATH.pathname}`);
}

main().catch((err) => {
  console.error('arc-settlement-proof: fatal error', err);
  process.exit(1);
});
