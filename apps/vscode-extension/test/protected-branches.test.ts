import { describe, expect, it } from 'vitest';
import { isProtectedBranch } from '../src/protected-branches.js';

describe('protected branches', () => {
  it('matches exact names and wildcard patterns', () => {
    const patterns = ['main', 'release/*'];
    expect(isProtectedBranch('main', patterns)).toBe(true);
    expect(isProtectedBranch('release/2026.2', patterns)).toBe(true);
    expect(isProtectedBranch('feature/main-screen', patterns)).toBe(false);
  });
});
