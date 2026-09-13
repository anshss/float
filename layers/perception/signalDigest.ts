// Companion store to #1's shared `SignalStore` (src/contracts.ts). `SignalRef`
// is the frozen wire shape — {id, tool, deploymentId, queriedAt} — and proves
// a signal EXISTED but not what it said. This store, keyed by the same
// `SignalRef.id`, holds a digest of the actual query result so #6 can show a
// judge what a transfer was grounded in. It extends the STORED entry, not the
// wire contract: contracts.ts is never touched by this ticket.

import { createHash } from 'node:crypto';

export type SignalDigestEntry = {
  /** sha256 hex of the full JSON-serialized query result. */
  digest: string;
  /** The ranked/leading slice of the payload — small enough to inline in an
   * audit trail without re-running the query. */
  rankedHead: unknown;
};

export interface SignalDigestStore {
  put(id: string, entry: SignalDigestEntry): void;
  get(id: string): SignalDigestEntry | null;
}

export class InMemorySignalDigestStore implements SignalDigestStore {
  private store = new Map<string, SignalDigestEntry>();

  put(id: string, entry: SignalDigestEntry): void {
    this.store.set(id, entry);
  }

  get(id: string): SignalDigestEntry | null {
    return this.store.get(id) ?? null;
  }
}

/** Hashes a query result and takes its ranked head for storage alongside a
 * SignalRef. `head` should already be sorted/ranked by the caller. */
export function digestResult(payload: unknown, head: unknown, headCount = 5): SignalDigestEntry {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const rankedHead = Array.isArray(head) ? head.slice(0, headCount) : head;
  return { digest, rankedHead };
}
