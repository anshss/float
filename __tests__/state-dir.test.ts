import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectGit } from '../layers/policy/state.js';

// #16: the policy layer's bootstrap state must survive a `worktree:rm` — a
// treasury minted inside a worktree that later gets reaped loses its key
// forever (that's exactly what happened). detectGit is the mechanism that
// finds the main checkout from inside a linked worktree, with no hardcoded
// path or env var: it reads a linked worktree's `.git` file (not directory)
// back to `<main checkout>/.git/worktrees/<name>`.
describe('detectGit (#16 — locating the main checkout from a linked worktree)', () => {
  const dirs: string[] = [];
  function tempRepoRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'float-mcp-detectgit-'));
    dirs.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('a regular checkout (.git is a directory) is not treated as a worktree', () => {
    const root = tempRepoRoot();
    mkdirSync(join(root, '.git'));
    expect(detectGit(root)).toEqual({ kind: 'regular-checkout', mainCheckoutRoot: null });
  });

  it('a linked worktree (.git is a file) resolves the main checkout path', () => {
    const root = tempRepoRoot();
    writeFileSync(join(root, '.git'), 'gitdir: /Users/anshs/Folder/code/float/float-mcp/.git/worktrees/float-mcp3\n');
    expect(detectGit(root)).toEqual({
      kind: 'linked-worktree',
      mainCheckoutRoot: '/Users/anshs/Folder/code/float/float-mcp',
    });
  });

  it('a .git file that does not match the worktrees pattern is reported as unresolvable, never throws', () => {
    const root = tempRepoRoot();
    writeFileSync(join(root, '.git'), 'gitdir: ../something-else\n');
    expect(detectGit(root)).toEqual({ kind: 'linked-worktree', mainCheckoutRoot: null });
  });

  it('no .git at all is unknown, never throws', () => {
    const root = tempRepoRoot();
    expect(detectGit(root)).toEqual({ kind: 'unknown', mainCheckoutRoot: null });
  });
});
