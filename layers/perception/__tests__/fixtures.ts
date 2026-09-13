// Shared fixture-backed fetch mock for the perception layer's tests. Fixtures
// under __fixtures__/ are real recorded gateway responses (except
// mirror.topic_messages.json, which is hand-built per Mirror Node's
// documented schema — see that file's `_source` field).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolOk, ToolResult } from '../../../src/contracts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', '..', '..', '__fixtures__');

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf-8'));
}

/** `ToolOk`/`Denial` share no discriminant name, so `'ok' in result` is the
 * narrowing idiom every test in this layer uses instead of a cast. */
export function isOk<T>(result: ToolResult<T>): result is ToolOk<T> {
  return 'ok' in result;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

/** Builds a `fetch`-compatible mock keyed by exact subgraph ID substring, so
 * a single test can wire up several deployments at once (compare_markets /
 * counterparty_risk fan out across five). */
export function fixtureFetch(
  bySubgraphId: Record<string, { meta?: unknown; probe?: unknown; markets?: unknown; account?: unknown }>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();
    const entry = Object.entries(bySubgraphId).find(([id]) => urlStr.includes(id));
    if (!entry) return jsonResponse({ errors: [{ message: `no fixture wired for ${urlStr}` }] });
    const [, fixtures] = entry;
    const bodyStr = typeof init?.body === 'string' ? init.body : '';
    if (bodyStr.includes('_meta')) return jsonResponse(fixtures.meta ?? { errors: [{ message: 'no meta fixture' }] });
    // Check the narrower `markets(first: 1)` non-empty probe before the
    // general markets query — both contain the substring `markets(`.
    if (bodyStr.includes('markets(first: 1)')) {
      return jsonResponse(fixtures.probe ?? fixtures.markets ?? { errors: [{ message: 'no probe fixture' }] });
    }
    if (bodyStr.includes('markets(')) return jsonResponse(fixtures.markets ?? { errors: [{ message: 'no markets fixture' }] });
    if (bodyStr.includes('account(')) return jsonResponse(fixtures.account ?? { errors: [{ message: 'no account fixture' }] });
    return jsonResponse({ errors: [{ message: 'fixture fetch: unrecognized query' }] });
  }) as typeof fetch;
}
