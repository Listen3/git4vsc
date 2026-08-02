# Git4VSC

Git4VSC 是一个面向 VS Code 的本地 Git 工作流增强扩展。它希望把成熟桌面 IDE 中高密度、可观察、可逐步操作的 Git 体验带到 VS Code，同时继续使用 VS Code 原生的编辑器、Diff、Merge Editor、状态栏和命令体系。

项目使用本机 Git CLI，核心 Git 图、状态模型和界面均为独立的 TypeScript/React 实现。

> 当前版本：`0.1.0 Preview`。主要工作流已经可用，正在进行 Marketplace 首发前的文档、授权和发布准备。

## 为什么做 Git4VSC

VS Code 已经提供可靠的基础 Git 能力，但复杂仓库通常还需要更完整的提交窗口、分支操作、提交图、推送预览、更新策略和逐文件冲突处理。Git4VSC 将这些流程集中在三个稳定区域中：

- 左侧 Commit 工具窗口：查看、选择、回滚和提交本地变更。
- 底部 Git Log：浏览提交图、筛选历史并处理提交中的文件。
- 状态栏与分支菜单：查看 ahead/behind、冲突和长时间操作状态，并快速执行常用分支动作。

产品结构和交互逻辑参考了 JetBrains Git4Idea 与 IntelliJ Platform VCS Log 的公开行为和源码架构，但不复制其代码、商标、图标或专有素材。

## 当前完成度

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Commit 工具窗口 | 已完成 | 变更分组、文件选择、颜色状态、Rollback、可调整提交信息区域、Commit and Push |
| AI Commit Message | 已完成 | OpenAI-compatible API、自定义模型/语言/提示词、精确收集选中文件上下文、生成取消 |
| 分支与远程操作 | 已完成 | Checkout、Update、Merge、Rebase、Pull、Push、Tracking、Tag、Worktree 与 Remote 管理 |
| 仓库状态反馈 | 已完成 | ahead/behind、冲突、仓库阶段、后台操作进度和完成结果提示 |
| Commit Log | 已完成 | 拓扑提交图、当前分支默认选择、缓存详情、正则/大小写搜索、历史搜索、组合筛选与可选列 |
| 提交文件操作 | 已完成 | Diff、本地比较、仓库版本、Revert、选择性 Cherry-Pick、Patch、Get from Revision、Path History |
| Push Preview | 已完成 | 待推送提交、目录化文件树、目标分支编辑、Push / Force Push |
| Merge 冲突流程 | 已完成 | 逐文件冲突列表、三方 Merge Editor、Accept Current/Incoming、Continue、Abort |
| Git Blame | 已完成 | 编辑器行号右键开关、紧凑作者信息、按提交时间着色、Hover 详情 |
| 设置页面 | 已完成 | 紧凑的 General / AI 设置页，API Key 使用 VS Code SecretStorage |
| Stash / Shelf | 计划中 | 将在后续版本补充 |
| 完整国际化 | 计划中 | 当前 Marketplace 文档和主要界面以英语为主 |

### Marketplace 首发检查

- [x] Marketplace 英文说明、分类、关键词和 Preview 元数据
- [x] Marketplace PNG 图标
- [x] 类型检查、单元测试、真实 Git 仓库集成测试和 Extension Host 测试
- [ ] 确定并添加项目许可证
- [ ] 创建/确认 Marketplace Publisher，并确认 `publisher` 字段
- [ ] 添加使用截图或短演示（可选但推荐）

## 使用方式

### 提交本地变更

1. 打开 Git 仓库，在 Activity Bar 选择 **Git4VSC**。
2. 在 Commit 窗口勾选本次要提交的文件。
3. 双击文件查看 Diff，或右键执行 Rollback、Delete、Add to VCS、Add to Ignore 等操作。
4. 输入 Commit Message，然后点击 **Commit** 或 **Commit and Push**。
5. 如已配置 AI，可点击 Commit 按钮左侧的 AI 图标生成提交信息；未配置时点击灰色图标会直接打开 AI 设置。

### 查看提交历史

- 点击工具窗口标题栏的 Commit Log 图标，或按 `Alt+3` 打开/关闭 Git Log；再次打开会恢复上次状态，并默认聚焦当前分支。
- Text or hash 支持正则、大小写匹配和最近搜索；Branch、User、Date、Paths 可继续组合筛选。
- 选择提交后，在右侧查看变更文件和提交详情；文件支持多选与右键批量操作。
- 点击列设置图标控制 Author、Date 和 Hash 的显示。

### 更新、推送与分支操作

- 使用 Commit 工具窗口顶部的斜向下箭头更新当前分支，斜向上箭头推送。
- 更新支持 Merge 或 Rebase 策略，默认可在设置页中配置。
- 点击状态栏 Commit Log 图标打开/关闭日志；点击相邻的分支名打开仓库与分支操作菜单。
- Push 会先显示待推送提交和文件预览，并支持修改目标分支以及 Push / Force Push。

### 处理冲突

出现冲突后，Git4VSC 会显示逐文件冲突列表。可以逐个打开 VS Code Merge Editor，也可以接受 Current/Incoming；解决并标记当前文件后自动进入下一个文件，最后执行 Continue 或 Abort。

### 查看 Git Blame

在编辑器行号上右键选择 **Annotate with Git Blame**。注释显示相对时间和作者，颜色按提交新旧区分；再次执行即可关闭，未提交的新行保持空白。

## AI Commit Message

AI 功能完全可选。打开 **Git4VSC Settings → AI**，配置：

- OpenAI-compatible Base URL
- API Key
- Commit model
- 输出语言
- Additional instructions

API Key 保存在 VS Code SecretStorage 中。只有在用户主动点击生成时，扩展才会发送当前勾选文件的变更上下文；不会自动分析或上传整个仓库。

## 运行要求

- VS Code `1.102.0` 或更高版本
- Git `2.23` 或更高版本
- 一个本地或 Remote Workspace 中可由扩展主机访问的 Git 工作区

## 开发

要求 Node.js 20+、pnpm 11+ 和 Git 2.23+。

```bash
pnpm install
pnpm check
pnpm test:extension
pnpm package:vscode
```

工作区结构：

```text
packages/
  shared-types/   共享领域类型
  git-core/       Git CLI、状态、日志与补丁操作
  git-graph/      提交图布局和几何计算
  repo-state/     仓库状态、刷新与操作队列
  ui/             共享 React UI

apps/
  vscode-extension/
```

## 文档

- [总体架构](docs/architecture.md)
- [JetBrains Git/VCS Log 源码调研](docs/research/jetbrains-git-architecture.md)
- [VS Code 平台能力](docs/research/vscode-extension-capabilities.md)
- [功能对照矩阵](docs/research/feature-parity-matrix.md)
- [AI Commit 上下文调研](docs/research/ai-commit-context.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

## 声明

Git4VSC 是独立项目，与 JetBrains s.r.o. 或 Microsoft Corporation 不存在隶属或背书关系。JetBrains、IntelliJ、Git4Idea、Visual Studio Code 等名称归各自权利人所有。
