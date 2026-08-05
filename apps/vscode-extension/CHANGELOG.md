# Changelog

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
