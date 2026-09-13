// The agent's rendered view. Presentation rule (spec, "Demo script"):
// ZERO chain/asset names -- only the four verbs `pay`, `transfer`, `denied`,
// `awaiting_device`, plus each tool's own name where that name itself
// carries no banned token (`transfer_usdc` does -- it is always rendered as
// `transfer`, never by its tool name).
import type { BeatEvent } from './events.js';
import { assertAgentSafe } from './sanitize.js';

const VERB_BY_LABEL: Record<BeatEvent['label'], string> = {
  task: 'task',
  compare_markets: 'compare_markets',
  pay: 'pay',
  grant_budget: 'grant_budget',
  child_spend: 'child_spend', // the child's own attempt, not an MCP tool -- see runner.ts
  transfer: 'transfer', // never "transfer_usdc" -- that name itself carries a banned token
  spend_history: 'spend_history',
};

export function renderAgentView(events: BeatEvent[]): string[] {
  return events.map((event) => {
    const verb = event.ok ? VERB_BY_LABEL[event.label] : event.reason === 'awaiting_device' ? 'awaiting_device' : 'denied';
    const line = `[beat ${event.beat}] ${verb} — ${event.agentSummary}`;
    return assertAgentSafe(line);
  });
}
