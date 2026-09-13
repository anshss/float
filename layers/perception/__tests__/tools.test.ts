import { describe, it, expect } from 'vitest';
import { compareMarkets, queryPosition, counterpartyRisk, spendHistory } from '../tools.js';
import { InMemorySignalStore } from '../../../src/contracts.js';
import { loadConfig } from '../../../src/config.js';
import { InMemorySignalDigestStore } from '../signalDigest.js';
import { findSubgraph } from '../registry.js';
import { fixtureFetch, loadFixture, isOk } from './fixtures.js';
import type { Lockfile } from '../pin.js';

const DEMO_CORE_LOCKFILE: Lockfile = {
  pinnedAt: '2026-09-13T00:00:00.000Z',
  totalDeployments: 5,
  liveCount: 4,
  deadCount: 1,
  deployments: {
    'aave-v3-ethereum': {
      slug: 'aave-v3-ethereum',
      network: 'MAINNET',
      subgraphId: findSubgraph('aave-v3-ethereum')!.subgraphId,
      schemaVersion: '3.1.0',
      live: true,
      deploymentId: 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd',
      blockNumber: 25968792,
    },
    'aave-v3-base': {
      slug: 'aave-v3-base',
      network: 'BASE',
      subgraphId: findSubgraph('aave-v3-base')!.subgraphId,
      schemaVersion: '3.1.0',
      live: false,
      error: 'subgraph not found: no allocations',
    },
    'aave-v3-arbitrum': {
      slug: 'aave-v3-arbitrum',
      network: 'ARBITRUM_ONE',
      subgraphId: findSubgraph('aave-v3-arbitrum')!.subgraphId,
      schemaVersion: '3.1.0',
      live: true,
      deploymentId: 'QmUGh2BNwmiLgd9r81pz7f1khe18fondJUSbsFHfKvhrvk',
      blockNumber: 504747867,
    },
    'compound-v3-ethereum': {
      slug: 'compound-v3-ethereum',
      network: 'MAINNET',
      subgraphId: findSubgraph('compound-v3-ethereum')!.subgraphId,
      schemaVersion: '3.1.0',
      live: true,
      deploymentId: 'QmNrQoow7pjM3biRnnhzeCaDYhuEbDyjKCpFeNv2oGXnuK',
      blockNumber: 25968793,
    },
    'compound-v3-arbitrum': {
      slug: 'compound-v3-arbitrum',
      network: 'ARBITRUM_ONE',
      subgraphId: findSubgraph('compound-v3-arbitrum')!.subgraphId,
      schemaVersion: '3.1.0',
      live: true,
      deploymentId: 'QmQURwBj3C9RRX3Th5MqTGehSSUcfnRgw3r8Sg2XWcjmjB',
      blockNumber: 504747863,
    },
  },
};

function makeDeps(overrides: Partial<Parameters<typeof compareMarkets>[1]> = {}) {
  return {
    config: loadConfig({ GRAPH_API_KEY: 'k' }),
    signalStore: new InMemorySignalStore(),
    digestStore: new InMemorySignalDigestStore(),
    readLockfileImpl: () => DEMO_CORE_LOCKFILE,
    ...overrides,
  };
}

// compare_markets fans across all five; only aave-v3-ethereum needs an
// `account` fixture wired here (query_position/counterparty_risk build their
// own narrower maps below, since both address queries hit the same endpoint).
const MARKETS_FIXTURES = {
  [findSubgraph('aave-v3-ethereum')!.subgraphId]: { markets: loadFixture('markets.aave-v3-ethereum.json') },
  [findSubgraph('aave-v3-base')!.subgraphId]: { meta: loadFixture('meta.aave-v3-base.json') },
  [findSubgraph('aave-v3-arbitrum')!.subgraphId]: { markets: loadFixture('markets.aave-v3-arbitrum.json') },
  [findSubgraph('compound-v3-ethereum')!.subgraphId]: { markets: loadFixture('markets.compound-v3-ethereum.json') },
  [findSubgraph('compound-v3-arbitrum')!.subgraphId]: { markets: loadFixture('markets.compound-v3-arbitrum.json') },
};

const POSITION_FIXTURES = {
  [findSubgraph('aave-v3-ethereum')!.subgraphId]: { account: loadFixture('account.query_position.json') },
};

const RISK_FIXTURES = {
  [findSubgraph('aave-v3-ethereum')!.subgraphId]: { account: loadFixture('account.counterparty_risk.json') },
  [findSubgraph('aave-v3-arbitrum')!.subgraphId]: { account: { data: { account: null } } },
  [findSubgraph('compound-v3-ethereum')!.subgraphId]: { account: { data: { account: null } } },
  [findSubgraph('compound-v3-arbitrum')!.subgraphId]: { account: { data: { account: null } } },
};

