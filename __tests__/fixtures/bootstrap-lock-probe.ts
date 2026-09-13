// Standalone probe run as a REAL separate process by
// state-lock-race.test.ts (#21). Simulates bootstrap's own
// read-decide-mint-save pattern without touching Hedera at all: `withStateLock`
// is exactly the primitive `ensureTreasury` uses, so proving two of these
// processes can't both "mint" proves the fix at the level the incident
// actually happened — two different OS processes racing on one shared file
// — rather than asserting a code-review conclusion about a single process.
import { withStateLock, acquireLiveRunLock, stateFilePathForDebug } from '../../layers/policy/state.js';
import { LockHeldError } from '../../layers/policy/lock.js';

const [, , mode, mintDelayMs] = process.argv;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStateLockMode(): Promise<void> {
  const result = await withStateLock('probe-mint', async (state) => {
    if (state.treasury) {
      return { save: null, result: { minted: false, accountId: state.treasury.accountId } };
    }
    // The exact window that used to be unguarded: a slow "mint" between the
    // read and the write. Any second process that reads state WHILE this
    // sleep is in flight is the bug this ticket fixes.
    await sleep(Number(mintDelayMs));
    const treasury = { accountId: `0.0.minted-by-pid-${process.pid}`, privateKey: `key-${process.pid}` };
    return { save: { ...state, treasury }, result: { minted: true, accountId: treasury.accountId } };
  });
  process.stdout.write(JSON.stringify({ path: stateFilePathForDebug(), ...result }));
}

async function runLiveLockMode(): Promise<void> {
  try {
    const release = acquireLiveRunLock('probe live flow');
    await sleep(Number(mintDelayMs));
    release();
    process.stdout.write(JSON.stringify({ acquired: true }));
  } catch (err) {
    if (err instanceof LockHeldError) {
      process.stdout.write(JSON.stringify({ acquired: false, holderPid: err.holder.pid }));
      return;
    }
    throw err;
  }
}

if (mode === 'state-lock') await runStateLockMode();
else if (mode === 'live-lock') await runLiveLockMode();
else throw new Error(`unknown probe mode "${mode}"`);
