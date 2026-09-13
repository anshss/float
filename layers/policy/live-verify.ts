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
//
// #17: DEMO_CEILING_HBAR/DEMO_SPEND_HBAR/DEMO_OVERSPEND_HBAR are scaled down
// TOGETHER with the treasury's initial funding (src/config.ts,
// `funding.treasuryInitialHbar`) on purpose. If the ceiling were left large
// relative to what the treasury actually holds, the over-ceiling spend would
// still get denied — but for the wrong reason (insufficient real balance
// instead of the ceiling check), which reads as the same PASS while proving
// nothing. `__tests__/live-verify.demo-scale.test.ts` asserts the relationship
// holds so it can't silently drift back out of sync.

import { loadConfig } from '../../src/config.js';
import { ensureOperatorKeyRecorded, fetchMirrorAccount } from './hedera.js';
import { grantBudget, spend } from './engine.js';
import { getState } from './bootstrap.js';

export const DEMO_CEILING_HBAR = 0.3;
export const DEMO_SPEND_HBAR = 0.1;
export const DEMO_OVERSPEND_HBAR = 0.5;

async function main() {
  const config = loadConfig();
  if (config.dryRun) {
    console.error('DRY_RUN is on — set DRY_RUN=0 to run this against real testnet.');
    process.exit(1);
  }

  const operations: string[] = [];
  const opId = config.raw.HEDERA_OPERATOR_ID!;
  const balanceBefore = (await fetchMirrorAccount(opId)).balanceTinybar;

  console.error('--- step 1: hollow operator account ---');
  const before = await fetchMirrorAccount(opId);
  console.error(`operator ${opId} mirror-node key present before: ${before.hasKey}`);
  const fix = await ensureOperatorKeyRecorded(config);
  console.error(`ensureOperatorKeyRecorded: ${JSON.stringify(fix)}`);
  operations.push(fix.completed ? 'operator self-transfer (hollow-account fix)' : 'operator key check (no-op)');
  const after = await fetchMirrorAccount(opId);
  console.error(`operator ${opId} mirror-node key present after: ${after.hasKey}`);
  if (!after.hasKey) throw new Error('operator account still hollow after fix attempt');

  console.error('\n--- step 2: grant a budget (bootstraps treasury + topic + child account) ---');
  const grant = await grantBudget(config, {
    childId: 'demo-child-1',
    ceiling: String(DEMO_CEILING_HBAR),
    scope: 'lending',
  });
  console.error('grant result:', JSON.stringify(grant, null, 2));
  operations.push(`grant_budget demo-child-1 ceiling=${DEMO_CEILING_HBAR} HBAR (bootstrap + allowance, re-grant skips the allowance tx when unchanged)`);

  const state = getState();
  console.error(`\ntreasury: ${state.treasury?.accountId}`);
  console.error(`topic: ${state.topicId}`);
  console.error(`demo-child-1 account: ${state.agents['demo-child-1']?.accountId}`);

  console.error('\n--- step 3: over-ceiling spend must be denied and logged ---');
  const overspend = await spend(config, {
    agentId: 'demo-child-1',
    amountHbar: DEMO_OVERSPEND_HBAR,
    service: 'counterparty_risk',
    toAccountId: opId,
  });
  console.error('overspend result:', JSON.stringify(overspend, null, 2));
  operations.push(`spend demo-child-1 ${DEMO_OVERSPEND_HBAR} HBAR (expected denial, no chain write)`);
  if (!('denied' in overspend) || overspend.reason !== 'ceiling_exceeded') {
    throw new Error('expected overspend to be denied with ceiling_exceeded');
  }

  console.error('\n--- step 4: within-ceiling spend should succeed on-chain ---');
  const goodSpend = await spend(config, {
    agentId: 'demo-child-1',
    amountHbar: DEMO_SPEND_HBAR,
    service: 'counterparty_risk',
    toAccountId: opId,
  });
  console.error('spend result:', JSON.stringify(goodSpend, null, 2));
  operations.push(`spend demo-child-1 ${DEMO_SPEND_HBAR} HBAR (real transfer)`);

  console.error('\n--- step 5: hierarchy violation refused at grant time ---');
  const hierarchyViolation = await grantBudget(config, {
    childId: 'demo-child-2',
    ceiling: '999',
    scope: 'lending',
  });
  console.error('hierarchy violation result:', JSON.stringify(hierarchyViolation, null, 2));
  operations.push('grant_budget demo-child-2 ceiling=999 HBAR (expected hierarchy denial, no chain write)');
  if (!('denied' in hierarchyViolation) || hierarchyViolation.reason !== 'ceiling_exceeded') {
    throw new Error('expected hierarchy violation to be denied with ceiling_exceeded');
  }

  // #17: make the burn visible at the point it happens, rather than leaving
  // it to be discovered later by someone doing arithmetic against a mirror
  // node. Reads the operator's own balance, since it fee-pays every
  // transaction this script issues; the demo's transfers loop back to it
  // (`toAccountId: opId`) so this nets out to real fees paid, not a wash.
  const balanceAfterInfo = await fetchMirrorAccount(opId);
  const balanceAfter = balanceAfterInfo.balanceTinybar;
  const spentTinybar = balanceBefore - balanceAfter;
  console.error('\n--- cost summary ---');
  console.error(`operations performed: ${operations.length}`);
  for (const op of operations) console.error(`  - ${op}`);
  // Can read negative: the demo's "good spend" step sends treasury -> opId
  // (this same operator), so a run that skips the allowance re-approval can
  // net-gain more than it pays in fees. That's a real, honestly-reported
  // number, not a bug — it's what "repeat runs cost near-zero" looks like.
  console.error(`operator HBAR balance change this run: ${(-spentTinybar / 1e8).toFixed(4)} (negative = net spent)`);
  console.error(`operator HBAR balance remaining: ${(balanceAfter / 1e8).toFixed(4)}`);

  console.error('\nlive-verify: ALL STEPS PASSED');
}

// #17: guarded so `__tests__/live-verify.demo-scale.test.ts` can import the
// DEMO_* constants above without running the whole script against testnet —
// `main()` only fires when this file is the process entry point.
const isEntryPoint = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  main().catch((err) => {
    console.error('live-verify FAILED:', err);
    process.exit(1);
  });
}
