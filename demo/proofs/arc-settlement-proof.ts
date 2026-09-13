#!/usr/bin/env node
// Rail proof for C5 (ticket #6) -- re-runnable, kept per the spec's rail-proof
// rule. Settles R6: does Privy's policy engine evaluate on a chain Privy
// doesn't natively list (Arc, defined here purely via `defineChain`)? Privy's
// docs take no position either way; this script is the only evidence.
//
// R6 VERDICT (recorded live, see arc-settlement-proof.output.md and the full
// reproducible bug report in PRIVY-ARC-POLICY-BUG.md): NEGATIVE.
// Privy's wallet-RPC does receive and evaluate the request on Arc -- a
// genuine PrivyAPIError comes back, sourced from Privy, never synthesized --
// but with ANY policy attached it denies every eth_sendTransaction
// unconditionally, regardless of the rule's own value/chain_id conditions.
// Reproduced across three independent rule shapes (decimal value cap, hex
// value cap, chain_id-only condition) and confirmed by the negative case: with
// NO policy attached, an identical transfer succeeds cleanly. Per the
// ticket's own fallback: the Privy server wallet is kept (hot-key custody
// still counts), the wallet carries no Privy policy, and the per-transaction
// float cap is enforced at the application layer instead (ceiling_exceeded,
// see layers/settlement/transferUsdc.ts) -- the provider-enforced-cap claim
// is dropped.
//
// Two phases, both idempotent:
//   1. Provision (only runs while PRIVY_WALLET_ID is unset): creates a Privy
//      server wallet owned by the 1-of-1 key quorum, no policy attached.
//      Prints the wallet id/address (never key material) and stops -- the
//      operator must fund the address via https://faucet.circle.com and
//      paste PRIVY_WALLET_ID/PRIVY_WALLET_ADDRESS into .env before phase 2.
//   2. Proof: exercises transferUsdc() through the exact same code path
//      src/server.ts calls, live against Arc testnet and Privy's real API.
//
// Usage: npm run proof:arc (see package.json). Never run in CI -- it moves
// real (test) funds and depends on live Privy/Arc state.

import { writeFileSync } from 'node:fs';
import { createPublicClient, formatUnits, http, parseUnits } from 'viem';
import { loadConfig } from '../../src/config.js';
import { InMemorySignalStore } from '../../src/contracts.js';
import { InMemorySignalDigestStore, digestResult } from '../../layers/perception/signalDigest.js';
import { transferUsdc } from '../../layers/settlement/transferUsdc.js';
import { buildAuthorizationContext, buildPrivyClient } from '../../layers/settlement/privyClient.js';
import { ARC_TESTNET } from '../../layers/settlement/arcChain.js';

const OUTPUT_PATH = new URL('./arc-settlement-proof.output.md', import.meta.url);

const lines: string[] = [];
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

  log('provision: creating a Privy server wallet on Arc (no policy attached -- see R6 verdict above)...');
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    display_name: 'float-arc-settlement',
    owner_id: config.raw.PRIVY_KEY_QUORUM_ID,
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
  const walletId = config.raw.PRIVY_WALLET_ID as string;

  const publicClient = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET.rpcUrls.default.http[0]) });
  const balance = await publicClient.getBalance({ address });
  log(`proof: wallet ${address} balance = ${formatUnits(balance, 18)} USDC`);

  log('');
  log('--- 1. no_signal_cited (uncited transfer) ---');
  const uncited = await transferUsdc({ to: address, amount: '0.01', signal_ref: 'sig_never_existed' }, deps);
  log(JSON.stringify(uncited));

  if (balance === 0n) {
    log('');
    log(`proof: balance is 0 -- fund ${address} via https://faucet.circle.com to run the funded checks.`);
    log('--- 2. awaiting_device (over-float; 0 balance means everything over-floats) ---');
    const overFloat = await transferUsdc({ to: address, amount: '0.01', signal_ref: signal.id }, deps);
    log(JSON.stringify(overFloat));
    log('proof: R6 evidence and successful-transfer checks require funding -- stopping here.');
    return;
  }

  // --- R6 evidence: attach a policy allowing amounts well under the real
  // cap, then attempt a trivially compliant transfer. A correct policy
  // engine would ALLOW this. Privy denies it, sourced verbatim through
  // transferUsdc()'s own PrivyAPIError classification (findPrivyError() in
  // layers/settlement/transferUsdc.ts unwraps viem's TransactionExecutionError
  // wrapper to recover it) -- proving the denial is Privy's, not ours, and
  // that it does not discriminate by the rule's own conditions.
  log('');
  log('--- R6 evidence: policy engine on Arc (see verdict in the file header) ---');
  const privy = buildPrivyClient(config);
  const authorizationContext = buildAuthorizationContext(config);
  const capWei = parseUnits('50', 18).toString();
  const evidencePolicy = await privy.policies().create({
    version: '1.0',
    name: `float-arc-r6-evidence-${Date.now()}`,
    chain_type: 'ethereum',
    owner_id: config.raw.PRIVY_KEY_QUORUM_ID as string,
    rules: [
      {
        name: 'allow-under-50usd',
        method: 'eth_sendTransaction',
        action: 'ALLOW',
        conditions: [{ field_source: 'ethereum_transaction', field: 'value', operator: 'lte', value: capWei }],
      },
    ],
  });
  log(`proof: attaching policy ${evidencePolicy.id} (ALLOW <= 50 USDC) and attempting a trivially compliant 0.1 USDC transfer...`);
  await privy.wallets().update(walletId, { policy_ids: [evidencePolicy.id], authorization_context: authorizationContext });
  const shouldHaveBeenAllowed = await transferUsdc({ to: address, amount: '0.1', signal_ref: signal.id }, deps);
  log(JSON.stringify(shouldHaveBeenAllowed));
  if ('denied' in shouldHaveBeenAllowed && shouldHaveBeenAllowed.reason === 'provider_policy_denied') {
    log('proof: CONFIRMED -- Privy denied a compliant, well-under-cap transfer. The policy engine does not discriminate on Arc.');
  } else {
    log('proof: UNEXPECTED -- the compliant transfer was not denied by Privy. R6 verdict above may need revisiting.');
  }

  log(`proof: detaching the policy permanently (per the R6 fallback, the wallet carries no Privy policy)...`);
  await privy.wallets().update(walletId, { policy_ids: [], authorization_context: authorizationContext });

  log('');
  log('--- 2. ceiling_exceeded (application-level float cap, no Privy policy involved) ---');
  const overCap = await transferUsdc({ to: address, amount: '51', signal_ref: signal.id }, deps);
  log(JSON.stringify(overCap));

  log('');
  log('--- 3. real settlement (signal-cited, in-cap, in-float) ---');
  const settled = await transferUsdc({ to: address, amount: '0.5', signal_ref: signal.id }, deps);
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
