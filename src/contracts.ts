// Shared wire contracts for every Float MCP tool response.
//
// This file is the seam every other component (C2-C6) imports. Nothing downstream
// may redefine these shapes — extend by adding fields to a specific tool's `data`
// payload, never by widening or renaming what's here.

/** A successful tool result. `provenance` is present whenever the data came from
 * an external source (Graph, Mirror Node, Ledger CLI, Privy) so a client can
 * trace exactly which pinned deployment / query time produced it. */
export type ToolOk<T> = {
  ok: true;
  data: T;
  provenance?: Provenance;
};

/** The full set of reasons a tool can refuse to act. Denials are RETURNED
 * VALUES, never thrown — a refusal the agent can reason about is the product. */
export type DenialReason =
  | 'ceiling_exceeded'
  | 'no_signal_cited'
  | 'awaiting_device'
  | 'deployment_unavailable'
  | 'provider_policy_denied';

export type Denial = {
  denied: true;
  reason: DenialReason;
  detail: string;
};

/** Every tool returns either a ToolOk or a Denial — never a thrown error for an
 * expected refusal path. */
export type ToolResult<T> = ToolOk<T> | Denial;

/** Stamped onto any response backed by an external source of truth, so the
 * client can see exactly what data provenance it's reasoning from. */
export type Provenance = {
  deploymentId?: string;
  source: 'graph' | 'mirror_node' | 'ledger_cli' | 'privy';
  queriedAt: string;
};

/** The single HCS message shape shared by policy grants, payment receipts and
 * denials. One topic, one schema, so `spend_history` can read every kind of
 * event back in order. */
export type AuditMessage = {
  v: 1;
  kind: 'grant' | 'revoke' | 'spend' | 'denial';
  agent_id: string;
  ts: string;
  policy_id?: string;
  service?: string;
  amount?: string;
  tx?: string;
  reason?: DenialReason;
};

/** A pointer to a perception-layer query result, cited by `transfer_usdc` to
 * prove a transfer was grounded in a real signal rather than invented. */
export type SignalRef = {
  id: string;
  tool: string;
  deploymentId: string;
  queriedAt: string;
};

/** In-memory cache of signals produced by perception-layer tools. C5
 * (settlement) validates `transfer_usdc`'s `signal_ref` argument against this
 * store before allowing a transfer. */
export interface SignalStore {
  put(entry: Omit<SignalRef, 'id'>): SignalRef;
  get(id: string): SignalRef | null;
}

/** Simple process-lifetime implementation of SignalStore. Not persisted —
 * signals are only meaningful within a single agent session. */
export class InMemorySignalStore implements SignalStore {
  private store = new Map<string, SignalRef>();
  private counter = 0;

  put(entry: Omit<SignalRef, 'id'>): SignalRef {
    const id = `sig_${++this.counter}_${Date.now().toString(36)}`;
    const ref: SignalRef = { id, ...entry };
    this.store.set(id, ref);
    return ref;
  }

  get(id: string): SignalRef | null {
    return this.store.get(id) ?? null;
  }
}

export function ok<T>(data: T, provenance?: Provenance): ToolOk<T> {
  return provenance !== undefined ? { ok: true, data, provenance } : { ok: true, data };
}

export function denied(reason: DenialReason, detail: string): Denial {
  return { denied: true, reason, detail };
}
