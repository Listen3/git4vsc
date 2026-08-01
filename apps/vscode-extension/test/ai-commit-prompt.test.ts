import { describe, expect, it } from 'vitest';
import { buildCommitPrompt, cleanGeneratedCommitMessage } from '../src/ai-commit-prompt.js';

describe('AI commit prompt', () => {
  it('keeps every selected file represented while bounding large diffs', () => {
    const prompt = buildCommitPrompt({
      repository: 'git4vsc',
      branch: 'main',
      language: 'English',
      instructions: 'Use Conventional Commits.',
      context: {
        files: [
          { path: 'first.ts', status: 'modified', diff: `start\n${'x'.repeat(80_000)}\nend`, truncated: false },
          { path: 'new.ts', status: 'added', diff: '+new', truncated: false }
        ],
        recentRepositoryMessages: ['feat: previous style'],
        recentUserMessages: ['fix: user style']
      }
    });

    expect(prompt).toContain('- modified: first.ts');
    expect(prompt).toContain('- added: new.ts');
    expect(prompt).toContain('characters omitted');
    expect(prompt).toContain('+new');
    expect(prompt).toContain('Use Conventional Commits.');
    expect(prompt.length).toBeLessThan(65_000);
  });

  it('removes an optional text fence from the generated message', () => {
    expect(cleanGeneratedCommitMessage('```text\nfeat: add AI commits\n```')).toBe('feat: add AI commits');
    expect(cleanGeneratedCommitMessage('fix: keep plain text')).toBe('fix: keep plain text');
  });
});
