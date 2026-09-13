import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pinAll, writeLockfile, readLockfile, getPinned, type Lockfile } from '../pin.js';
import { listAllSubgraphs } from '../registry.js';
import { loadFixture } from './fixtures.js';

const CORE_META: Record<string, unknown> = {
  JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk: loadFixture('meta.aave-v3-ethereum.json'),
  D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9: loadFixture('meta.aave-v3-base.json'), // real dead entry
  '4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf': loadFixture('meta.aave-v3-arbitrum.json'),
};

function fetchImplFor(meta: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request): Promise<Response> => {
    const urlStr = input.toString();
    const match = Object.entries(meta).find(([id]) => urlStr.includes(id));
    const body = match ? match[1] : { errors: [{ message: 'subgraph not found: no allocations' }] };
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}

describe('pinAll', () => {
  it('classifies every registered subgraph as live or dead, never dropping one', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fetchImplFor(CORE_META), concurrency: 8 });
    const totalEntries = listAllSubgraphs().length;
    expect(lockfile.totalDeployments).toBe(totalEntries);
    expect(lockfile.liveCount + lockfile.deadCount).toBe(totalEntries);
    expect(Object.keys(lockfile.deployments)).toHaveLength(totalEntries);
  });

  it('pins the real recorded deployment ID for a live core deployment', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fetchImplFor(CORE_META) });
    const pinned = getPinned(lockfile, 'aave-v3-ethereum');
    expect(pinned).not.toBeNull();
    expect(pinned?.deploymentId).toBe('QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd');
  });

  it('reports the real dead aave-v3-base deployment instead of silently dropping it', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fetchImplFor(CORE_META) });
    expect(getPinned(lockfile, 'aave-v3-base')).toBeNull();
    const entry = lockfile.deployments['aave-v3-base'];
    expect(entry.live).toBe(false);
    if (!entry.live) expect(entry.error).toBe('subgraph not found: no allocations');
  });
});

describe('lockfile read/write', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'float-lockfile-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips through disk', async () => {
    const filePath = path.join(dir, 'deployments.lock.json');
    const lockfile: Lockfile = await pinAll({ apiKey: 'k', fetchImpl: fetchImplFor(CORE_META) });
    writeLockfile(lockfile, filePath);
    const read = readLockfile(filePath);
    expect(read).toEqual(lockfile);
  });

  it('returns null for a missing lockfile rather than throwing', () => {
    expect(readLockfile(path.join(tmpdir(), 'does-not-exist-lockfile.json'))).toBeNull();
  });
});
