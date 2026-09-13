// Real bodies for the four C2 tools registered as stubs by C1's server.ts:
// compare_markets, query_position, counterparty_risk, spend_history. Zero RPC
// imports here — Graph gateway and Mirror Node are both plain HTTP.

import { ok, denied, type ToolResult, type SignalStore, type Provenance } from '../../src/contracts.js';
import type { FloatConfig } from '../../src/config.js';
import { queryGraph, mapWithConcurrency } from './graphClient.js';
import { readLockfile, getPinned, type Lockfile } from './pin.js';
import { demoCoreEntries, findSubgraph, DEMO_CORE_SLUGS } from './registry.js';
import { fetchTopicMessages, decodeAuditMessage } from './mirrorNode.js';
import { digestResult, type SignalDigestStore } from './signalDigest.js';
import { loadState } from '../policy/state.js';

export type PerceptionDeps = {
  config: FloatConfig;
  signalStore: SignalStore;
  digestStore: SignalDigestStore;
  /** Injectable for tests; defaults to the real global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to reading layers/perception/deployments.lock.json. */
  readLockfileImpl?: () => Lockfile | null;
  mirrorNodeBaseUrl?: string;
};

type DeadCoverage = { slug: string; error: string };
type EmptyCoverage = { slug: string; reason: string };

function loadLockfile(deps: PerceptionDeps): Lockfile | null {
  return (deps.readLockfileImpl ?? readLockfile)();
}

/** Splits a set of demo-core slugs into live / empty / dead — the "empty and
 * dead are both reported, never silently dropped or counted as coverage"
 * contract. A resolving-but-zero-rows deployment (empty) is never treated as
 * servable, same as an unreachable one (dead). */
function coverageOf(lockfile: Lockfile | null, slugs: readonly string[]) {
  const live: string[] = [];
  const empty: EmptyCoverage[] = [];
  const dead: DeadCoverage[] = [];
  for (const slug of slugs) {
    if (!lockfile) {
      dead.push({ slug, error: 'no lockfile — run npm run pin' });
      continue;
    }
    const entry = lockfile.deployments[slug];
    if (!entry) {
      dead.push({ slug, error: 'not pinned' });
    } else if (entry.status === 'live') {
      live.push(slug);
    } else if (entry.status === 'empty') {
      empty.push({ slug, reason: entry.reason });
    } else {
      dead.push({ slug, error: entry.error });
    }
  }
  return { live, empty, dead };
}

const MARKETS_QUERY =
  '{ markets(first: 50) { name inputToken { symbol } rates { rate side type } } }';

type MarketsResponse = {
  markets: Array<{
    name: string;
    inputToken: { symbol: string };
    rates: Array<{ rate: string; side: string; type: string }>;
  }>;
};

export async function compareMarkets(
  args: { schema_family: string },
  deps: PerceptionDeps,
): Promise<ToolResult<unknown>> {
  if (!deps.config.configured.graph) {
    return denied('deployment_unavailable', 'GRAPH_API_KEY not configured');
  }
  const lockfile = loadLockfile(deps);
  const { live, empty, dead } = coverageOf(lockfile, DEMO_CORE_SLUGS);
  if (live.length === 0) {
    return denied(
      'deployment_unavailable',
      'no live demo-core deployments pinned — run npm run pin',
    );
  }

  const apiKey = deps.config.raw.GRAPH_API_KEY as string;
  const rows = await mapWithConcurrency(live, 5, async (slug) => {
    const entry = findSubgraph(slug)!;
    const pinned = getPinned(lockfile!, slug)!;
    const result = await queryGraph<MarketsResponse>(entry.subgraphId, MARKETS_QUERY, undefined, {
      apiKey,
      fetchImpl: deps.fetchImpl,
    });
    if (!result.ok) {
      return { slug, deploymentId: pinned.deploymentId, error: result.error, markets: [] as MarketsResponse['markets'] };
    }
    return { slug, deploymentId: pinned.deploymentId, error: null as string | null, markets: result.data.markets };
  });

  // Ranked on LENDER/VARIABLE rates per the spec: the one rate shape that's
  // comparable across every schemaVersion-3.1.0 deployment.
  const rankedRates = rows
    .flatMap((row) =>
      row.markets.map((market) => {
        const lenderVariable = market.rates.find((r) => r.side === 'LENDER' && r.type === 'VARIABLE');
        if (!lenderVariable) return null;
        return {
          slug: row.slug,
          deploymentId: row.deploymentId,
          market: market.name,
          symbol: market.inputToken.symbol,
          rate: Number(lenderVariable.rate),
        };
      }),
    )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.rate - a.rate);

  const queryFailures = rows
    .filter((r) => r.error !== null)
    .map((r) => ({ slug: r.slug, error: r.error as string }));

  const data = {
    schemaFamily: args.schema_family,
    rankedRates,
    coverage: {
      totalRequested: DEMO_CORE_SLUGS.length,
      live,
      empty,
      dead: [...dead, ...queryFailures],
    },
  };

  const queriedAt = new Date().toISOString();
  const signalRef = deps.signalStore.put({
    tool: 'compare_markets',
    deploymentId: live.map((slug) => getPinned(lockfile!, slug)!.deploymentId).join(','),
    queriedAt,
  });
  deps.digestStore.put(signalRef.id, digestResult(data, rankedRates));

  const provenance: Provenance = { source: 'graph', queriedAt };
  return ok({ ...data, signalRef: signalRef.id }, provenance);
}

