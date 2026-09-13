// Read-only Hedera Mirror Node client for the policy layer's status
// reporting. Mirrors the injectable-fetch, never-throw style of
// layers/perception/mirrorNode.ts (a structured `{ok:false,error}` instead
// of a thrown error) so `float_status` — which must never throw — can call
// straight into it without its own try/catch.

export type MirrorNodeOpts = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type MirrorAllowance = {
  owner: string;
  spender: string;
  grantedTinybar: number;
  /** Current unspent balance of the allowance — this is the live number,
   * not the ceiling that was granted. */
  remainingTinybar: number;
};

export type MirrorAllowancesResult =
  | { ok: true; allowances: MirrorAllowance[] }
  | { ok: false; error: string };

/** `GET /accounts/{ownerId}/allowances/crypto` — every HBAR allowance the
 * given account has approved as owner, one call regardless of how many
 * spenders it has. */
export async function fetchHbarAllowances(
  ownerAccountId: string,
  opts: MirrorNodeOpts,
): Promise<MirrorAllowancesResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, '')}/api/v1/accounts/${ownerAccountId}/allowances/crypto`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `mirror node http ${res.status}` };
    const body = (await res.json()) as {
      allowances?: Array<{ owner: string; spender: string; amount: number; amount_granted: number }>;
    };
    return {
      ok: true,
      allowances: (body.allowances ?? []).map((a) => ({
        owner: a.owner,
        spender: a.spender,
        grantedTinybar: a.amount_granted,
        remainingTinybar: a.amount,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export type OrphanCandidate = {
  accountId: string;
  balanceTinybar: number;
  createdAt: string;
};

/** #21's refuse-to-mint guard, second signal: the operator already created
 * account(s) this process doesn't know about (a prior mint whose result
 * never made it into state — exactly what happened during the incident
 * this ticket fixes) and at least one of them still holds a balance.
 * Read-only and best-effort: a mirror-node hiccup returns `[]` (never
 * blocks bootstrap on an unreachable check) rather than throwing — the
 * backup check in `state.ts` is the guard's other, independent leg. */
export async function findOrphanedFundedAccounts(
  operatorAccountId: string,
  knownAccountIds: ReadonlySet<string>,
  opts: MirrorNodeOpts & { limit?: number },
): Promise<OrphanCandidate[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const limit = opts.limit ?? 25;

  let createdIds: string[];
  const listController = new AbortController();
  const listTimeout = setTimeout(() => listController.abort(), timeoutMs);
  try {
    const res = await doFetch(
      `${baseUrl}/api/v1/transactions?account.id=${operatorAccountId}&transactiontype=CRYPTOCREATEACCOUNT&order=desc&limit=${limit}`,
      { signal: listController.signal },
    );
    if (!res.ok) {
      console.error(`[float-mcp/policy] orphan-account check: mirror node http ${res.status} — skipping the check`);
      return [];
    }
    const body = (await res.json()) as { transactions?: Array<{ entity_id: string | null; result: string }> };
    createdIds = (body.transactions ?? [])
      .filter((t): t is { entity_id: string; result: string } => t.result === 'SUCCESS' && !!t.entity_id)
      .map((t) => t.entity_id)
      .filter((id) => !knownAccountIds.has(id));
  } catch (err) {
    console.error(
      `[float-mcp/policy] orphan-account check: mirror node unreachable (${err instanceof Error ? err.message : String(err)}) — skipping the check`,
    );
    return [];
  } finally {
    clearTimeout(listTimeout);
  }

  const orphans: OrphanCandidate[] = [];
  for (const accountId of createdIds) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}/api/v1/accounts/${accountId}`, { signal: controller.signal });
      if (!res.ok) continue;
      const info = (await res.json()) as { balance?: { balance: number }; created_timestamp?: string };
      const balanceTinybar = info.balance?.balance ?? 0;
      if (balanceTinybar > 0) {
        orphans.push({ accountId, balanceTinybar, createdAt: info.created_timestamp ?? 'unknown' });
      }
    } catch {
      // A single unreachable account lookup shouldn't sink the whole check.
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return orphans;
}
