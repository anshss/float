// The auditor's view. This is the ONE place chain names, deployment ids,
// account ids and explorer links appear -- the presentation rule's other
// half: "chains appear exactly once, in the auditor's view, when receipts
// come back with HashScan and arcscan links."
import type { BeatEvent } from './events.js';

export function renderAuditorView(events: BeatEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    lines.push(`[beat ${event.beat}] ${event.label} — ${event.ok ? 'ok' : `denied (${event.reason})`}`);
    if (event.auditor.source) lines.push(`  source: ${event.auditor.source}`);
    if (event.auditor.detail) lines.push(`  detail: ${event.auditor.detail}`);
    for (const id of event.auditor.ids ?? []) lines.push(`  id: ${id}`);
    for (const link of event.auditor.links ?? []) lines.push(`  link: ${link}`);
  }
  return lines;
}
