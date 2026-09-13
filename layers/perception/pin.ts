// The pin step. `npm run pin` is the ONLY thing that ever writes
// deployments.lock.json — never automatic, always logged (see
// scripts/pin.ts). Tools read the lockfile at call time and refuse
// (`deployment_unavailable`) rather than serve unpinned data.
//
// Liveness is a THREE-way classification, not a boolean: a `_meta` resolve
// alone cannot tell a working deployment from one that resolves fine but
// returns zero rows (aave-v3-optimism does exactly this). `empty` is
// reported like `dead` — never counted as servable coverage — because an
// empty-but-"live" row reaching a judge's screen stamped with a real
// deployment ID is worse than an honest denial.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listAllSubgraphs, DEMO_CORE_SLUGS } from './registry.js';
import { queryGraph, mapWithConcurrency, type GraphClientOpts } from './graphClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOCKFILE_PATH = path.join(here, 'deployments.lock.json');

type EntryBase = {
  slug: string;
  network: string;
  subgraphId: string;
  schemaVersion: string;
};

export type LiveDeployment = EntryBase & {
  status: 'live';
  deploymentId: string;
  blockNumber: number;
};

export type EmptyDeployment = EntryBase & {
  status: 'empty';
  deploymentId: string;
  blockNumber: number;
  /** Why it was classified empty — the non-empty probe's outcome. */
  reason: string;
};

export type DeadDeployment = EntryBase & {
  status: 'dead';
  error: string;
};

export type DeploymentEntry = LiveDeployment | EmptyDeployment | DeadDeployment;

export type Lockfile = {
  pinnedAt: string;
  totalDeployments: number;
  liveCount: number;
  emptyCount: number;
  deadCount: number;
  deployments: Record<string, DeploymentEntry>;
};

const META_QUERY = '{ _meta { deployment block { number } } }';
type MetaResponse = { _meta: { deployment: string; block: { number: number } } };

// Cheap non-empty probe: schemaVersion-3.1.0 (and most Messari lending)
// deployments all expose `markets`, so one row proves the deployment is
// actually indexing data rather than just resolving `_meta`.
const NON_EMPTY_PROBE_QUERY = '{ markets(first: 1) { id } }';
type ProbeResponse = { markets: Array<{ id: string }> };

async function pinOne(entry: EntryBase, opts: GraphClientOpts): Promise<DeploymentEntry> {
  const metaResult = await queryGraph<MetaResponse>(entry.subgraphId, META_QUERY, undefined, opts);
  if (!metaResult.ok) {
    return { ...entry, status: 'dead', error: metaResult.error };
  }

  const resolved = {
    ...entry,
    deploymentId: metaResult.data._meta.deployment,
    blockNumber: metaResult.data._meta.block.number,
  };

  const probeResult = await queryGraph<ProbeResponse>(entry.subgraphId, NON_EMPTY_PROBE_QUERY, undefined, opts);
  if (!probeResult.ok) {
    return { ...resolved, status: 'empty', reason: `non-empty probe failed: ${probeResult.error}` };
  }
  if (probeResult.data.markets.length === 0) {
    return { ...resolved, status: 'empty', reason: 'markets query returned zero rows' };
  }
  return { ...resolved, status: 'live' };
}

/** Resolves every registry entry's current deployment ID AND probes it for
 * non-empty data (bounded, concurrent — never a hot-path call). Never
 * throws: an unreachable, dead or empty deployment is a classified entry,
 * not an aborted sweep. */
export async function pinAll(opts: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  concurrency?: number;
}): Promise<Lockfile> {
  const entries = listAllSubgraphs();
  const results = await mapWithConcurrency(entries, opts.concurrency ?? 8, (entry) =>
    pinOne(entry, { apiKey: opts.apiKey, fetchImpl: opts.fetchImpl }),
  );
  const deployments: Record<string, DeploymentEntry> = {};
  let liveCount = 0;
  let emptyCount = 0;
  for (const result of results) {
    deployments[result.slug] = result;
    if (result.status === 'live') liveCount += 1;
    else if (result.status === 'empty') emptyCount += 1;
  }
  return {
    pinnedAt: new Date().toISOString(),
    totalDeployments: entries.length,
    liveCount,
    emptyCount,
    deadCount: entries.length - liveCount - emptyCount,
    deployments,
  };
}

export function writeLockfile(lockfile: Lockfile, filePath: string = LOCKFILE_PATH): void {
  writeFileSync(filePath, JSON.stringify(lockfile, null, 2) + '\n', 'utf-8');
}

export function readLockfile(filePath: string = LOCKFILE_PATH): Lockfile | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Lockfile;
  } catch {
    return null;
  }
}

/** Looks up a slug's pinned entry and narrows to `LiveDeployment` only if it
 * was BOTH resolved and non-empty at the last pin. A missing, dead or empty
 * entry all return null — callers turn that into a `deployment_unavailable`
 * denial (empty is never treated as servable, same as dead). */
export function getPinned(lockfile: Lockfile, slug: string): LiveDeployment | null {
  const entry = lockfile.deployments[slug];
  return entry && entry.status === 'live' ? entry : null;
}

export type DemoCoreProblem = { slug: string; status: 'dead' | 'empty' | 'missing'; detail: string };

/** Validates the five demo-core deployments specifically — the ones the demo
 * narrates. Called at server startup so a dead or empty member is logged
 * loudly instead of silently rendering a hole in `compare_markets`. */
export function validateDemoCore(lockfile: Lockfile | null): { ok: boolean; problems: DemoCoreProblem[] } {
  const problems: DemoCoreProblem[] = [];
  for (const slug of DEMO_CORE_SLUGS) {
    if (!lockfile) {
      problems.push({ slug, status: 'missing', detail: 'no lockfile — run npm run pin' });
      continue;
    }
    const entry = lockfile.deployments[slug];
    if (!entry) {
      problems.push({ slug, status: 'missing', detail: 'not present in lockfile' });
    } else if (entry.status === 'dead') {
      problems.push({ slug, status: 'dead', detail: entry.error });
    } else if (entry.status === 'empty') {
      problems.push({ slug, status: 'empty', detail: entry.reason });
    }
  }
  return { ok: problems.length === 0, problems };
}
