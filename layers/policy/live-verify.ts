// Standalone, re-runnable live-verify script for ticket #3. Run with
// `DRY_RUN=0 npx tsx layers/policy/live-verify.ts` from float-mcp/.
//
// Does, in order, against Hedera testnet:
//   1. Completes the hollow operator account (no-op if already keyed).
//   2. Bootstraps the treasury account and the audit topic (idempotent).
//   3. Grants a child a budget -> real HTS allowance + HCS grant message.
//   4. Attempts an over-ceiling spend -> ceiling_exceeded denial + HCS
//      denial message.
//   5. Attempts an over-hierarchy grant to a second child -> refused at
//      grant time, before touching the chain.
// Prints every id it touches; never prints a private key.

import { loadConfig } from '../../src/config.js';
import { ensureOperatorKeyRecorded, fetchMirrorAccount } from './hedera.js';
import { grantBudget, spend } from './engine.js';
import { getState } from './bootstrap.js';

async function main() {
  const config = loadConfig();
  if (config.dryRun) {
    console.error('DRY_RUN is on — set DRY_RUN=0 to run this against real testnet.');
    process.exit(1);
  }

  console.error('--- step 1: hollow operator account ---');
  const opId = config.raw.HEDERA_OPERATOR_ID!;
  const before = await fetchMirrorAccount(opId);
  console.error(`operator ${opId} mirror-node key present before: ${before.hasKey}`);
  const fix = await ensureOperatorKeyRecorded(config);
  console.error(`ensureOperatorKeyRecorded: ${JSON.stringify(fix)}`);
  const after = await fetchMirrorAccount(opId);
  console.error(`operator ${opId} mirror-node key present after: ${after.hasKey}`);
  if (!after.hasKey) throw new Error('operator account still hollow after fix attempt');

  console.error('\n--- step 2: grant a budget (bootstraps treasury + topic + child account) ---');
  const grant = await grantBudget(config, { childId: 'demo-child-1', ceiling: '3', scope: 'lending' });
  console.error('grant result:', JSON.stringify(grant, null, 2));

  const state = getState();
  console.error(`\ntreasury: ${state.treasury?.accountId}`);
  console.error(`topic: ${state.topicId}`);
  console.error(`demo-child-1 account: ${state.agents['demo-child-1']?.accountId}`);

  console.error('\n--- step 3: over-ceiling spend must be denied and logged ---');
  const overspend = await spend(config, {
    agentId: 'demo-child-1',
    amountHbar: 5,
    service: 'counterparty_risk',
    toAccountId: opId,
  });
  console.error('overspend result:', JSON.stringify(overspend, null, 2));
  if (!('denied' in overspend) || overspend.reason !== 'ceiling_exceeded') {
    throw new Error('expected overspend to be denied with ceiling_exceeded');
  }

  console.error('\n--- step 4: within-ceiling spend should succeed on-chain ---');
  const goodSpend = await spend(config, {
    agentId: 'demo-child-1',
    amountHbar: 1,
    service: 'counterparty_risk',
    toAccountId: opId,
  });
  console.error('spend result:', JSON.stringify(goodSpend, null, 2));

  console.error('\n--- step 5: hierarchy violation refused at grant time ---');
  const hierarchyViolation = await grantBudget(config, {
    childId: 'demo-child-2',
    ceiling: '999',
    scope: 'lending',
  });
  console.error('hierarchy violation result:', JSON.stringify(hierarchyViolation, null, 2));
  if (!('denied' in hierarchyViolation) || hierarchyViolation.reason !== 'ceiling_exceeded') {
    throw new Error('expected hierarchy violation to be denied with ceiling_exceeded');
  }

  console.error('\nlive-verify: ALL STEPS PASSED');
}

main().catch((err) => {
  console.error('live-verify FAILED:', err);
  process.exit(1);
});