const ACCOUNT_POSITION_QUERY = `query($id: ID!) {
  account(id: $id) {
    id
    positionCount
    openPositionCount
    closedPositionCount
    positions(first: 20) {
      balance
      side
      isCollateral
      market { name inputToken { symbol } }
    }
  }
}`;

type AccountPositionResponse = {
  account: {
    id: string;
    positionCount: number;
    openPositionCount: number;
    closedPositionCount: number;
    positions: Array<{
      balance: string;
      side: string;
      isCollateral: boolean | null;
      market: { name: string; inputToken: { symbol: string } };
    }>;
  } | null;
};

export async function queryPosition(
  args: { protocol: string; address: string },
  deps: PerceptionDeps,
): Promise<ToolResult<unknown>> {
  if (!deps.config.configured.graph) {
    return denied('deployment_unavailable', 'GRAPH_API_KEY not configured');
  }
  const entry = findSubgraph(args.protocol);
  if (!entry) {
    return denied('deployment_unavailable', `unknown protocol slug: ${args.protocol}`);
  }
  const lockfile = loadLockfile(deps);
  const pinned = lockfile ? getPinned(lockfile, args.protocol) : null;
  if (!pinned) {
    let detail = 'no lockfile — run npm run pin';
    if (lockfile) {
      const resolved = lockfile.deployments[args.protocol];
      if (resolved?.status === 'dead') detail = `deployment for ${args.protocol} is dead: ${resolved.error}`;
      else if (resolved?.status === 'empty') detail = `deployment for ${args.protocol} resolves but is empty: ${resolved.reason}`;
      else detail = `deployment for ${args.protocol} is not pinned`;
    }
    return denied('deployment_unavailable', detail);
  }

  const apiKey = deps.config.raw.GRAPH_API_KEY as string;
  const result = await queryGraph<AccountPositionResponse>(
    entry.subgraphId,
    ACCOUNT_POSITION_QUERY,
    { id: args.address.toLowerCase() },
    { apiKey, fetchImpl: deps.fetchImpl },
  );
  if (!result.ok) {
    return denied('deployment_unavailable', result.error);
  }

  const account = result.data.account;
  const data = {
    protocol: args.protocol,
    address: args.address,
    deploymentId: pinned.deploymentId,
    positionCount: account?.positionCount ?? 0,
    openPositionCount: account?.openPositionCount ?? 0,
    closedPositionCount: account?.closedPositionCount ?? 0,
    positions: account?.positions ?? [],
  };

  const queriedAt = new Date().toISOString();
  const signalRef = deps.signalStore.put({ tool: 'query_position', deploymentId: pinned.deploymentId, queriedAt });
  deps.digestStore.put(signalRef.id, digestResult(data, data.positions));

  return ok(
    { ...data, signalRef: signalRef.id },
    { deploymentId: pinned.deploymentId, source: 'graph', queriedAt },
  );
}

const ACCOUNT_RISK_QUERY = `query($id: ID!) {
  account(id: $id) {
    id
    positionCount
    openPositionCount
    closedPositionCount
    liquidations(first: 10) { amountUSD liquidator { id } }
  }
}`;

type AccountRiskResponse = {
  account: {
    id: string;
    positionCount: number;
    openPositionCount: number;
    closedPositionCount: number;
    liquidations: Array<{ amountUSD: string; liquidator: { id: string } }>;
  } | null;
};

