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
- Telegram 设置保存和热重载接线

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
- Telegram settings save + hot reload works
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
