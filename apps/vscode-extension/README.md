# Git4VSC

Focused Git workflows for Visual Studio Code.
面向 Visual Studio Code 的紧凑 Git 工作流扩展。

**[English](#english) · [简体中文](#简体中文)**

> `0.1.0 Preview` — The main commit, history, branch, push, and conflict workflows are ready for evaluation.

## English

Git4VSC brings a focused commit window, a topology-aware log, branch status, push previews, and guided conflict resolution to VS Code while continuing to use its native editor, Diff viewer, and Merge Editor.

### Features

- **Commit:** Select files, review diffs, resize the message area, roll back changes, or use Commit and Push.
- **AI message:** Generate a commit message from selected changes through your own OpenAI-compatible endpoint.
- **Commit Log:** Browse the graph, keep selections across reloads, and search by text/hash, branch, author, date, or path.
- **Push and update:** Preview outgoing commits and files, Push or Force Push, and update with Merge or Rebase.
- **Branches:** Manage local/remote branches, tracking, tags, remotes, and worktrees with ahead/behind indicators.
- **Conflicts:** Resolve files one by one in the VS Code Merge Editor, then continue or abort the Git operation.
- **Git Blame:** Right-click editor line numbers to show compact, time-colored author annotations.
- **File actions:** Compare, revert, cherry-pick selected changes, export patches, restore revisions, and inspect path history.

### Getting started

1. Open a folder containing a Git repository.
2. Select **Git4VSC** in the Activity Bar.
3. Choose files, enter a message, then select **Commit** or **Commit and Push**.
4. Press `Alt+3` or select the status-bar Commit Log icon to toggle Commit Log.
5. Select the status-bar branch name to open repository and branch actions.

| Interaction | Result |
| --- | --- |
| Double-click a changed file | Open Diff |
| Right-click a Commit file | Commit, rollback, delete, open, add, or ignore |
| Right-click a Commit Log file | Compare, revert/apply, export, restore, or inspect history |
| Right-click editor line numbers | Toggle Git Blame annotations |
| Ctrl/Cmd or Shift + click | Multi-select files |
| `Alt+3` | Toggle Commit Log |

### AI and privacy

Open **Git4VSC Settings → AI** to configure a Base URL, API key, model, language, and optional instructions. The key is stored in VS Code SecretStorage. Git4VSC sends selected change context only when you request generation and includes no telemetry.

### Requirements

- Visual Studio Code `1.102.0` or newer.
- Git `2.23` or newer available to the extension host.
- A Git repository opened in the current workspace.

Stash/Shelf workflows and broader UI localization are planned for later releases.

---

## 简体中文

Git4VSC 为 VS Code 补充聚焦的提交窗口、拓扑日志、分支状态、Push 预览和逐文件冲突流程，同时继续使用原生编辑器、Diff 和 Merge Editor。

### 功能

- **提交：** 勾选文件、查看 Diff、调整消息区、回滚变更，并支持 Commit and Push。
- **AI 消息：** 通过自有 OpenAI-compatible 服务，根据选中变更生成提交信息。
- **Commit Log：** 浏览拓扑图，刷新后保留选择，并按文本/Hash、分支、用户、日期或路径筛选。
- **推送与更新：** 预览待推送提交和文件，支持 Push、Force Push，以及 Merge/Rebase 更新。
- **分支：** 管理本地/远程分支、Tracking、Tag、Remote 和 Worktree，并显示 ahead/behind。
- **冲突：** 在 VS Code Merge Editor 中逐个解决文件，然后 Continue 或 Abort Git 操作。
- **Git Blame：** 右键编辑器行号，显示紧凑且按提交时间着色的作者注释。
- **文件操作：** 比较、选择性 Revert/Cherry-Pick、导出 Patch、恢复 Revision 和查看路径历史。

### 快速开始

1. 打开包含 Git 仓库的文件夹。
2. 在 Activity Bar 选择 **Git4VSC**。
3. 勾选文件、输入提交信息，然后选择 **Commit** 或 **Commit and Push**。
4. 按 `Alt+3` 或点击状态栏 Commit Log 图标，打开/关闭 Commit Log。
5. 点击状态栏分支名，打开仓库与分支操作菜单。

| 操作 | 结果 |
| --- | --- |
| 双击变更文件 | 打开 Diff |
| 右键 Commit 文件 | 提交、回滚、删除、打开、加入版本控制或忽略 |
| 右键 Commit Log 文件 | 比较、应用/撤销、导出、恢复或查看历史 |
| 右键编辑器行号 | 打开或关闭 Git Blame |
| Ctrl/Cmd 或 Shift + 点击 | 多选文件 |
| `Alt+3` | 打开或关闭 Commit Log |

### AI 与隐私

打开 **Git4VSC Settings → AI** 配置 Base URL、API Key、模型、语言和额外指令。API Key 保存在 VS Code SecretStorage；只有主动生成时才会发送选中变更上下文，扩展不包含遥测。

### 运行要求

- Visual Studio Code `1.102.0` 或更高版本。
- Extension Host 可访问 Git `2.23` 或更高版本。
- 当前工作区已经打开 Git 仓库。

Stash/Shelf 和更完整的界面国际化将在后续版本继续完善。

## Feedback / 反馈

- [Source repository / 源码仓库](https://gitee.com/nebxy/git4vsc)
- [Report an issue / 反馈问题](https://gitee.com/nebxy/git4vsc/issues)

Git4VSC is an independent project and is not affiliated with or endorsed by JetBrains s.r.o. or Microsoft Corporation. Git4VSC 是独立项目，与 JetBrains s.r.o. 或 Microsoft Corporation 不存在隶属或背书关系。
