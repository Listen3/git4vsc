# JetBrains Git/VCS Log 源码调研

调研时间：2026-07-29。源码基线为 JetBrains `intellij-community` 的 `master`。本文只记录产品与架构事实；本工程没有复制 JetBrains UI、图标或源码。对应实现均为 TypeScript 原创实现。

## 1. 边界：Git4Idea 与平台 VCS

Git4Idea 是 Git 适配器，负责命令、Git 格式解析、仓库语义和 Git 操作流程；IntelliJ Platform 提供通用的变更列表、提交工作流、更新/推送抽象、Diff/Merge UI、VCS Log 数据模型、永久图/可见图和单元格绘制。

| 能力 | JetBrains 所属 | 关键源码 | Git4VSC 对应 |
| --- | --- | --- | --- |
| Git 进程与认证 | Git4Idea backend | `commands/Git.java`, `GitImpl.java`, `GitHandler.java`, `GitLineHandler.java` | `packages/git-core/src/command-runner.ts`, `git-client.ts` |
| 命令结果/错误 | Git4Idea backend | `GitCommandResult.java`, `GitCompoundResult.java`, 各类 `*Detector` | `GitCommandError`, 后续 operation-specific parser |
| 仓库模型 | Git4Idea backend + DVCS 平台接口 | `repo/GitRepository.java`, `GitRepositoryImpl.kt`, `GitRepoInfo.kt` | `RepositoryStatus`, `RepositoryController` |
| 变更收集 | Git4Idea backend + ChangeList 平台 | `status/GitChangesCollector.java`, `GitChangeProvider.java` | `parsePorcelainV2`, VS Code SCM adapter |
| Commit/Push/Update 等流程 | Git4Idea backend，实现平台扩展点 | `checkin`, `push`, `update`, `fetch`, `rebase`, `stash`, `reset`, `cherrypick` | `RepositoryController` operation queue；阶段性增加 use-case |
| 日志 Git provider | Git4Idea backend | `log/GitLogProvider.kt`, `GitLogUtil` | `GitClient.log`, `parseLog` |
| 日志加载、过滤、索引 | 平台 `platform/vcs-log` | `VcsLogProvider`, `VcsLogData`, `PermanentGraph` | 后续 `LogStore`; 当前为分页 page/cache |
| 永久图、可见图、绘制元素 | 平台 `platform/vcs-log/graph` | `PermanentGraphImpl`, `GraphLayoutBuilder`, `EdgesInRowGenerator`, `PrintElementGeneratorImpl` | `packages/git-graph` |
| 最终 Swing 绘制 | 平台 `platform/vcs-log/impl` | `GraphCommitCellRenderer.kt`, `GraphCellPainter` | `packages/ui/src/CommitGraph.tsx` |

## 2. Git 命令执行、解析和错误

### 命令层

- [`GitImpl.java`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/commands/GitImpl.java) 是 `Git` facade 的主要实现。每个方法组装 `GitLineHandler`/`GitBinaryHandler`，设置参数、监听器和进度分析器，再统一执行。
- [`GitLineHandler.java`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/commands/GitLineHandler.java) 以行流式分派 stdout/stderr，适合长时间网络命令和检测器。
- [`GitCommandResult.java`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/commands/GitCommandResult.java) 分开保存 `startFailed`、exit code、authentication failure、stdout 和 stderr。源码明确指出非零退出码不必然等于业务错误；呈现错误时优先 stderr，再回退 stdout/exit code，并清理 `fatal:` 等前缀。
- `GitLocalChangesWouldBeOverwrittenDetector`、`GitUntrackedFilesOverwrittenByOperationDetector`、`GitRebaseProblemDetector` 等不是通用字符串兜底，而是针对具体操作的状态机/行检测器。
- 状态读取使用 `git status --porcelain -z`；push 使用 `--porcelain` 并安装 progress/auth listener；路径总在 `--` 之后传入。

本工程对应原则：`spawn(executable, args)`，不启 shell；stdout/stderr 分离；机器格式使用 NUL 分隔；`GitClient` 返回领域对象，UI 不接触原始命令。当前 `GitCommandError` 保留命令结果，第二链路会增加 fetch/push/rebase 的专用 progress/error parser。

