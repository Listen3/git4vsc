# Git4VSC

面向 VS Code 的本机 Git 增强扩展，参考 JetBrains Git4Idea 与 VCS Log 的专业工作流、信息结构和交互逻辑进行原创实现。

## 当前进度

第一条垂直链路已经实现：

- 发现并打开本机 Git 仓库
- 读取 HEAD、branch、upstream、refs 和工作区状态
- 展示 staged、working tree、untracked 和 conflict 状态
- Stage、Unstage、Commit 和操作后自动刷新
- 按拓扑顺序分页读取 Commit Log
- 绘制支持 merge、octopus merge 和多 root 的提交图
- VS Code 原生 SCM、Activity Bar、TreeView、Command Palette 和 Diff 集成
- Git4Idea 风格的逐文件冲突列表、三方 Merge Editor、Accept Current/Incoming、Continue 和 Abort

Fetch、Pull、Push、冲突处理、Stash、Reset、Cherry-pick 和 Rebase 将按垂直链路继续实现。

## 工程结构

```text
packages/
  shared-types/   共享领域类型
  git-core/       Git CLI、状态与日志解析
  git-graph/      提交图布局和几何计算
  repo-state/     每仓库独立状态、缓存与操作队列
  ui/             共享 React UI

apps/
  vscode-extension/
```

## 开发

环境要求：Node.js 20+、pnpm 11+、Git 2.23+。

```bash
pnpm install
pnpm check
```

单独运行 VS Code Extension Host 测试：

```bash
pnpm test:extension
```

## 文档

- [总体架构](docs/architecture.md)
- [JetBrains Git/VCS Log 源码调研](docs/research/jetbrains-git-architecture.md)
- [VS Code 平台能力](docs/research/vscode-extension-capabilities.md)
- [功能对照矩阵](docs/research/feature-parity-matrix.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

本项目不复制 JetBrains 商标、名称、图标或专有素材。当前提交图与应用代码均为原创实现。
