// Standalone probe run as a child process by state-isolation.test.ts, one
// per simulated vitest worker (distinguished by VITEST_POOL_ID). Writes a
// value unique to this process, sleeps to overlap with the sibling probe,
// then reads state back and reports what it sees — if the two probes share
// a state file, the later writer's value clobbers the earlier reader's.
import { saveState, loadState, resetStateForTests, stateFilePathForDebug } from '../../layers/policy/state.js';

const [, , poolId, delayMs] = process.argv;

resetStateForTests();
const mine = { accountId: `0.0.probe-${poolId}`, privateKey: `key-${poolId}` };
saveState({ treasury: mine, topicId: null, agents: {}, policies: {} });

await new Promise((resolve) => setTimeout(resolve, Number(delayMs)));

const after = loadState();
process.stdout.write(
  JSON.stringify({
    poolId,
    path: stateFilePathForDebug(),
    treasuryAccountId: after.treasury?.accountId ?? null,
  }),
);
