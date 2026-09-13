#!/usr/bin/env node
// `npm run pin` — the ONLY thing that writes deployments.lock.json. Explicit,
// logged, never run automatically at server startup. Serving unpinned data is
// refused (`deployment_unavailable`) until this has been run at least once.

import { pinAll, writeLockfile, LOCKFILE_PATH } from '../layers/perception/pin.js';

async function main() {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    console.error('pin: GRAPH_API_KEY is not set — cannot resolve deployment IDs');
    process.exit(1);
  }

  console.log('pin: resolving deployment IDs for every registered subgraph...');
  const lockfile = await pinAll({ apiKey });
  writeLockfile(lockfile);

  console.log(
    `pin: wrote ${LOCKFILE_PATH} — ${lockfile.liveCount}/${lockfile.totalDeployments} deployments live, ${lockfile.emptyCount} empty, ${lockfile.deadCount} dead`,
  );
  const empty = Object.values(lockfile.deployments).filter((d) => d.status === 'empty');
  if (empty.length > 0) {
    console.log('pin: empty deployments — resolve fine but return zero rows (reported, not dropped, never counted as live):');
    for (const d of empty) {
      console.log(`  - ${d.slug} (${d.network}): ${d.reason}`);
    }
  }
  const dead = Object.values(lockfile.deployments).filter((d) => d.status === 'dead');
  if (dead.length > 0) {
    console.log('pin: dead deployments (reported, not dropped):');
    for (const d of dead) {
      console.log(`  - ${d.slug} (${d.network}): ${d.error}`);
    }
  }
}

main().catch((err) => {
  console.error('pin: fatal error', err);
  process.exit(1);
});
