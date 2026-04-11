# Current State

这份文档是当前 workspace 状态的 repo-managed 副本。

## Main app repo

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

当前这里负责：

- desktop UI
- diagnostics
- Resident Core wiring
- Letta server startup glue
- CodeIsland startup glue
- channels runtime 设置保存和热重载接线（Telegram 是当前第一个实现）
- app-side config/onboarding/protocol 边界已经按 `residentCore.channels` 建模，Telegram 是当前唯一已实现渠道
- vendored `lettabot` channel factory 已改成 lazy adapter loading，当前先作为降低静态耦合的一步，不是完整插件系统

## Current surrounding repos

- `vendor/letta-monorepo`
  - Python Letta server
- `vendor/letta-code`
  - runtime
- `vendor/letta-code-sdk`
  - SDK
- `vendor/lettabot`
  - Telegram / IM channel layer
- `vendor/code-island`
  - companion app

## What is validated right now

- desktop chat works on current Resident Core path
- Telegram chat works through Resident Core + vendored lettabot
- CodeIsland dev launch works
- channels runtime settings save + hot reload works with rollback-safe runtime swaps
- stale channel backends are now fenced by runtime generation guards before they can invalidate the active bot session
- desktop session.start no longer advertises a fake `allowedTools` contract; real desktop policy is still pending
- Resident Core bot/Telegram traces now flow into the shared projection store and control-plane broadcasts
- `app/letta-desktop` full vitest suite passes
- `vendor/lettabot` full vitest suite passes

## Current direction

当前方向不是回到旧的 desktop-only runtime。

当前方向是继续沿着：

- desktop = 控制台
- Resident Core = session/runtime owner
- lettabot = 渠道层
- CodeIsland = companion layer

这条架构往前走。

## Observability

当前已经有 desktop-centric 的可观测性雏形，正式规范见：

- `/Users/jachi/Desktop/letta-workspace/docs/observability.md`
- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/docs/workspace/observability.md`
- `/Users/jachi/Desktop/letta-workspace/docs/llm-triage-playbook.md`

排障时优先看：

- `traceId`
- `decisionId`
- `errorCode`
- `Copy diagnostics`