### 变更解析

[`GitChangesCollector.java`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/status/GitChangesCollector.java) 按 dirty scope 调用 `git status --porcelain -z`，将 staged、working tree、rename/copy、unmerged、untracked 分到平台 `Change` 模型。相同路径可以同时存在 index 和 working tree 两个状态。

本工程采用更新的 `--porcelain=v2 -z --branch`：

- `1` 普通变更；`2` rename/copy 且下一个 NUL 字段是原路径；`u` 冲突；`?` 未跟踪。
- XY 的 X 是 index，Y 是 working tree，因此一个 `GitChange` 同时保留两面，VS Code adapter 再分别投影到 Staged/Changes/Untracked 资源组。
- `# branch.oid/head/upstream/ab` 同次读取 HEAD、branch、upstream、ahead/behind，避免多命令快照不一致。

## 3. GitRepository 模型与刷新

[`GitRepositoryImpl.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/repo/GitRepositoryImpl.kt) 将不可变的 [`GitRepoInfo.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/repo/GitRepoInfo.kt) 作为一次仓库快照。`readRepoInfo` 合并：

- config 中的 remotes 和 branch track info；
- reader 返回的 current branch/revision/state/local refs/remote refs；
- submodules、hooks、shallow 标志；
- 独立 holder 中的 tags、untracked、ignored/conflicts、worktrees。

[`GitRepositoryReader.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/repo/GitRepositoryReader.kt) 优先直接读 `.git/HEAD`、`refs`、`packed-refs`；reftable 时通过 `for-each-ref`。仓库 phase 通过 `MERGE_HEAD`、`rebase-apply`/`rebase-merge`、`CHERRY_PICK_HEAD`、`REVERT_HEAD` 和 sequencer 文件识别，并处理 detached HEAD、worktree gitdir 和 shallow 文件。

[`GitRepositoryUpdater.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/repo/GitRepositoryUpdater.kt) 监听 Git service files，将变化分类：

- HEAD/config/branch/packed-refs/rebase/merge → `repository.update()`；
- tags/packed refs/reftable → tag holder reload + repo change event；
- index/commit/head/gitignore → dirty root + untracked/conflict holder invalidation；
- worktrees → working tree holder reload。

这不是“每次全部重载”，而是事件驱动的失效集合。`GitChangesCollector.getHead` 在要求强一致时还会主动同步 `repository.update()`，避免异步 watcher 尚未捕获 HEAD 变化。

本工程 `RepositoryController` 对应不可变 `RepositorySnapshot`、`status/log/refs` invalidation set 和合并刷新；VS Code adapter 监听 `.git` 并 debounce。每个 controller 有自己的 operation queue、loading、error 和 commits cache，仓库 A 的 commit 不会阻塞仓库 B。

## 4. 操作流程

| 流程 | JetBrains 关键类 | 观察到的职责 | Git4VSC 路线 |
| --- | --- | --- | --- |
| Commit | `GitCheckinEnvironment.kt`, `GitRepositoryCommitter.kt` | 按 root 分组、准备 index、message file、amend/sign-off/hooks/author、检测 nothing-to-commit/GPG、提交后刷新 | 当前 staged/all commit；后续 partial commit 与 hooks/GPG 诊断 |
| Push | `GitPushOperation.java`, `GitPushNativeResultParser.java` | 按 repo/spec 执行、解析 porcelain、reject 后 update-and-push、跟踪/标签与通知 | 第二链路：progress event、reject 分类、逐仓库结果 |
| Fetch | `GitFetchSupportImpl.kt`, `GitRemoteOperationQueueImpl.kt` | remote operation queue、按 remote fetch、认证与 prune/options、结果聚合 | 第二链路；锁只属于 repository/remote |
| Pull/Update | `GitUpdateProcess.java`, `GitMergeUpdater`, `GitRebaseUpdater` | 保存本地改动、获取远端、为每 root 选 updater、处理冲突、恢复改动、聚合 root 结果 | 第二链路 use-case，不把 `git pull` 当黑盒 |
| Stash | `GitStashUtils.kt`, `GitStashTracker.kt`, `GitStashCache.kt` | push/list/apply/drop、reflog/log 格式解析、缓存刷新 | 第三阶段独立 stash store |
| Reset | `GitResetOperation.java` | 多 root、local-overwrite 检测、必要时 changes saver、执行后 VFS/状态刷新 | 第三阶段 typed mode + preview |
| Rebase | `GitRebaseProcess.java`, `GitRebaseProblemDetector.java`, `GitRebaseSpec.java` | published commit 检查、保存改动、逐 root 状态、冲突/continue/skip/abort、editor handler | 第三阶段显式 state machine |
| Cherry-pick | `GitCherryPicker.java`, `CherryPickProcess.kt` | 平台 picker 入口、按 root/顺序执行、冲突继续与空提交策略 | 第三阶段 sequence state machine |

