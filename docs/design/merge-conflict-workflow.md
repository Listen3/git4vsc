# Merge Conflict Workflow

## Source model

The implementation follows the behavior of JetBrains Git4Idea rather than treating `git merge` as a single opaque command:

- [`GitConflictResolver`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/merge/GitConflictResolver.java) repeatedly queries unmerged files, opens the multi-file resolver and only finishes when no conflicts remain.
- [`GitMergeProvider`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/merge/GitMergeProvider.java) reads index stages and marks an applied result resolved with `git add`.
- [`GitMergeUtil`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/merge/GitMergeUtil.java) maps stage 1/2/3 to Base/Current/Incoming, handles modify/delete conflicts and can restore the conflicted form with `git checkout -m`.
- [`GitConflictsView`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/conflicts/GitConflictsView.kt) keeps a persistent conflict list with Resolve, Accept Yours and Accept Theirs actions.
- VS Code's built-in Git extension opens the workbench merge editor with the same three index stages in [`commands.ts`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/commands.ts).

Git4VSC uses the VS Code Merge Editor for the actual three-way edit, while owning the Git state machine and conflict list itself.

## Runtime flow

1. A merge, pull, rebase, cherry-pick or revert command runs inside the repository operation queue.
2. A non-zero Git exit becomes an expected conflict result only when the refreshed snapshot contains unmerged paths.
3. `git ls-files --unmerged -z` builds an exact per-file model, including missing Current or Incoming stages for modify/delete conflicts.
4. `Merge Changes` and the `Git Merge` panel show only unresolved files.
5. Resolve opens stage 1 as Base, stage 2 as Current and stage 3 as Incoming, with the working-tree file as output, then switches the native Merge Editor to the Current / Result / Incoming column layout.
6. `Mark Resolved and Open Next` saves the output, stages it and opens the next unresolved file. Accept Current/Incoming performs checkout-or-delete plus staging in one repository operation.
7. After the last file, Continue finishes the active Git operation. Abort restores the pre-operation state.

Commit and Commit All are blocked while conflicts remain. Binary and modify/delete conflicts can always be resolved through the explicit side actions even when a text merge editor is not applicable.

The workbench `_open.mergeEditor` command is intentionally isolated in the VS Code adapter. The Extension Host test creates a real conflicted repository and verifies both stage-based editor opening and next-file advancement so a VS Code command contract change fails CI.
