import { describe, it, expect } from 'vitest';
import { listAllSubgraphs, findSubgraph, demoCoreEntries, DEMO_CORE_SLUGS } from '../registry.js';

describe('registry loader', () => {
  it('loads the vendored registry with unique slugs', () => {
    const all = listAllSubgraphs();
    expect(all.length).toBeGreaterThan(50);
    const slugs = all.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('resolves every demo-core slug to a schemaVersion 3.1.0 entry', () => {
    const entries = demoCoreEntries();
    expect(entries).toHaveLength(DEMO_CORE_SLUGS.length);
    for (const entry of entries) {
      expect(entry.schemaVersion).toBe('3.1.0');
    }
  });

  it('returns null for an unknown slug', () => {
    expect(findSubgraph('does-not-exist')).toBeNull();
  });
});