共同模式是“前置检查 → 保存/冻结必要状态 → Git 命令 → 结构化结果 → 冲突/恢复分支 → 精确刷新”，而不是 UI 直接执行字符串。危险操作必须显示目标、mode 和影响范围。

## 5. Log 加载、过滤和刷新

[`GitLogProvider.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/log/GitLogProvider.kt) 实现平台 `VcsLogProvider`：

- `readFirstBlock` 请求目标数量的两倍，读取 `HEAD --branches --remotes`，故意不默认加 `--tags`（大量 tag 会显著拖慢），再用平台 `VcsLogSorter.sortByDateTopoOrder` 排序并截断。
- refresh refs 时先 `repository.update()`，合并平台创建的 branch refs；新 tag 指向首屏外 commit 时单独补读 tagged branch。
- `readAllHashes` 用 `LOG_ALL + --date-order` 流式输出 timed commits、refs、users，随后平台建立完整永久图/索引。
- `readFullDetails` 与 `readMetadata` 按 hash 延迟加载，merge diff 明确按 parents 读取。
- filter 由 provider 翻译成 Git 参数；根仓库变化和 tag holder 事件通过 `subscribeToRootRefreshEvents` 触发 VCS Log refresher。

本工程第一链路用 `git log --all --topo-order --date-order --parents --decorate=full -z`，按 `offset/limit` 渐进读取 metadata。下一步会把“all hashes permanent graph”和“visible page/details”拆成两个 cache，避免分页边界改变已有 lane。

## 6. 永久图、可见图和绘制

JetBrains 图能力位于平台而非 Git4Idea：

1. commits 先形成 parent 指向的 permanent linear graph；`DuplicateParentFixer` 对重复 parent 输入规范化。
2. [`GraphLayoutBuilder.kt`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/permanent/GraphLayoutBuilder.kt) 合并显式 branch heads 与图 heads，经 comparator 排序，再从每个未布局 head 向 down node DFS；每段分配 layout index，保存 important heads。
3. filter/collapse 后形成 visible linear graph；永久 layout 仍提供稳定顺序/颜色依据。
4. [`EdgesInRowGenerator.java`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/EdgesInRowGenerator.java) 从上下邻近 cache block 行走，维护穿越该行的 edge set；默认最大 walk 1000，block 40，避免每行全图扫描。
5. [`PrintElementGeneratorImpl.kt`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt) 将该行 node、normal/special edges 排序，分别生成 up/down/terminal element；node 最后加入以覆盖 edge。长边只显示两端并加方向箭头。
6. [`GraphCommitCellRenderer.kt`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render/GraphCommitCellRenderer.kt) 负责表格 cell、refs 标签、文本和 painter 的组合，不决定拓扑。

本工程当前永久图的原创算法用“期望 commit id lane 列表”：首 parent 延续当前 lane，已出现 parent 收拢到既有 lane，其余 parents 从节点中心分叉到相邻 lane；每行保存 before/after lane 与 parent/through connections，geometry 再生成上下半行坐标。它已覆盖重复 parent、merge、octopus、多 root/孤立 head；筛选可见图与跨分页永久稳定性列入下一里程碑。

## 7. VCS Log 三栏交互实现

本轮基于本地 `intellij-community` 源码定位了 Log 主界面的实际组合方式，而不是按截图拼 UI：

| 区域/行为 | JetBrains 关键源码与职责 | Git4VSC 对应模块 |
| --- | --- | --- |
| 中央提交表和右侧详情 | `platform/vcs-log/impl/.../ui/frame/MainFrame.java` 组合 `VcsLogGraphTable`、`CommitDetailsLoader`、`VcsLogAsyncChangesTreeModel`、`VcsLogChangesBrowser` 和 `CommitDetailsListPanel`，选择提交后异步加载详情与文件变更 | `packages/ui/src/CommitLog.tsx`、`CommitDetailsPane.tsx`；`apps/vscode-extension/src/log-panel.ts` 负责请求并发、选择态和渐进加载 |
| 左侧分支树 | `plugins/git4idea/backend/src/ui/branch/dashboard/BranchesInGitLogUiFactoryProvider.kt` 用 splitter 把分支面板装配到 `MainFrame`；分支选择通过 `VcsLogFilterUiEx.filterBy` 执行过滤或定位 | `packages/ui/src/BranchSidebar.tsx`；选择 ref 后向 extension host 发送受控查询 |
| 分支分组/筛选 | `BranchesDashboardTreeComponent.kt`、`BranchesDashboardTreeModel.kt`、`BranchesDashboardFilteringLogic.kt` 组织 Local、Remote、Tags 和搜索；`BranchesDashboardActions.kt` 从 Action DataContext 取得仓库与选中 ref | `BranchSidebar.tsx` 本地构建树和搜索；`log-panel.ts` 校验 ref 后执行 checkout/create/merge 等动作 |
| 提交详情 | `platform/vcs-log/impl/.../ui/details/commit/CommitDetailsPanel.kt` 展示完整 message、hash、author、refs、tag 和 containing branches | `packages/shared-types` 的 `CommitDetails`；`GitClient.commitDetails()`；`CommitDetailsPane.tsx` |
| 提交/分支右键动作 | `GitLogSingleCommitAction.java` 和 `GitLogBranchOperationsActionGroup.java` 依赖 Action System 按 commit/ref/repository 动态启用操作 | `ContextMenu.tsx` 只呈现 intent；`log-panel.ts` 做输入、确认和通知；`RepositoryController` 用单仓库 operation queue 串行化写操作 |
| 文件 Diff | JetBrains 复用平台 Changes Browser/Diff API，不在 Git4Idea UI 内渲染 diff | `GitContentProvider` 提供不可变 revision 内容，`log-panel.ts` 调用原生 `vscode.diff` |

当前实现保留了同样的职责边界：React 只管理可见选择、尺寸和菜单；Git CLI、参数校验、确认、刷新与错误反馈全部位于 extension host 和共享核心。没有复制 Swing 代码、图标或 JetBrains 品牌素材。

## 8. Diff、冲突、未跟踪、多仓库

- Git4Idea 将变更采集交给 Git backend，把 Diff/Merge viewer、ChangeList、dirty scope 交给平台。
- 未跟踪/忽略/已解决冲突使用独立 holder 和 invalidation，避免每次全盘扫描。
- operation 类几乎都按 `GitRepository` 聚合结果。跨 root 有 compound result，但单 repository 状态和命令上下文不共享。
- 本工程同样让 core 只返回 path/status/content；VS Code 用 `TextDocumentContentProvider + vscode.diff`；冲突 state machine 属于操作层，不塞进 renderer。

## 9. 官方源码索引

- [Git4Idea backend](https://github.com/JetBrains/intellij-community/tree/master/plugins/git4idea/backend/src)
- [Git 命令层](https://github.com/JetBrains/intellij-community/tree/master/plugins/git4idea/backend/src/commands)
- [仓库状态](https://github.com/JetBrains/intellij-community/tree/master/plugins/git4idea/backend/src/repo)
- [GitLogProvider](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/log/GitLogProvider.kt)
- [平台 VCS Log](https://github.com/JetBrains/intellij-community/tree/master/platform/vcs-log)
- [平台 Commit Graph](https://github.com/JetBrains/intellij-community/tree/master/platform/vcs-log/graph)
