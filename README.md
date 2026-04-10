# Letta Desktop

这是当前 Letta 桌面产品的主 repo。

它已经不再只是一个“示例 UI”。

当前这个 fork 负责：

- Electron desktop app
- React UI
- settings / diagnostics
- Resident Core wiring
- bundled Letta server startup
- bundled CodeIsland startup
- Telegram 配置保存和热重载接线

## Local architecture

当前主链可以简化理解成：

```text
Desktop UI
-> Resident Core
-> letta-code-sdk
-> letta-code runtime
-> local Letta Python server
```

Telegram 则通过 vendored `lettabot` 接到同一个核心路径。

## Workspace assumption

这个 repo 按下面这个 workspace 布局工作：

- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`
- `/Users/jachi/Desktop/letta-workspace/vendor/letta-monorepo`
- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code`
- `/Users/jachi/Desktop/letta-workspace/vendor/letta-code-sdk`
- `/Users/jachi/Desktop/letta-workspace/vendor/lettabot`
- `/Users/jachi/Desktop/letta-workspace/vendor/code-island`

## Development

```bash
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run dev
```

## Tests

```bash
bunx vitest run
bunx tsc --project src/electron/tsconfig.json --noEmit
```

如果改动涉及 Telegram / IM 渠道层，也要继续跑：

```bash
cd /Users/jachi/Desktop/letta-workspace/vendor/lettabot
bunx vitest run
bunx tsc --noEmit
bun run build
```

Observability design note:

- `/Users/jachi/Desktop/letta-workspace/docs/observability.md`
- `/Users/jachi/Desktop/letta-workspace/docs/llm-triage-playbook.md`

## Release verification

从 workspace 根目录运行：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/build-release.sh
./scripts/verify-release.sh
```
