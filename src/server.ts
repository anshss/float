// Float MCP server core: registers the full v1 tool surface. C1 implements
// float_status for real; every other tool is a stub that returns a structured
// denial so the surface is callable — and later tickets can wire real bodies
// in place without touching call signatures.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { denied, ok, InMemorySignalStore, type ToolResult, type SignalStore } from './contracts.js';
import { loadConfig, type FloatConfig } from './config.js';
import { verifyLockfile } from './lockfile.js';
import { InMemorySignalDigestStore, type SignalDigestStore } from '../layers/perception/signalDigest.js';
import { compareMarkets, queryPosition, counterpartyRisk, spendHistory } from '../layers/perception/tools.js';
import { readLockfile, validateDemoCore } from '../layers/perception/pin.js';
import { grantBudget } from '../layers/policy/engine.js';
import { getPolicyStatus } from '../layers/policy/status.js';

/** Wraps a ToolResult (ok or denial) into the MCP protocol's CallToolResult
 * envelope. Denials are never surfaced as protocol-level errors (`isError`)
 * — they're structured data the agent reads and reasons over. */
function toCallToolResult<T>(result: ToolResult<T>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

const NOT_IMPLEMENTED = 'not implemented';

function stub(): CallToolResult {
  return toCallToolResult(denied('deployment_unavailable', NOT_IMPLEMENTED));
}

export type FloatServerDeps = {
  config: FloatConfig;
  signalStore: SignalStore;
  digestStore: SignalDigestStore;
};

export type FloatServer = {
  server: McpServer;
  config: FloatConfig;
  signalStore: SignalStore;
  digestStore: SignalDigestStore;
};

/** Builds the Float MCP server and returns it alongside the config/signal
 * store it was wired with, so later tickets can reach into the same instances
 * when they replace stub tool bodies with real ones. */
export function createFloatServer(deps: Partial<FloatServerDeps> = {}): FloatServer {
  const config = deps.config ?? loadConfig();
  const signalStore = deps.signalStore ?? new InMemorySignalStore();
  const digestStore = deps.digestStore ?? new InMemorySignalDigestStore();

  const server = new McpServer({
    name: 'float-mcp',
    version: '0.0.0',
  });

  // Demo-core health is checked once at startup — a dead or empty member of
  // the five deployments the demo narrates is logged loudly here rather than
  // silently rendering a hole in compare_markets later (#10).
  const demoCoreHealth = validateDemoCore(readLockfile());
  if (!demoCoreHealth.ok) {
    console.error(
      `float-mcp: demo-core deployment problem — ${demoCoreHealth.problems
        .map((p) => `${p.slug}: ${p.status} (${p.detail})`)
        .join('; ')}`,
    );
  }

  // #14: the effective mode is an explicit opt-in (DRY_RUN=0 or FLOAT_LIVE=1
  // — see src/config.ts), never inferred from which env vars happen to be
  // set, so this is the one place a human watching the process (dev,
  // rehearsal, the demo itself) sees which one they got — loudly, at
  // startup, not discovered mid-narration. A judge/operator can also read
  // this back live via float_status()'s `mode` field below.
  const hederaOperatorReady = !!(config.raw.HEDERA_OPERATOR_ID && config.raw.HEDERA_OPERATOR_KEY);
  if (config.dryRun) {
    console.error('float-mcp: mode = STUBBED (DRY_RUN) — every chain write returns a synthetic result. Set DRY_RUN=0 or FLOAT_LIVE=1 to go live.');
  } else {
    console.error('float-mcp: mode = LIVE — chain writes are REAL and will hit testnet.');
    if (!hederaOperatorReady) {
      console.error('float-mcp: WARNING — LIVE mode requested but HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY are not set; Hedera writes will fail.');
    }
  }

  // float_status() — C1, implemented for real.
  server.registerTool(
    'float_status',
    {
      title: 'Float status',
      description:
        'Reports Float server health: which config layers are configured, the effective LIVE/STUBBED mode (explicit opt-in only, never inferred from env-var presence — #14), active caps, pending confirmations, lockfile verification status, demo-core deployment health, and the policy layer\'s ground-truth Hedera state (treasury/topic ids, per-agent ceilings and live allowance remaining). Never returns key material.',
    },
    async () => {
      const lockfile = verifyLockfile();
      // `config.configured.hedera` is env-var presence only, and no longer
      // feeds `config.dryRun` (#14 — see src/config.ts's dryRun doc comment).
      // The policy layer self-bootstraps treasury/topic ids into its own
      // state rather than into env, so float_status reports ground truth —
      // ids and live allowance remaining, not env-var presence — in the
      // `hedera` field, and reflects that same ground truth back into
      // `configured.hedera` for callers that only look at the summary flag.
      const hedera = await getPolicyStatus(config);
      return toCallToolResult(
        ok({
          dryRun: config.dryRun,
          // The effective mode a judge/operator should trust over any single
          // flag: STUBBED unless an explicit opt-in (DRY_RUN=0/FLOAT_LIVE=1)
          // was made — see src/config.ts and the startup log above.
          mode: config.dryRun ? ('stubbed' as const) : ('live' as const),
          configured: { ...config.configured, hedera: hedera.configured },
          caps: config.caps,
          pendingConfirmations: [] as string[],
          lockfile,
          demoCoreHealth,
          hedera,
        }),
      );
    },
  );

  // compare_markets(schema_family) — implemented by C2.
  server.registerTool(
    'compare_markets',
    {
      title: 'Compare markets',
      description:
        'Fans a standardized query across the demo-core Graph deployments and returns ranked lending rates, stamped with deployment IDs.',
      inputSchema: { schema_family: z.string() },
    },
    async ({ schema_family }) =>
      toCallToolResult(await compareMarkets({ schema_family }, { config, signalStore, digestStore })),
  );

  // query_position(protocol, address) — implemented by C2.
  server.registerTool(
    'query_position',
    {
      title: 'Query position',
      description:
        'Reads a single address\'s position from one protocol deployment, stamped with the deployment ID served.',
      inputSchema: { protocol: z.string(), address: z.string() },
    },
    async ({ protocol, address }) =>
      toCallToolResult(await queryPosition({ protocol, address }, { config, signalStore, digestStore })),
  );

  // counterparty_risk(address) — implemented by C2.
  server.registerTool(
    'counterparty_risk',
    {
      title: 'Counterparty risk',
      description:
        'Risk heuristics over an address\'s indexed history; returns a score plus the evidence rows used. Premium deep-report variant gated behind x402 (C4).',
      inputSchema: { address: z.string() },
    },
    async ({ address }) =>
      toCallToolResult(await counterpartyRisk({ address }, { config, signalStore, digestStore })),
  );

  // spend_history(agent_id) — implemented by C2. Backed by Mirror Node, not Graph.
  server.registerTool(
    'spend_history',
    {
      title: 'Spend history',
      description:
        'Reads Float\'s own receipts on HCS, queryable via Mirror Node — never indexed by The Graph. Receipt semantics land in C4.',
      inputSchema: { agent_id: z.string() },
    },
    async ({ agent_id }) =>
      toCallToolResult(await spendHistory({ agent_id }, { config, signalStore, digestStore })),
  );

  // grant_budget(child_id, ceiling, scope) — C3 stub.
  server.registerTool(
    'grant_budget',
    {
      title: 'Grant budget',
      description:
        'Owner-only: grants a child agent a spending ceiling as an owner-signed HTS allowance ' +
        '(HTS/HBAR allowances are strictly owner->spender; a spender cannot re-delegate). Ceilings ' +
        'are enforced on-chain, the hierarchy (sum of child ceilings <= parent ceiling) is enforced ' +
        'at grant time and committed to HCS — both auditable, never on-chain nesting. Implemented by C3.',
      inputSchema: { child_id: z.string(), ceiling: z.string(), scope: z.string() },
    },
    async ({ child_id, ceiling, scope }) => toCallToolResult(await grantBudget(config, { childId: child_id, ceiling, scope })),
  );

  // pay(url, max) — C3/C4 stub.
  server.registerTool(
    'pay',
    {
      title: 'Pay',
      description:
        'Runs the full x402 flow against a gated endpoint, policy-checked against the caller\'s budget. Stub in C1; implemented by C3/C4.',
      inputSchema: { url: z.string(), max: z.string() },
    },
    async () => stub(),
  );

  // transfer_usdc(to, amount, signal_ref) — C5 stub. Refuses without signal_ref.
  server.registerTool(
    'transfer_usdc',
    {
      title: 'Transfer USDC',
      description:
        'Transfers USDC on Arc, citing the signal_ref that grounded the decision. Refuses with no_signal_cited if signal_ref is missing or unknown. Stub in C1; implemented by C5.',
      inputSchema: { to: z.string(), amount: z.string(), signal_ref: z.string() },
    },
    async () => stub(),
  );

  // confirm_pending() — C6 stub. Device-press state; never bypasses.
  server.registerTool(
    'confirm_pending',
    {
      title: 'Confirm pending',
      description:
        'Confirms a pending treasury authorization once the physical Ledger button is pressed. Never bypasses the device. Stub in C1; implemented by C6.',
    },
    async () => stub(),
  );

  return { server, config, signalStore, digestStore };
}
