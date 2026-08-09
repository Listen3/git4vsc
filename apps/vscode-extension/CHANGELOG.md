# Changelog

## 0.1.6 - 2026-08-09

- Added a Worktrees panel for creating, opening, locking, pruning, and safely removing linked worktrees.
- Added disk-backed Commit Log first-page caching with quiet background validation and repository prewarming.
- Added a Git Blame hover action that opens the blamed revision in Commit Log.
- Kept Git Blame annotations in a fixed left-side column for Markdown and wrapped documents instead of scattering labels through the text.
- Graduated Git4VSC from Preview for its stable Marketplace listing.

## 0.1.5 - 2026-08-07

- Added changelist group actions for editing, activating, and deleting lists.
- Added persistent empty changelist groups and single, Ctrl/Cmd, or Shift multi-file drag-and-drop between lists.
- Streamlined moving files when no other changelist exists by opening Create and Move directly.
- Made empty changelist deletion immediate, with a separate destination-aware confirmation for assigned files and result notifications for both flows.
- Stabilized changelist switching and tightened changelist, move, delete, and Reset dialogs for narrow panels.
- Fixed File History repository resolution for editor files and nested repositories.
- Kept custom dialogs centered and bounded when the Git Log panel becomes short.
- Loaded the selected repository first while discovering other workspace repositories in the background.
- Built Push Preview file trees with one batched Git query instead of per-commit detail requests.
- Changed the Activity Bar badge to show the selected repository's changed-file count while retaining the workspace total in its tooltip.
- Replaced the native repository selector with a compact themed menu showing cached ahead, behind, upstream, and changed-file status without extra Git queries.
- Accelerated whole-file commits and post-commit/push refreshes by avoiding temporary indexes, unused log reloads, duplicate Git Log requests, and redundant remote lookups.
- Removed outgoing-commit truncation and kept batched commit-file loading compatible with older Git versions.

## 0.1.3 - 2026-08-05

- Added workspace discovery for nested repositories up to three directory levels.
- Added rename-aware File History from the editor and line-number context menus.
- Made Commit Log columns adapt to the available panel width while preserving detail-column widths.
- Changed the Activity Bar badge to show uncommitted files across managed repositories, including deletions.
- Added repository-local Changelists with persistent active state, create/edit/delete management, file moves, and isolated commit selection.
- Added native-style single, Ctrl/Cmd multi-, and Shift range selection for Changelist context actions and drag-and-drop.

## 0.1.2 - Preview

- Fixed stale outgoing-commit badges remaining in the Activity Bar after a successful push.

## 0.1.1 - Preview

- Improved Commit Log startup, branch hierarchy, graph spacing, and column layout.
- Added live working-tree refresh while suppressing duplicate Git metadata events that could cause repeated refreshes on macOS.
- Kept partial-commit patch support internal and simplified the Commit file list to file-level selection.

## 0.1.0 - Preview

- Added a compact selected-file commit workflow and file context actions.
- Added Commit and Push with a narrow-layout push preview, target editing, directory grouping, and Force Push.
- Added optional AI-generated commit messages with secure API-key storage.
- Added branch, remote, tag, worktree, update, pull, and push workflows.
- Added a topology-aware Commit Log with cached details, persistent selection, regex/case search, path picking, configurable columns, and relative dates.
- Added commit-detail file actions, selective patch workflows, and push preview.
- Added guided file-by-file conflict resolution using the VS Code Merge Editor.
- Added compact Git Blame annotations from the editor line-number menu.
- Added split status-bar controls for Commit Log and branch actions, plus ahead/behind and operation feedback.
- Added General/AI settings and short operation result notifications.