describe('compareMarkets', () => {
  it('denies without a configured GRAPH_API_KEY', async () => {
    const result = await compareMarkets({ schema_family: 'lending' }, makeDeps({ config: loadConfig({}) }));
    expect(result).toEqual({ denied: true, reason: 'deployment_unavailable', detail: 'GRAPH_API_KEY not configured' });
  });

  it('denies when no lockfile has ever been pinned', async () => {
    const result = await compareMarkets(
      { schema_family: 'lending' },
      makeDeps({ readLockfileImpl: () => null }),
    );
    expect(result).toEqual({
      denied: true,
      reason: 'deployment_unavailable',
      detail: 'no live demo-core deployments pinned — run npm run pin',
    });
  });

  it('ranks live rates by LENDER/VARIABLE and reports the dead deployment, never dropping it', async () => {
    const deps = makeDeps({ fetchImpl: fixtureFetch(MARKETS_FIXTURES) });
    const result = await compareMarkets({ schema_family: 'lending' }, deps);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const data = result.data as {
      rankedRates: Array<{ rate: number; deploymentId: string }>;
      coverage: { live: string[]; dead: Array<{ slug: string }> };
      signalRef: string;
    };
    expect(data.rankedRates.length).toBeGreaterThan(0);
    // Sorted descending.
    for (let i = 1; i < data.rankedRates.length; i++) {
      expect(data.rankedRates[i - 1].rate).toBeGreaterThanOrEqual(data.rankedRates[i].rate);
    }
    expect(data.coverage.live).toContain('aave-v3-ethereum');
    expect(data.coverage.dead.some((d) => d.slug === 'aave-v3-base')).toBe(true);
    expect(result.provenance?.source).toBe('graph');

    // Signal + digest were both recorded.
    const ref = deps.signalStore.get(data.signalRef);
    expect(ref?.tool).toBe('compare_markets');
    const digest = deps.digestStore.get(data.signalRef);
    expect(digest?.digest).toHaveLength(64);
    expect(digest?.rankedHead).toEqual(data.rankedRates.slice(0, 5));
  });
});

describe('queryPosition', () => {
  it('denies for an unknown protocol slug', async () => {
    const result = await queryPosition({ protocol: 'not-a-protocol', address: '0xabc' }, makeDeps());
    expect(result).toEqual({
      denied: true,
      reason: 'deployment_unavailable',
      detail: 'unknown protocol slug: not-a-protocol',
    });
  });

  it('returns the real recorded position, stamped with the pinned deployment ID', async () => {
    const deps = makeDeps({ fetchImpl: fixtureFetch(POSITION_FIXTURES) });
    const result = await queryPosition(
      { protocol: 'aave-v3-ethereum', address: '0xc468315a2df54f9c076bd5cfe5002ba211f74ca6' },
      deps,
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const data = result.data as { positionCount: number; deploymentId: string; signalRef: string };
    expect(data.positionCount).toBe(18);
    expect(data.deploymentId).toBe('QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd');
    expect(result.provenance).toEqual({
      deploymentId: 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd',
      source: 'graph',
      queriedAt: expect.any(String),
    });
  });

  it('denies when the deployment for that protocol is not live', async () => {
    const result = await queryPosition({ protocol: 'aave-v3-base', address: '0xabc' }, makeDeps());
    expect(result).toEqual({
      denied: true,
      reason: 'deployment_unavailable',
      detail: 'deployment for aave-v3-base is not pinned or not live',
    });
  });
});

describe('counterpartyRisk', () => {
  it('scores a liquidated address using the real recorded liquidation history', async () => {
    const deps = makeDeps({ fetchImpl: fixtureFetch(RISK_FIXTURES) });
    const result = await counterpartyRisk({ address: '0x1f4c1c2e610f089d6914c4448e6f21cb0db3adef' }, deps);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const data = result.data as { score: number; evidenceRows: Array<{ liquidationCount: number }> };
    expect(data.score).toBeLessThan(100);
    expect(data.evidenceRows.some((r) => r.liquidationCount > 0)).toBe(true);
  });
});

describe('spendHistory', () => {
  it('denies when no HCS audit topic is configured', async () => {
    const result = await spendHistory({ agent_id: 'agent-1' }, makeDeps());
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.reason).toBe('deployment_unavailable');
    expect(result.detail).toMatch(/HEDERA_TOPIC_ID/);
    expect(result.detail).not.toMatch(/graph/i);
  });

  it('reads and filters the fixture-recorded Mirror Node topic by agent_id', async () => {
    const fixture = loadFixture('mirror.topic_messages.json');
    const deps = makeDeps({
      config: loadConfig({ GRAPH_API_KEY: 'k', HEDERA_TOPIC_ID: '0.0.900001' }),
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => fixture }) as Response,
    });
    const result = await spendHistory({ agent_id: 'agent-1' }, deps);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const data = result.data as { entries: Array<{ agent_id: string }> };
    expect(data.entries).toHaveLength(2);
    expect(data.entries.every((e) => e.agent_id === 'agent-1')).toBe(true);
    expect(result.provenance?.source).toBe('mirror_node');
  });
});
