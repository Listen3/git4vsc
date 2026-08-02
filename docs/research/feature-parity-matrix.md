# Feature Parity Matrix

状态：`Done` 已在第一链路实现；`Next` 第二链路；`Planned` 后续；`Platform` 复用 VS Code 原生能力。

| 能力 | JetBrains 体验基准 | VS Code 目标 | 核心模块 | 当前状态 |
| --- | --- | --- | --- | --- |
| 仓库发现 | VCS roots/worktrees | workspace folders + 后续 nested roots | git-core/repo-state | Done（root）；nested Planned |
| 多仓库隔离 | 每 GitRepository 独立 | 每 root SourceControl/controller | repo-state | Done |
| HEAD/branch/upstream/ahead/behind | GitRepoInfo | SCM status/tree | shared-types/git-core | Done |
| local/remote refs/tags | branch model/tag holder | log badges/tree | git-core | Done（读取/徽标） |
| detached/shallow/operation phase | Repository.State | status/log header | git-core | Done |
| index/working/untracked | ChangeList | native SCM groups | status parser | Done |
| rename/copy/conflict parse | GitChangesCollector | SCM decoration | status parser | Done |
| 原生 Diff | platform Diff | `vscode.diff` | blob/diff API | Done（基础场景） |
| stage/unstage | changes actions | SCM context | GitClient/controller | Done |
| Commit staged/all | commit workflow | SCM input + progress | controller | Done |
| partial commit/changelist | commit workflow | selected files and Git hunks | temporary index transaction | Partial: hunks implemented; persistent changelists planned |
| hooks/GPG/amend/sign-off | commit options/detectors | options + diagnostics | commit use-case | Planned |
| Log topo order | VCS Log provider | Webview | git-core | Done |
| 分页/渐进加载 | first block + all hashes/details | Webview load more | controller | Done（offset pages） |
| 虚拟列表 | VcsLogGraphTable | fixed-row virtual list | ui | Done |
| permanent graph | PermanentGraph | Webview graph | git-graph | Done（v1） |
| visible filtered graph | VisibleGraph | filters/collapse | git-graph | Planned |
| stable lanes across pages/filters | graph layout index | stable graph | git-graph/log-store | Planned |
| merge/octopus/duplicate parents | graph engine | graph | git-graph | Done + tests |
| Fetch | fetch support/remote queue | progress/errors | operation use-case | Next |
| Pull merge/rebase | update process | progress/conflict | operation use-case | Next |
| Push/rejected update | push operation | progress/reject action | operation use-case | Next |
| Conflict continue/abort | platform Merge + operation | Merge Editor + actions | operation state | Done（逐文件会话、accept side、continue/abort） |
| Stash | stash tracker/cache | branch menu and commands | Git stash store | Implemented: create/apply/pop/drop/files/branch |
| Reset | reset operation/preview | QuickPick/confirm | reset use-case | Planned |
| Cherry-pick | sequence process | log context action | sequence use-case | Planned |
| Rebase | rebase process/editor | command + Webview plan | rebase state machine | Planned |
| worktree | repository files/holder | repository tree | discovery | Planned |
| submodule | repo info/updater | tree/status | repo-state | Planned |
| VS Code Extension Host test | N/A | official test-electron | adapter | Harness included |

## 第一条链路验收

`打开仓库 → status porcelain v2 → SCM changes → stage/commit → controller invalidates status/log/refs → concurrent refresh → topo log → permanent lanes → virtual React rows`

当前限制是 permanent graph 仍以已加载 pages 为输入。已有行在 load-more 后通常稳定，但要达到 JetBrains “完整永久图 + filtered visible graph”语义，需要后台先流式读取 all hashes/parents，metadata 仍分页；该项是下一次图里程碑，而不是在 renderer 中打补丁。

## 第二条链路验收定义

- Fetch/Pull/Push 产生结构化 progress event 和 per-repository result。
- authentication/rejected/non-fast-forward/local-overwrite/conflict 可区分，不只显示 stderr。
- pull 明确 merge/rebase policy；冲突时保留 operation state，提供 continue/abort。
- 完成、失败或 abort 后按结果精确 invalidates `status/refs/log`。
- 两个 repository 的远端操作可并发，同一 repository 的写操作串行。
