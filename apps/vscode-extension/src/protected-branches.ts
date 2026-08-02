export function isProtectedBranch(branch: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => {
    const value = pattern.trim();
    if (!value) return false;
    const escaped = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    return new RegExp(`^${escaped}$`).test(branch);
  });
}
