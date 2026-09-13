import { describe, it, expect } from 'vitest';
import { renderAgentView } from '../view.js';
import { renderAuditorView } from '../auditorView.js';
import type { BeatEvent } from '../events.js';

const sampleEvents: BeatEvent[] = [
  { beat: 1, label: 'task', ok: true, agentSummary: 'rebalance idle stablecoin balance...', auditor: {} },
  {
    beat: 2,
    label: 'compare_markets',
    ok: true,
    agentSummary: 'ranked 5 markets across 5 pinned deployments; best rate 4.10%',
    auditor: { source: 'graph', ids: ['QmDeploymentId1'] },
  },
  {
    beat: 3,
    label: 'pay',
    ok: false,
    reason: 'ceiling_exceeded',
    agentSummary: 'denied — over the agreed spending ceiling',
    auditor: { source: 'hedera_hcs', detail: 'challenge amount 5 HBAR exceeds max 1 HBAR' },
  },
  {
    beat: 5,
    label: 'transfer',
    ok: false,
    reason: 'awaiting_device',
    agentSummary: 'awaiting_device — exceeds the available float; treasury authorization required',
    auditor: { source: 'arc', detail: 'requested 25 USDC exceeds hot wallet float' },
  },
];

describe('renderAgentView', () => {
  it('renders one line per event, in order', () => {
    const lines = renderAgentView(sampleEvents);
    expect(lines).toHaveLength(sampleEvents.length);
    expect(lines[0]).toContain('[beat 1]');
    expect(lines[3]).toContain('[beat 5]');
  });

  it('uses "denied" for a non-awaiting_device denial and "awaiting_device" for that one', () => {
    const lines = renderAgentView(sampleEvents);
    expect(lines[2]).toMatch(/\[beat 3\] denied —/);
    expect(lines[3]).toMatch(/\[beat 5\] awaiting_device —/);
  });

  it('never renders "transfer_usdc" — only the bare "transfer" verb', () => {
    const lines = renderAgentView(sampleEvents).join('\n');
    expect(lines).not.toMatch(/transfer_usdc/i);
  });

  it('never leaks a chain/asset name even from an auditor-only detail field', () => {
    const lines = renderAgentView(sampleEvents).join('\n');
    for (const token of ['hedera', 'arc', 'graph', 'sepolia', 'hbar', 'usdc']) {
      expect(lines.toLowerCase()).not.toContain(token);
    }
  });

  it('throws rather than silently rewriting if a caller ever passes an unsafe agentSummary', () => {
    const unsafe: BeatEvent[] = [{ beat: 9, label: 'pay', ok: true, agentSummary: 'paid via Hedera', auditor: {} }];
    expect(() => renderAgentView(unsafe)).toThrow();
  });
});

describe('renderAuditorView', () => {
  it('is allowed to show chain names, source, ids and the raw detail', () => {
    const lines = renderAuditorView(sampleEvents).join('\n');
    expect(lines).toContain('source: graph');
    expect(lines).toContain('source: hedera_hcs');
    expect(lines).toContain('source: arc');
    expect(lines.toLowerCase()).toContain('usdc');
  });
});
