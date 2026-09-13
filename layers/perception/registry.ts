// Registry loader over the vendored `registry.seed.ts` (89 Messari lending
// subgraph deployments across ~15 chains). Pure lookups only — the pin step
// (`pin.ts`) is what actually talks to the network.

import { REGISTRY, type SubgraphEntry } from './registry.seed.js';

/** The five schemaVersion-3.1.0 deployments the demo narrates. The 89-wide
 * fan-out is the flex stat; these are what `compare_markets` queries.
 * `aave-v3-base` was swapped out for `aave-v3-polygon` (#10): base is dead
 * (`subgraph not found: no allocations`) and stays in the registry as honest
 * dead coverage, it just isn't one of the five the demo narrates. */
export const DEMO_CORE_SLUGS = [
  'aave-v3-ethereum',
  'aave-v3-polygon',
  'aave-v3-arbitrum',
  'compound-v3-ethereum',
  'compound-v3-arbitrum',
] as const;

export function listAllSubgraphs(): SubgraphEntry[] {
  return Object.values(REGISTRY).flat();
}

export function findSubgraph(slug: string): SubgraphEntry | null {
  return listAllSubgraphs().find((entry) => entry.slug === slug) ?? null;
}

export function demoCoreEntries(): SubgraphEntry[] {
  return DEMO_CORE_SLUGS.map((slug) => findSubgraph(slug)).filter(
    (entry): entry is SubgraphEntry => entry !== null,
  );
}
