// The six-beat demo, executed against the REAL float-mcp server through a
// real MCP client (see run.ts for the transport). One continuous process,
// one call sequence, fixed inputs -- the actual point: every layer
// below has been proven alone, this proves they still work called back to
// back in the order a real agent would call them.
//
// Beat 4's "child" is not a second MCP client or a second process -- it
// calls `spend()` directly, exactly as layers/policy/live-verify.ts already
// does, because `spend` is explicitly not an MCP tool in this ticket (see
// its doc comment in layers/policy/engine.ts): grant_budget is root-only,
// and a child's own spend attempt against its granted ceiling has nowhere
// else to be exercised from. It runs in the same process as the parent
// call sequence, which is what "while the parent continues" means here --
// the parent's next beat (5) runs immediately after, in the same script.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { FloatConfig } from '../../src/config.js';
import { spend } from '../../layers/policy/engine.js';
import type { BeatEvent } from './events.js';
import { DENIAL_COPY } from './copy.js';
import {
  AGENT_TASK_LINE,
  CHILD_AGENT_ID,
  CHILD_CEILING_NATIVE,
  CHILD_OVERSPEND_NATIVE,
  CHILD_OVERSPEND_SERVICE,
  SCHEMA_FAMILY,
  SPEC_TASK_TEXT,
  TRANSFER_AMOUNT_NATIVE,
} from './task.js';
import { hashscanTopicUrl, hashscanTransactionUrl } from './hashscan.js';
import { arcExplorerTxUrl } from '../../layers/settlement/arcChain.js';

/** The account counterparty_risk (and its gated deep-report variant) is
 * queried against -- reused from the payments layer's own live-verify
 * script (layers/payments/live-verify.ts) rather than invented fresh, so
 * this run hits the exact same, already-proven path. */
const RISK_QUERY_ACCOUNT = '0.0.10523774';

export type DemoRunParams = {
  client: Client;
  config: FloatConfig;
  /** The gated counterparty_risk endpoint pay() should call — started by
   * run.ts before beats run (see resourceServer.ts). */
  gatedUrl: string;
};

export type DemoRunResult = {
  events: BeatEvent[];
  /** What this rehearsal actually spent, in each layer's own native unit --
   * printed by run.ts so an operator can track the ~35-unit budget without
   * re-deriving it from the event log by hand. */
  costs: {
    payLayerAmount: number | null; // amount pay() actually paid, 0 if it was denied
    grantLayerCeilingDelta: number; // the ceiling this run granted (may be a re-grant, not new spend)
    settlementLayerAmount: number; // always 0 while beat 5 stays denied at awaiting_device
  };
};

