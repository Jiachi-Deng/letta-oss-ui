# Letta Desktop Testing Guide

## 1. 这份文档现在最重要的变化

这份测试手册已经不再只针对“桌面窗口聊天”。

当前至少要把下面 4 条链路分开看：

1. desktop app 内聊天
2. channels host -> Resident Core -> runtime（当前配置边界已经是 channels-first，Telegram 是第一个实现）
3. CodeIsland 拉起
4. 打包 / 首装链路

当前 `lettabot` channel factory 已经是 lazy import 形态，所以如果这层回归，优先看：

- vendor factory 动态导入是否仍能解析
- app 侧直接调用点是否还在 `await createChannelsForAgent(...)`

## 2. 现在的基本原则

### 2.1 不要只测 UI

如果你只看到桌面聊天正常，不代表：

- Resident Core 正常
- channels host 正常
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

### 3.2 Channels / Telegram 路径

至少验：

1. bot 能收到消息
2. 第一条消息能回
3. 连续多条消息时不会明显卡死
4. 保存设置后 channels host 能按新配置继续工作
5. 快速连续保存设置时不会并发重载同一条 channels runtime
6. reload 失败后旧 host 能回滚，或者至少明确进入 channels offline，而不是把 desktop 核心一起打挂

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
- packaged/release runner 的真实凭据优先走：
  - `/Users/jachi/Desktop/letta-workspace/release-config.local.json`
  - 或 `LETTA_RELEASE_CONFIG_PATH`

## 4. 常用自动化测试命令

### app

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run test:run
bun run typecheck:electron
bun run verify:resident-core
bun run build:letta-server:telegram-lite
bun run release:check:telegram-lite
bun run evals:desktop-renderer -- --case example-desktop-first-message-failure
```

`verify:resident-core` 会覆盖 Resident Core 相关 Electron 测试，包括 `resident-core-session-backend`、`resident-core`、`runtime-host`、`safety`、`session-owner`、`session-store`、channels host、main runtime、IPC 和设置保存链路。

如果改动触到 channels runtime reload / rollback / bot session invalidation，至少补跑：

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run test:run -- src/electron/main.test.ts src/electron/libs/main-runtime.test.ts src/electron/libs/resident-core/resident-core-session-backend.test.ts src/electron/libs/resident-core/session-owner.test.ts
```

如果改动触到 app 侧 channels config/onboarding 边界，至少补跑：

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run test:run -- src/electron/libs/config.test.ts src/electron/libs/main-runtime.test.ts src/electron/main.test.ts src/ui/components/OnboardingModal.test.tsx src/electron/libs/resident-core/lettabot-host.test.ts
bun run typecheck:electron
```

如果改动触到 vendored channel factory / adapter 装配，至少补跑：

```bash
cd /Users/jachi/Desktop/letta-workspace/vendor/lettabot
bun run build
bunx tsc --noEmit

cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run test:run -- src/electron/libs/resident-core/lettabot-host.test.ts src/electron/libs/main-runtime.test.ts
bun run typecheck:electron
```

如果改动触到打包、瘦身或发布检查，至少补跑：

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run test:run -- scripts/lib/build-letta-server.test.ts scripts/lib/release-check.test.ts
bun run build:letta-server:telegram-lite
bun run release:check:telegram-lite
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
