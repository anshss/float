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
