# AI commit message context

## Scope

This note covers commit message generation only. Push analysis is deliberately out of scope.

## What the previous implementation gets wrong

`git-repo-panel/public/preload/services.js` builds one patch per UI item, offers `files`, `summary`, and `full-diff` modes, then truncates the combined text at 60,000 characters. In summary mode it keeps only the first 25 lines of each patch; for untracked files it reads the complete file as text.

That produces context which is easy to build but not reliably equivalent to the commit:

- a staged item uses the index diff while another selected item uses the working-tree diff;
- the global prefix truncation can completely remove later files;
- the first 25 lines are not necessarily the important hunks;
- large or binary untracked files are read without a useful content policy;
- commit conventions and relevant original code are missing.

The UI should therefore not expose these implementation shortcuts as user-facing context modes.

## What VS Code Copilot currently does

The implementation inspected is Microsoft VS Code commit `7234ef01c2cace7cfa911d792ce9c5b1f333fca5`.

1. It refreshes Git status immediately before generation. If the index contains changes, it uses the index only; otherwise it falls back to working-tree and untracked changes. See [gitCommitMessageServiceImpl.ts](https://github.com/microsoft/vscode/blob/7234ef01c2cace7cfa911d792ce9c5b1f333fca5/extensions/copilot/src/extension/prompt/vscode-node/gitCommitMessageServiceImpl.ts#L82-L108).
2. It calculates a separate diff for every change. Index changes are compared with `HEAD`, working-tree changes with `HEAD`, and untracked files become addition patches. Content-excluded files are skipped. See [gitDiffService.ts](https://github.com/microsoft/vscode/blob/7234ef01c2cace7cfa911d792ce9c5b1f333fca5/extensions/copilot/src/extension/prompt/vscode-node/gitDiffService.ts#L90-L137).
3. It caps an untracked file at 1 MiB and each individual diff at 100,000 characters instead of applying one front-only limit to the entire commit. See [the size limits](https://github.com/microsoft/vscode/blob/7234ef01c2cace7cfa911d792ce9c5b1f333fca5/extensions/copilot/src/extension/prompt/vscode-node/gitDiffService.ts#L16-L28).
4. Its prompt includes the repository name, branch, the original source file, the change diff, five recent repository commit subjects, and five recent commits by the current user. Recent messages are style references and have lower priority than the changes. See [gitCommitMessagePrompt.tsx](https://github.com/microsoft/vscode/blob/7234ef01c2cace7cfa911d792ce9c5b1f333fca5/extensions/copilot/src/extension/prompts/node/git/gitCommitMessagePrompt.tsx#L31-L78) and [recent-message collection](https://github.com/microsoft/vscode/blob/7234ef01c2cace7cfa911d792ce9c5b1f333fca5/extensions/copilot/src/extension/prompt/vscode-node/gitCommitMessageServiceImpl.ts#L173-L194).

Microsoft's Source Control documentation describes the same product boundary: the generated message is based on staged changes, which are also the changes included by a normal Git commit. See [VS Code Source Control quickstart](https://github.com/microsoft/vscode-docs/blob/main/docs/sourcecontrol/quickstart.md#step-3-stage-and-commit).

## Git4VSC context contract

Git4VSC's Commit view is file-selection based. `commitPaths` stages the selected paths and commits only those paths, so blindly copying Copilot's “index first” rule would be incorrect when a selected file also has newer working-tree edits.

The generator should instead describe the exact proposed commit:

1. Freeze the selected file list when the user requests a message and refresh status.
2. Reject conflicts, and remove files that are no longer selected or no longer changed.
3. Build each selected tracked file's patch from `HEAD` to its current working-tree content. Preserve rename metadata and the original path. This matches the subsequent `git add <selected paths>` plus `git commit --only <selected paths>` workflow.
4. Represent selected untracked text files as new-file patches. For large or binary files, send only status, path, size, and a binary/omitted marker.
5. Send a complete manifest first (`status`, `path`, `originalPath`, additions/deletions), followed by one independently bounded patch per file. Never let one large file hide all later files.
6. Add repository name, branch name, five recent repository subjects, and five recent subjects by the current Git author as lower-priority style context.
7. Add original-code context only when it materially helps interpret a hunk and fits the remaining budget. The exact diff and file manifest have priority.
8. If the request is truncated, keep every selected file represented and mark exactly which files or hunks were omitted. The UI should disclose that the context was shortened.

## Proposed payload layers

| Priority | Context | Rule |
| --- | --- | --- |
| 1 | Selected-file manifest | Always include every selected file |
| 2 | Exact proposed-commit diffs | Per-file budget; preserve representative hunks |
| 3 | Original-code snippets | Hunk-adjacent text only when useful |
| 4 | Repository and branch | Always small |
| 5 | Recent commit subjects | Style reference only; drop first under pressure |
| 6 | User instructions and language | Always include |

The initial implementation should use this fixed contract. A user-facing context strategy setting can be reconsidered only if there is a real product need for a privacy/quality tradeoff; it should not expose accidental truncation behavior.

## Implementation sequence

1. Add a Git-core API that produces the proposed-commit manifest and per-file patches for selected paths without mutating the index.
2. Add binary, file-size, per-file, and total-token budgeting with explicit omission metadata.
3. Add an AI commit-message service that combines the context layers with language and custom instructions.
4. Add the generate action beside the Commit Message field and replace the field contents only after a successful explicit request.
5. Cover mixed staged/unstaged files, untracked files, deletion, rename, binary files, large diffs, and selection changes with integration tests.