function parseToolResult<T>(result: Awaited<ReturnType<Client['callTool']>>): { ok: boolean; reason?: string; detail?: string; data?: T } {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

export async function runDemoBeats(params: DemoRunParams): Promise<DemoRunResult> {
  const { client, config, gatedUrl } = params;
  const events: BeatEvent[] = [];
  let compareSignalRef: string | null = null;
  const costs: DemoRunResult['costs'] = { payLayerAmount: null, grantLayerCeilingDelta: 0, settlementLayerAmount: 0 };

  // --- beat 1: task in ---
  events.push({
    beat: 1,
    label: 'task',
    ok: true,
    agentSummary: AGENT_TASK_LINE,
    auditor: { detail: SPEC_TASK_TEXT },
  });

  // --- beat 2: compare_markets — provenance beat ---
  {
    const result = parseToolResult<{
      rankedRates: Array<{ deploymentId: string; rate: number }>;
      coverage: { live: string[]; empty: unknown[]; dead: unknown[] };
      signalRef: string;
    }>(await client.callTool({ name: 'compare_markets', arguments: { schema_family: SCHEMA_FAMILY } }));

    if (result.ok && result.data) {
      compareSignalRef = result.data.signalRef;
      const top = result.data.rankedRates[0];
      const topPct = top ? `${(top.rate * 100).toFixed(2)}%` : 'none';
      events.push({
        beat: 2,
        label: 'compare_markets',
        ok: true,
        agentSummary: `ranked ${result.data.rankedRates.length} markets across ${result.data.coverage.live.length} pinned deployments; best rate ${topPct}`,
        auditor: {
          source: 'graph',
          ids: result.data.rankedRates.slice(0, 5).map((r) => r.deploymentId),
          detail: JSON.stringify(result.data.coverage),
        },
      });
    } else {
      events.push({
        beat: 2,
        label: 'compare_markets',
        ok: false,
        reason: result.reason as BeatEvent['reason'],
        agentSummary: DENIAL_COPY[(result.reason as keyof typeof DENIAL_COPY) ?? 'deployment_unavailable'],
        auditor: { source: 'graph', detail: result.detail },
      });
    }
  }

  // --- beat 3: pay — 402 challenge, pay within budget, receipt ---
  {
    const result = parseToolResult<{ tx: string; amountHbar: number; network: string }>(
      await client.callTool({ name: 'pay', arguments: { url: gatedUrl, max: '1' } }),
    );
    if (result.ok && result.data) {
      costs.payLayerAmount = result.data.amountHbar;
      events.push({
        beat: 3,
        label: 'pay',
        ok: true,
        agentSummary: `paid within budget; receipt ${result.data.tx}`,
        auditor: { source: 'hedera_hcs', ids: [result.data.tx], links: [hashscanTransactionUrl(result.data.tx)] },
      });
    } else {
      events.push({
        beat: 3,
        label: 'pay',
        ok: false,
        reason: result.reason as BeatEvent['reason'],
        agentSummary: DENIAL_COPY[(result.reason as keyof typeof DENIAL_COPY) ?? 'deployment_unavailable'],
        auditor: { source: 'hedera_hcs', detail: result.detail },
      });
    }
  }

  // --- beat 4: policy — root grants a child a sub-budget, child overspends ---
  {
    const grantResult = parseToolResult<{ ceiling_hbar: number; allowance_tx: string | null; account_id: string }>(
      await client.callTool({
        name: 'grant_budget',
        arguments: { child_id: CHILD_AGENT_ID, ceiling: CHILD_CEILING_NATIVE, scope: 'lending' },
      }),
    );
    if (grantResult.ok && grantResult.data) {
      costs.grantLayerCeilingDelta = grantResult.data.ceiling_hbar;
      events.push({
        beat: 4,
        label: 'grant_budget',
        ok: true,
        agentSummary: `granted a sub-budget to a child agent (ceiling ~$10 equivalent)`,
        auditor: {
          source: 'hedera_hts',
          ids: [grantResult.data.account_id, ...(grantResult.data.allowance_tx ? [grantResult.data.allowance_tx] : [])],
          links: grantResult.data.allowance_tx ? [hashscanTransactionUrl(grantResult.data.allowance_tx)] : [],
        },
      });
    } else {
      events.push({
        beat: 4,
        label: 'grant_budget',
        ok: false,
        reason: grantResult.reason as BeatEvent['reason'],
        agentSummary: DENIAL_COPY[(grantResult.reason as keyof typeof DENIAL_COPY) ?? 'deployment_unavailable'],
        auditor: { source: 'hedera_hts', detail: grantResult.detail },
      });
    }

    // The child's own overspend attempt — not an MCP tool call (see file
    // header); denied before any chain write either way.
    const overspend = await spend(config, {
      agentId: CHILD_AGENT_ID,
      amountHbar: CHILD_OVERSPEND_NATIVE,
      service: CHILD_OVERSPEND_SERVICE,
      toAccountId: RISK_QUERY_ACCOUNT,
    });
    if ('denied' in overspend) {
      events.push({
        beat: 4,
        label: 'child_spend',
        ok: false,
        reason: overspend.reason,
        agentSummary: `child agent's own request was ${DENIAL_COPY[overspend.reason]}; parent continues`,
        auditor: { source: 'hedera_hcs', detail: overspend.detail },
      });
    } else {
      // Should never happen given CHILD_OVERSPEND_NATIVE > CHILD_CEILING_NATIVE
      // — surfaced loudly rather than silently narrated as a denial that
      // didn't actually happen.
      throw new Error(
        `demo/agent: expected the child's overspend attempt to be denied, but it succeeded: ${JSON.stringify(overspend)}`,
      );
    }
  }

  // --- beat 5: transfer — over-float, stops for treasury authorization ---
  {
    const signalRef = compareSignalRef ?? 'sig_never_existed';
    const to = config.raw.PRIVY_WALLET_ADDRESS ?? RISK_QUERY_ACCOUNT;
    const result = parseToolResult<{ txHash: string; explorerUrl: string }>(
      await client.callTool({
        name: 'transfer_usdc',
        arguments: { to, amount: TRANSFER_AMOUNT_NATIVE, signal_ref: signalRef },
      }),
    );
    if (result.ok && result.data) {
      costs.settlementLayerAmount = Number(TRANSFER_AMOUNT_NATIVE);
      events.push({
        beat: 5,
        label: 'transfer',
        ok: true,
        agentSummary: `transfer settled citing beat 2's result; receipt ${result.data.txHash}`,
        auditor: { source: 'arc', ids: [result.data.txHash], links: [arcExplorerTxUrl(result.data.txHash)] },
      });
    } else {
      events.push({
        beat: 5,
        label: 'transfer',
        ok: false,
        reason: result.reason as BeatEvent['reason'],
        agentSummary: DENIAL_COPY[(result.reason as keyof typeof DENIAL_COPY) ?? 'deployment_unavailable'],
        auditor: { source: 'arc', detail: result.detail },
      });
    }
  }

  // --- beat 6: spend_history — every dollar accounted for ---
  {
    const result = parseToolResult<{ topicId: string; entries: Array<{ kind: string; tx?: string }> }>(
      await client.callTool({ name: 'spend_history', arguments: { agent_id: 'root' } }),
    );
    if (result.ok && result.data) {
      events.push({
        beat: 6,
        label: 'spend_history',
        ok: true,
        agentSummary: `read back ${result.data.entries.length} receipts for this run's activity`,
        auditor: { source: 'mirror_node', ids: [result.data.topicId], links: [hashscanTopicUrl(result.data.topicId)] },
      });
    } else {
      events.push({
        beat: 6,
        label: 'spend_history',
        ok: false,
        reason: result.reason as BeatEvent['reason'],
        agentSummary: DENIAL_COPY[(result.reason as keyof typeof DENIAL_COPY) ?? 'deployment_unavailable'],
        auditor: { source: 'mirror_node', detail: result.detail },
      });
    }
  }

  return { events, costs };
}
