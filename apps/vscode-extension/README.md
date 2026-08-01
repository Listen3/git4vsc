# Git4VSC

Professional Git workflows for Visual Studio Code.  
面向 Visual Studio Code 的专业 Git 工作流增强扩展。

**[English](#english) · [简体中文](#简体中文)**

> 0.1.0 Preview — Core workflows are ready for daily evaluation. / 核心工作流已可用于日常体验，更多本地化与高级能力仍在持续完善。

## English

### Why Git4VSC?

VS Code provides a solid Git foundation, but larger repositories often benefit from a focused commit window, a topology-aware log, visible branch state, push previews, and guided file-by-file conflict resolution.

Git4VSC adds those workflows without replacing the editor. It uses the Git CLI available to the extension host and integrates with VS Code's native Diff viewer, Merge Editor, Source Control surface, status bar, commands, and SecretStorage.

### Core features

#### Commit workflow

- Compact Changes and Unversioned Files groups with clear file-state colors.
- Select exactly which files belong to the next commit.
- Adjustable commit-message area and selected-change summaries.
- Rollback, delete, jump to source, add to VCS, and add to ignore actions.
- Optional AI-generated commit messages based only on selected changes.

#### Topology-aware Git Log

- Commit graph with merge, octopus merge, and multiple-root support.
- Relative dates for recent commits and exact dates for older history.
- Text/hash, branch, author, date, and path filters.
- Configurable Author, Date, and Hash columns.
- Flat or directory-grouped commit file views.
- Diff, local comparison, repository version, selective revert/cherry-pick, patch export, revision restore, and path history actions.

#### Branches and repository state

- Checkout, create, rename, delete, merge, rebase, pull, push, and update branches.
- Manage tracked branches, tags, worktrees, and remotes.
- Ahead/behind, conflict, and operation indicators.
- Merge or Rebase update strategies with a configurable default.
- Push preview showing every outgoing commit and changed file before confirmation.

#### Conflict resolution

- Persistent unresolved-file list.
- Native three-way VS Code Merge Editor.
- Accept Current or Incoming for individual files.
- Resolve a file and automatically advance to the next conflict.
- Continue or abort merge, rebase, cherry-pick, and revert operations.

### Getting started

1. Open a folder containing a Git repository.
2. Select **Git4VSC** in the Activity Bar.
3. Choose files in the **Commit** view, enter a message, and select **Commit**.
4. Open or close Git Log from the view title or press Alt+3.
5. Use the diagonal down/up arrows to update or push the current branch.
6. Select the Git4VSC status bar item to open branches and repository actions.

| Interaction | Result |
| --- | --- |
| Double-click a changed file | Open its Diff |
| Right-click a file in Commit | Commit file, rollback, delete, jump to source, add to VCS, or ignore |
| Right-click a file in Commit Log | Compare, apply/revert changes, export a patch, restore a revision, or filter history |
| Ctrl/Cmd + click | Toggle files in a multi-selection |
| Shift + click | Select a contiguous range |
| Alt+3 | Toggle Commit Log |

### Optional AI commit messages

Open **Git4VSC Settings → AI** and configure an OpenAI-compatible endpoint, API key, model, output language, and optional instructions.

- The API key is stored in VS Code SecretStorage.
- AI is disabled until Base URL, API key, and model are configured.
- Clicking the gray AI icon opens AI settings directly.
- Context is collected only after you explicitly request a message.
- Only selected changes and limited recent commit-message style examples are sent.
- Click the generating icon again to cancel the request.

Git4VSC does not provide or bundle an AI service. Availability and cost depend on the endpoint you configure.

### Requirements and privacy

- Visual Studio Code 1.102.0 or newer.
- Git 2.23 or newer available to the extension host.
- A Git repository opened in the current workspace.
- No telemetry is included.
- AI requests are made only when you invoke generation and are sent only to your configured endpoint.

### Preview status

Commit, branch, remote, tag, worktree, update, pull, push preview, log, diff, merge, rebase, cherry-pick, revert, reset, conflict resolution, settings, and optional AI commit messages are available now.

Stash/shelf workflows, broader UI localization, and further large-repository optimization are planned for later releases.

---

## 简体中文

### 为什么做 Git4VSC？

VS Code 已经提供可靠的基础 Git 能力，但复杂仓库通常还需要更聚焦的提交窗口、拓扑提交图、清晰的分支状态、推送预览，以及可逐个文件推进的冲突解决流程。

Git4VSC 在保留 VS Code 编辑体验的基础上补齐这些工作流。扩展使用 Extension Host 可访问的 Git CLI，并复用 VS Code 原生 Diff、Merge Editor、Source Control、状态栏、命令和 SecretStorage。

### 核心功能

#### 提交工作流

- 紧凑的 Changes 与 Unversioned Files 分组，以及清晰的文件状态颜色。
- 精确选择本次提交包含的文件。
- 可拖动调整的 Commit Message 区域和选中变更统计。
- Rollback、Delete、Jump to Source、Add to VCS、Add to Ignore 等文件操作。
- 可选的 AI Commit Message，只分析当前勾选的变更。

#### 拓扑 Commit Log

- 支持 merge、octopus merge 和多 root 的提交图。
- 最近提交使用相对时间，更早记录显示准确日期。
- 支持文本/Hash、分支、用户、日期和 Paths 筛选。
- Author、Date、Hash 列可自由显示或隐藏。
- 提交文件可以平铺，也可以按目录分组。
- 支持 Diff、本地比较、仓库版本、选择性 Revert/Cherry-Pick、导出 Patch、Get from Revision 和路径历史。

#### 分支与仓库状态

- Checkout、创建、重命名、删除、Merge、Rebase、Pull、Push 和 Update。
- 管理 Tracking Branch、Tag、Worktree 和 Remote。
- 显示 ahead/behind、冲突和后台操作状态。
- 更新时可选择 Merge 或 Rebase，并能配置默认策略。
- Push 前预览所有待推送提交及变更文件，确认后才执行。

#### 逐文件解决冲突

- 持久显示未解决文件列表。
- 使用 VS Code 原生三方 Merge Editor。
- 对单个文件 Accept Current 或 Accept Incoming。
- 标记解决后自动进入下一个冲突文件。
- 支持 Continue 或 Abort merge、rebase、cherry-pick 和 revert。

### 快速开始

1. 打开包含 Git 仓库的文件夹。
2. 在 Activity Bar 选择 **Git4VSC**。
3. 在 **Commit** 窗口勾选文件、输入提交信息并点击 **Commit**。
4. 点击标题栏图标或按 Alt+3 打开/关闭 Git Log。
5. 使用斜向下/向上箭头更新或推送当前分支。
6. 点击 Git4VSC 状态栏项目，打开分支与仓库操作菜单。

| 操作 | 结果 |
| --- | --- |
| 双击变更文件 | 打开 Diff |
| 右键 Commit 文件 | 单文件提交、回滚、删除、跳转源码、加入版本控制或忽略 |
| 右键 Commit Log 文件 | 比较、应用/撤销变更、导出 Patch、恢复 Revision 或筛选历史 |
| Ctrl/Cmd + 点击 | 切换多选文件 |
| Shift + 点击 | 连续范围选择 |
| Alt+3 | 打开或关闭 Commit Log |

### 可选的 AI Commit Message

打开 **Git4VSC Settings → AI**，配置 OpenAI-compatible Base URL、API Key、模型、输出语言和额外提示词。

- API Key 保存在 VS Code SecretStorage。
- Base URL、API Key 和模型未配置完整时，AI 功能保持灰色不可用。
- 点击灰色 AI 图标会直接进入 AI 设置页。
- 只有用户主动点击生成时才收集上下文。
- 仅发送当前勾选文件的变更和少量历史提交风格示例。
- 生成过程中再次点击图标即可取消。

Git4VSC 不提供或捆绑 AI 服务，接口可用性和费用取决于用户配置的服务商。

### 运行要求与隐私

- VS Code 1.102.0 或更高版本。
- Extension Host 可访问 Git 2.23 或更高版本。
- 当前工作区已经打开 Git 仓库。
- 扩展不包含遥测。
- AI 请求仅在主动生成时发送，并且只发送到用户配置的接口。

### Preview 完成度

Commit、分支、Remote、Tag、Worktree、Update、Pull、Push Preview、Commit Log、Diff、Merge、Rebase、Cherry-Pick、Revert、Reset、冲突解决、设置页和可选 AI Commit Message 均已可用。

Stash/Shelf、更多界面国际化以及大仓库性能优化将在后续版本继续完善。

## Feedback / 反馈

- [Source repository / 源码仓库](https://gitee.com/nebxy/git4vsc)
- [Report an issue / 反馈问题](https://gitee.com/nebxy/git4vsc/issues)

Git4VSC is an independent project and is not affiliated with or endorsed by JetBrains s.r.o. or Microsoft Corporation. Git4VSC 是独立项目，与 JetBrains s.r.o. 或 Microsoft Corporation 不存在隶属或背书关系。
