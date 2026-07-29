# VS Code 与 uTools 平台能力调研

调研时间：2026-07-29；VS Code 实现目标基线为 1.102。链接指向官方文档及 Microsoft VS Code 内置 Git 扩展源码。

## VS Code Source Control API

官方 [Source Control API](https://code.visualstudio.com/api/extension-guides/scm-provider) 是 slim provider API，适合承载 Git 的原生基础体验：

- `vscode.scm.createSourceControl(id, label, rootUri)`：每个仓库一个 provider，天然支持 multi-root。
- `SourceControlResourceGroup`：将同一路径分别投影到 staged/index 与 working tree；相同文件可同时出现在两组。
- `SourceControlResourceState.command/decorations`：点击打开 Diff，显示状态装饰。
- `SourceControl.inputBox` 与 `acceptInputCommand`：原生 commit message 输入和 Ctrl/Cmd+Enter 接受动作。
- `quickDiffProvider + TextDocumentContentProvider`：提供原始内容后由 VS Code 绘制 gutter quick diff。
- `scm/title`、`scm/repository`、`scm/sourceControl`、`scm/resourceGroup/context`、`scm/resourceState/context`、`scm/change/title`：原生 toolbar/context menu；`when` 使用 `scmProvider` 与 `scmResourceGroup`。
- SCM resource context 支持 multi-select，命令应接收多个 resource state。

边界：SCM API 不提供 commit DAG、拓扑 lane、日志分页、rebase editor 或自定义复杂表格。它也不是对内置 Git extension 私有 UI 的扩展点。因此 Git4VSC 自建 provider/核心，不能依赖内置 Git 私有对象来承载全部功能。

## 内置 Git 扩展可借鉴的边界

- [`extensions/git/src/repository.ts`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/repository.ts)：单仓库命令 facade、状态组、操作枚举/队列、事件与 watcher。
- [`extensions/git/src/model.ts`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/model.ts)：仓库发现、多 root model、open/close/change events。
- [`extensions/git/src/api/git.d.ts`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts)：内置 Git extension 对其他扩展暴露的 API（repository、state、refs、diff 等）。该 API 可用于互操作，但不是本工程共享 core 的基础，否则 uTools 无法复用且能力受内置扩展版本限制。

本工程选择：本机 Git CLI 是事实源；VS Code adapter 使用公共 `vscode` API。后续可选读取 `vscode.git` API 做“避免重复 provider”的兼容模式，但核心不依赖它。

## TreeView、Activity Bar、命令和菜单

官方 [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view) 提供 `TreeDataProvider`、`onDidChangeTreeData`、`createTreeView/registerTreeDataProvider`，适合仓库列表、branches、stash、remotes、worktrees 和 conflicts。`TreeItem.contextValue` 配合 `view/item/context` 提供原生菜单。

[Views UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/views) 要求视图数量少、优先 TreeView、使用 product icons、避免把 TreeItem 当按钮。Activity Bar 容器通过 `contributes.viewsContainers.activitybar` 注册，但复杂页面不应点击 Activity Bar 就直接开编辑器 Webview。

[Contribution Points](https://code.visualstudio.com/api/references/contribution-points) 提供 commands、menus、keybindings、views、viewsContainers、viewsWelcome。命令默认进入 Command Palette；快捷键必须通过 `when` 限定上下文，不覆盖常见 Git/编辑快捷键。因此 0.1 不贡献默认全局快捷键，只使用 SCM 自带 Ctrl/Cmd+Enter。

## Webview/WebviewView

官方 [Webview API](https://code.visualstudio.com/api/extension-guides/webview) 将 webview 定义为与 extension host 通过 message passing 通信的隔离 iframe；[Webview UX](https://code.visualstudio.com/api/ux-guidelines/webviews) 明确要求只在原生 API 不足时使用、完全主题化、支持键盘/ARIA、不要重复现有原生功能。

适用：Commit Log/DAG、提交详情、多列虚拟表格、interactive rebase plan、复杂 conflict summary。

不适用：基础 changes、按钮式仓库列表、普通设置、通知。当前实现因此使用：

- SCM：changes/staged/untracked + commit input；
- TreeView：repositories；
- editor Webview：Commit Log；
- `--vscode-*` theme variables 和 CSP，Webview 只能发 `refresh/loadMore/ready` 等 typed intent，不能发任意 Git args。

## Diff 和文件内容

- `vscode.diff` 打开原生 Diff editor。
- `workspace.registerTextDocumentContentProvider` 为 `HEAD:path`、`:path` 提供只读虚拟内容；右侧可使用真实 working tree URI。
- Quick Diff 可复用同一 provider。
- Merge conflict 首选 VS Code Merge Editor/命令与 diagnostics；自定义 Webview 只做流程汇总，避免重造编辑器。

## Extension Host 与平台限制

- desktop extension host 能使用 Node `child_process`，因此可调用本机 Git；web extension/browser worker 不能使用 Node，也不能满足本机 Git CLI 要求。本工程仅发布 desktop extension。
- Remote Development 下 extension 可能运行在 remote extension host；`git` 和 workspace path 都属于远端。不能假定 Windows 客户端路径或本机终端。
- `workspace.fs`、URI、`env.openExternal` 和 `window.createTerminal({ cwd })` 应替代安装路径硬编码。
- VS Code watcher 可能合并/漏掉瞬时事件，因此事件只触发 invalidation，最终状态仍由 Git 命令重读。

## uTools preload 与 React 安全通信

官方 [preload 文档](https://www.u-tools.cn/docs/developer/information/preload.html) 说明：

- `plugin.json.preload` 指向 CommonJS 文件；它能使用 Node.js 与 Electron renderer API。
- 前端通过 preload 挂到 `window` 的属性调用本机能力。
- preload 与引入的第三方模块必须保持源码清晰可读，不允许压缩、混淆；发布时源码一起提交。

官方 [`plugin.json` 文档](https://www.u-tools.cn/docs/developer/information/plugin-json.html) 定义 `main/logo/preload/features`，并允许 `files` 匹配目录。

本工程安全规则：

1. `preload.cjs` 保持手写、未打包 CommonJS。
2. 只暴露 `open/refresh/stage/commit/loadMore/chooseRepository`，不暴露 `exec`、`spawn`、fs 或任意 Git 参数。
3. path/message/array 在 preload 边界校验；core 使用参数数组和 `--`，不启 shell。
4. React 只能发送领域 intent；repository 必须先由 `open` 注册，后续用已知 root 查询。
5. 生产打包需要把共享包的可读产物与许可证一同包含，不能把 preload dependency 压成不可审计 bundle。

## 能力映射

| 产品区域 | VS Code | uTools | 共享层 |
| --- | --- | --- | --- |
| 变更/暂存 | SCM groups + native Diff | React changes sidebar | status parser, GitClient |
| Commit input | SCM input box | React textarea | RepositoryController.commit |
| 仓库列表 | Activity Bar TreeView | workspace/repository React list | RepositoryManager |
| Commit Log | editor Webview | main React view | log parser, git-graph, ui |
| 文件内容/Diff | content provider + `vscode.diff` | shared Diff（后续） | blob/diff command API（后续） |
| 操作进度 | `withProgress`, OutputChannel | inline progress/toast | operation events |

