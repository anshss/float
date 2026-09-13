// The pin step. `npm run pin` is the ONLY thing that ever writes
// deployments.lock.json — never automatic, always logged (see
// scripts/pin.ts). Tools read the lockfile at call time and refuse
// (`deployment_unavailable`) rather than serve unpinned data.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listAllSubgraphs } from './registry.js';
import { queryGraph, mapWithConcurrency, type GraphClientOpts } from './graphClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOCKFILE_PATH = path.join(here, 'deployments.lock.json');

export type PinnedDeployment = {
  slug: string;
  network: string;
  subgraphId: string;
  schemaVersion: string;
  live: true;
  deploymentId: string;
  blockNumber: number;
};

export type DeadDeployment = {
  slug: string;
  network: string;
  subgraphId: string;
  schemaVersion: string;
  live: false;
  error: string;
};

export type DeploymentEntry = PinnedDeployment | DeadDeployment;

export type Lockfile = {
  pinnedAt: string;
  totalDeployments: number;
  liveCount: number;
  deadCount: number;
  deployments: Record<string, DeploymentEntry>;
};

const META_QUERY = '{ _meta { deployment block { number } } }';

type MetaResponse = { _meta: { deployment: string; block: { number: number } } };

async function pinOne(
  entry: { slug: string; network: string; subgraphId: string; schemaVersion: string },
  opts: Omit<GraphClientOpts, 'apiKey'> & { apiKey: string },
): Promise<DeploymentEntry> {
  const result = await queryGraph<MetaResponse>(entry.subgraphId, META_QUERY, undefined, opts);
  if (!result.ok) {
    return {
      slug: entry.slug,
      network: entry.network,
      subgraphId: entry.subgraphId,
      schemaVersion: entry.schemaVersion,
      live: false,
      error: result.error,
    };
  }
  return {
    slug: entry.slug,
    network: entry.network,
    subgraphId: entry.subgraphId,
    schemaVersion: entry.schemaVersion,
    live: true,
    deploymentId: result.data._meta.deployment,
    blockNumber: result.data._meta.block.number,
  };
}

/** Resolves every registry entry's current deployment ID (bounded, concurrent
 * — never a hot-path call). Never throws: an unreachable/dead deployment is a
 * `live:false` entry, not an aborted sweep. */
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
  for (const result of results) {
    deployments[result.slug] = result;
    if (result.live) liveCount += 1;
  }
  return {
    pinnedAt: new Date().toISOString(),
    totalDeployments: entries.length,
    liveCount,
    deadCount: entries.length - liveCount,
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

/** Looks up a slug's pinned entry and narrows to `PinnedDeployment` only if
 * it was live at the last pin. A missing or dead entry both return null —
 * callers turn that into a `deployment_unavailable` denial. */
export function getPinned(lockfile: Lockfile, slug: string): PinnedDeployment | null {
  const entry = lockfile.deployments[slug];
  return entry && entry.live ? entry : null;
}
