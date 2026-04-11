# Letta Desktop Testing Guide

## 1. 这份文档现在最重要的变化

这份测试手册已经不再只针对“桌面窗口聊天”。

当前至少要把下面 4 条链路分开看：

1. desktop app 内聊天
2. Telegram -> Resident Core -> runtime
3. CodeIsland 拉起
4. 打包 / 首装链路

## 2. 现在的基本原则

### 2.1 不要只测 UI

如果你只看到桌面聊天正常，不代表：

- Resident Core 正常
- Telegram 正常
- CodeIsland 正常

### 2.2 Resident Core 问题和 UI 问题不要混着讲

当前架构里：

- desktop 是控制台
- Resident Core 才是 runtime owner

所以测试时要区分：

- 是“UI 显示不对”
- 还是“session/runtime 真没跑”

### 2.3 先看诊断，再讲故事

如果界面里有 `Copy diagnostics`，先点它。

更完整的排障口径见：

- `/Users/jachi/Desktop/letta-workspace/docs/observability.md`
- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/docs/workspace/observability.md`
- `/Users/jachi/Desktop/letta-workspace/docs/llm-triage-playbook.md`

## 3. 每轮最少要验什么

### 3.1 Desktop 路径

至少验：

1. 第一条消息就能回复
2. 连续多轮聊天正常
3. 至少一次工具调用正常
4. 设置页可打开、可关闭、可保存

### 3.2 Telegram 路径

至少验：

1. bot 能收到消息
2. 第一条消息能回
3. 连续多条消息时不会明显卡死
4. 保存设置后 Telegram host 能按新配置继续工作

### 3.3 CodeIsland 路径

至少验：

1. 开发态 app 启动时会自动尝试拉起 CodeIsland
2. 如果失败，必须至少有明确日志或诊断，而不是静默消失

### 3.4 打包 / 首装路径

至少验：

1. `release-pipeline.sh` 跑通，或至少 `verify-release.sh` 通过
2. `Bundle Smoke` 通过
3. packaged desktop renderer 回归组通过
4. DMG 或 ZIP 任选一条首装链通过
5. 如果是 packaged bug，先读：
   - `/Users/jachi/Desktop/letta-workspace/docs/packaging-playbook.md`

注意：

- 不要把 `dist/mac-arm64/Letta.app` 的直接启动结果，当成最终发布结论
- 真正要认的是 `/Applications/Letta.app` 这条链

## 4. 常用自动化测试命令

### app

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bunx vitest run
bunx tsc --project src/electron/tsconfig.json --noEmit
bun run evals:desktop-renderer -- --case example-desktop-first-message-failure
```

### vendored lettabot

```bash
cd /Users/jachi/Desktop/letta-workspace/vendor/lettabot
bunx vitest run
bunx tsc --noEmit
bun run build
```

## 5. 真机联调时要记录什么

- 测的是 desktop 还是 Telegram
- 是第一条消息失败，还是多轮失败
- 是否涉及工具调用
- CodeIsland 是否有拉起
- 是否改过 Telegram 设置
- diagnostics / trace 信息

## 6. 当前最典型的回归类型

1. desktop 第一条消息竞态
2. desktop 多轮 session 复用问题
3. CodeIsland 开发态路径解析问题
4. Telegram shared 模式大量快发时的排队体感问题
5. 文档和测试口径没跟上 Resident Core 架构变化
