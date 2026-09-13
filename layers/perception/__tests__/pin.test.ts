import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pinAll, writeLockfile, readLockfile, getPinned, type Lockfile } from '../pin.js';
import { listAllSubgraphs } from '../registry.js';
import { fixtureFetch, loadFixture } from './fixtures.js';

// Real recorded responses: aave-v3-ethereum is live+populated, aave-v3-base
// is genuinely dead (`_meta` itself fails), aave-v3-optimism resolves `_meta`
// fine but its markets probe returns zero rows (the exact bug #10 fixes),
// aave-v3-polygon is live+populated (the new demo-core member).
const FIXTURES = {
  JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk: {
    meta: loadFixture('meta.aave-v3-ethereum.json'),
    probe: loadFixture('markets.aave-v3-ethereum.json'),
  },
  D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9: {
    meta: loadFixture('meta.aave-v3-base.json'), // real dead entry
  },
  '3RWFxWNstn4nP3dXiDfKi9GgBoHx7xzc7APkXs1MLEgi': {
    meta: loadFixture('meta.aave-v3-optimism.json'),
    probe: loadFixture('probe.aave-v3-optimism.json'), // real empty entry
  },
  '6yuf1C49aWEscgk5n9D1DekeG1BCk5Z9imJYJT3sVmAT': {
    meta: loadFixture('meta.aave-v3-polygon.json'),
    probe: loadFixture('probe.aave-v3-polygon.json'),
  },
};

describe('pinAll', () => {
  it('classifies every registered subgraph as live, empty or dead, never dropping one', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fixtureFetch(FIXTURES), concurrency: 8 });
    const totalEntries = listAllSubgraphs().length;
    expect(lockfile.totalDeployments).toBe(totalEntries);
    expect(lockfile.liveCount + lockfile.emptyCount + lockfile.deadCount).toBe(totalEntries);
    expect(Object.keys(lockfile.deployments)).toHaveLength(totalEntries);
  });

  it('pins the real recorded deployment ID for a live core deployment', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fixtureFetch(FIXTURES) });
    const pinned = getPinned(lockfile, 'aave-v3-ethereum');
    expect(pinned).not.toBeNull();
    expect(pinned?.deploymentId).toBe('QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd');
  });

  it('reports the real dead aave-v3-base deployment instead of silently dropping it', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fixtureFetch(FIXTURES) });
    expect(getPinned(lockfile, 'aave-v3-base')).toBeNull();
    const entry = lockfile.deployments['aave-v3-base'];
    expect(entry.status).toBe('dead');
    if (entry.status === 'dead') expect(entry.error).toBe('subgraph not found: no allocations');
  });

  it('classifies aave-v3-optimism as empty, not live — it resolves _meta but returns zero markets', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fixtureFetch(FIXTURES) });
    expect(getPinned(lockfile, 'aave-v3-optimism')).toBeNull();
    const entry = lockfile.deployments['aave-v3-optimism'];
    expect(entry.status).toBe('empty');
    if (entry.status === 'empty') {
      expect(entry.deploymentId).toBe('QmSJ9orPipkLpMYz8Qk1gRAyYzvFSJWG7Vw9dx5YYopvt1');
      expect(entry.reason).toBe('markets query returned zero rows');
    }
  });

  it('classifies aave-v3-polygon as live — populated markets probe', async () => {
    const lockfile = await pinAll({ apiKey: 'k', fetchImpl: fixtureFetch(FIXTURES) });
    const pinned = getPinned(lockfile, 'aave-v3-polygon');
    expect(pinned).not.toBeNull();
    expect(pinned?.deploymentId).toBe('QmZvndp7kSUaMZo3W21bLyggU8wpcYG5LXBbGvu21t4cvD');
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
    const lockfile: Lockfile = await pinAll({ apiKey: 'k', fetchImpl: fixtureFetch(FIXTURES) });
    writeLockfile(lockfile, filePath);
    const read = readLockfile(filePath);
    expect(read).toEqual(lockfile);
  });

  it('returns null for a missing lockfile rather than throwing', () => {
    expect(readLockfile(path.join(tmpdir(), 'does-not-exist-lockfile.json'))).toBeNull();
  });
});
