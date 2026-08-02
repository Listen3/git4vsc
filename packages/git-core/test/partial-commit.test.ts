import { describe, expect, it } from 'vitest';
import { parseFilePatch, selectPatchHunks } from '../src/partial-commit.js';

const patch = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 one
-two
+second
 three
@@ -20,2 +20,3 @@
 twenty
+twenty-one
 end
`;

describe('partial commit patches', () => {
  it('parses stable hunk metadata and rebuilds selected hunks', () => {
    const parsed = parseFilePatch(patch);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0]).toMatchObject({ id: '1:3:1:3:0', additions: 1, deletions: 1 });
    expect(parsed.hunks[1]).toMatchObject({ id: '20:2:20:3:1', additions: 1, deletions: 0 });

    const selected = selectPatchHunks(patch, new Set([parsed.hunks[1]!.id]));
    expect(selected).not.toContain('-two');
    expect(selected).toContain('+twenty-one');
  });
});
