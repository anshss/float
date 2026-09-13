// Startup lockfile verification. Refuses to let `float_status` (and, by
// extension, any perception tool) claim pinned data exists unless
// layers/perception/deployments.lock.json is actually present and parses —
// the lockfile is the provenance artifact judges see, never assumed good.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { LOCKFILE_PATH, type Lockfile } from '../layers/perception/pin.js';

export type LockfileStatus = {
  verified: boolean;
  hash: string | null;
  detail: string;
};

export function verifyLockfile(filePath: string = LOCKFILE_PATH): LockfileStatus {
  if (!existsSync(filePath)) {
    return {
      verified: false,
      hash: null,
      detail: 'deployments.lock.json not found — run `npm run pin` (requires GRAPH_API_KEY)',
    };
  }

  const raw = readFileSync(filePath, 'utf-8');
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);

  try {
    const parsed = JSON.parse(raw) as Lockfile;
    return {
      verified: true,
      hash,
      detail: `${parsed.liveCount}/${parsed.totalDeployments} deployments live, pinned at ${parsed.pinnedAt}`,
    };
  } catch {
    return { verified: false, hash, detail: 'deployments.lock.json is not valid JSON' };
  }
}
