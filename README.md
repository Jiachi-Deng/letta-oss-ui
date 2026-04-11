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
- channels runtime 配置保存和热重载接线

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

channels runtime reload 现在遵循：

- 共享 reload mutex，避免并发重载
- `stop old -> cleanup -> start new -> commit globals`
- reload 失败时优先回滚旧 host；回滚失败则 channels 进入 offline
- bot session invalidation 带 runtime generation guard，旧 host 的失效回调不会误清当前 host 的 bot session

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
bun run test:run
bun run typecheck:electron
```

如果改动涉及 Resident Core / channels runtime 接线，先跑完整 Resident Core 切片：

```bash
bun run verify:resident-core
```

如果改动涉及 vendored lettabot 或 IM 渠道层，也要继续跑：

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

更推荐的完整路径是：

```bash
cd /Users/jachi/Desktop/letta-workspace
./scripts/release-pipeline.sh
```

如果任务涉及 DMG / ZIP / `/Applications/Letta.app` 真机首装，再先读：

- `/Users/jachi/Desktop/letta-workspace/docs/packaging-playbook.md`

真实 release/eval 凭据优先放：

- `/Users/jachi/Desktop/letta-workspace/release-config.local.json`
- 或 `LETTA_RELEASE_CONFIG_PATH=/absolute/path/to/release-config.json`

仓库模板：

- `/Users/jachi/Desktop/letta-workspace/release-config.example.json`

如果你已经在 app repo 里，手工补跑：

```bash
bun run release:check
bun run evals:desktop-renderer
```

当前 `evals:desktop-renderer` 默认会覆盖：

- 首条消息
- 多轮聊天
- 多类工具调用
- 设置页校验错误提示