export async function counterpartyRisk(
  args: { address: string },
  deps: PerceptionDeps,
): Promise<ToolResult<unknown>> {
  if (!deps.config.configured.graph) {
    return denied('deployment_unavailable', 'GRAPH_API_KEY not configured');
  }
  const lockfile = loadLockfile(deps);
  const { live, empty, dead } = coverageOf(lockfile, DEMO_CORE_SLUGS);
  if (live.length === 0) {
    return denied(
      'deployment_unavailable',
      'no live demo-core deployments pinned — run npm run pin',
    );
  }

  const apiKey = deps.config.raw.GRAPH_API_KEY as string;
  const rows = await mapWithConcurrency(live, 5, async (slug) => {
    const entry = findSubgraph(slug)!;
    const pinned = getPinned(lockfile!, slug)!;
    const result = await queryGraph<AccountRiskResponse>(
      entry.subgraphId,
      ACCOUNT_RISK_QUERY,
      { id: args.address.toLowerCase() },
      { apiKey, fetchImpl: deps.fetchImpl },
    );
    if (!result.ok) {
      return { slug, deploymentId: pinned.deploymentId, error: result.error, account: null as AccountRiskResponse['account'] };
    }
    return { slug, deploymentId: pinned.deploymentId, error: null as string | null, account: result.data.account };
  });

  const evidenceRows = rows
    .filter((r) => r.account !== null)
    .map((r) => {
      const account = r.account!;
      return {
        slug: r.slug,
        deploymentId: r.deploymentId,
        positionCount: account.positionCount,
        openPositionCount: account.openPositionCount,
        liquidationCount: account.liquidations.length,
        liquidatedUsd: account.liquidations.reduce((sum, l) => sum + Number(l.amountUSD), 0),
      };
    });

  const totalLiquidations = evidenceRows.reduce((sum, r) => sum + r.liquidationCount, 0);
  const totalLiquidatedUsd = evidenceRows.reduce((sum, r) => sum + r.liquidatedUsd, 0);
  // Heuristic, not a credit score: start at 100, dock 20 per liquidation event
  // plus up to 30 more scaled by USD liquidated. evidenceRows carry the raw
  // numbers a caller should actually reason over.
  const score = Math.max(
    0,
    Math.min(100, 100 - totalLiquidations * 20 - Math.min(30, totalLiquidatedUsd / 1_000_000)),
  );

  const queryFailures = rows
    .filter((r) => r.error !== null)
    .map((r) => ({ slug: r.slug, error: r.error as string }));

  const data = {
    address: args.address,
    score,
    evidenceRows,
    coverage: {
      totalRequested: DEMO_CORE_SLUGS.length,
      live,
      empty,
      dead: [...dead, ...queryFailures],
    },
  };

  const queriedAt = new Date().toISOString();
  const signalRef = deps.signalStore.put({
    tool: 'counterparty_risk',
    deploymentId: live.map((slug) => getPinned(lockfile!, slug)!.deploymentId).join(','),
    queriedAt,
  });
  deps.digestStore.put(signalRef.id, digestResult(data, evidenceRows));

  return ok({ ...data, signalRef: signalRef.id }, { source: 'graph', queriedAt });
}

export async function spendHistory(
  args: { agent_id: string },
  deps: PerceptionDeps,
): Promise<ToolResult<unknown>> {
  // Backend is Hedera Mirror Node, never The Graph — The Graph does not index
  // Hedera. Land the client + shape here; #4 fills in receipt semantics once
  // #3's audit topic exists.
  //
  // Env wins when explicitly set (an operator can point a run at a
  // pre-existing topic); otherwise fall back to whatever the policy layer's
  // own bootstrap persisted, exactly as `layers/policy/status.ts` already
  // resolves treasury/topic ids for `float_status`. Reading the env var only
  // meant this tool denied even once the audit topic genuinely existed and
  // had real receipts on it (created by `grant_budget`/`pay`/etc, which all
  // bootstrap through the SAME state) — a chained-call demo run surfaces
  // this the moment beat 6 (`spend_history`) follows beats that already
  // wrote to that very topic; an isolated unit test setting the env var
  // directly never would.
  const topicId = deps.config.raw.HEDERA_TOPIC_ID ?? loadState().topicId ?? undefined;
  if (!topicId) {
    return denied(
      'deployment_unavailable',
      "no HCS audit topic configured or bootstrapped yet — spend_history reads Float's own receipts on HCS via Mirror Node, which requires the policy layer's audit topic (see layers/policy/bootstrap.ts)",
    );
  }

  const baseUrl =
    deps.mirrorNodeBaseUrl ?? deps.config.raw.HEDERA_MIRROR_NODE_URL ?? 'https://testnet.mirrornode.hedera.com';
  const result = await fetchTopicMessages(topicId, { baseUrl, fetchImpl: deps.fetchImpl });
  if (!result.ok) {
    return denied('deployment_unavailable', result.error);
  }

  const entries = result.messages
    .map(decodeAuditMessage)
    .filter((m): m is NonNullable<typeof m> => m !== null && m.agent_id === args.agent_id);

  const data = { agentId: args.agent_id, topicId, entries };
  const queriedAt = new Date().toISOString();
  const signalRef = deps.signalStore.put({
    tool: 'spend_history',
    deploymentId: `mirror_node:${topicId}`,
    queriedAt,
  });
  deps.digestStore.put(signalRef.id, digestResult(data, entries));

  return ok({ ...data, signalRef: signalRef.id }, { source: 'mirror_node', queriedAt });
}

// Re-exported so tests/tooling can enumerate the demo-core set without a
// second import of registry.ts.
export { demoCoreEntries };
