// Thin HTTP client for The Graph's gateway. This is the ONLY way perception
// tools reach chain-indexed data — no RPC client is ever imported in this
// layer (enforced by __tests__/perception.no-rpc.test.ts).

export type GraphQueryResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type GraphClientOpts = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** POSTs a GraphQL query to `gateway.thegraph.com/api/{apiKey}/subgraphs/id/{subgraphId}`
 * and normalizes network errors, GraphQL errors and timeouts into one result
 * shape — callers never need a try/catch. */
export async function queryGraph<T>(
  subgraphId: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  opts: GraphClientOpts,
): Promise<GraphQueryResult<T>> {
  const url = `https://gateway.thegraph.com/api/${opts.apiKey}/subgraphs/id/${subgraphId}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `gateway http ${res.status}` };
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors && body.errors.length > 0) {
      return { ok: false, error: body.errors.map((e) => e.message).join('; ') };
    }
    if (body.data === undefined) {
      return { ok: false, error: 'gateway response had no data field' };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once — keeps the
 * 92-deployment pin sweep (and any other fan-out) bounded and concurrent. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
