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

默认桌面发布包现在走显式的 `telegram-lite` 打包 profile。`LettaServer` 的瘦身规则必须写在 [build-letta-server.mjs](/Users/jachi/Desktop/letta-workspace/app/letta-desktop/scripts/build-letta-server.mjs) 里，不能靠手工删某次 `.app` 产物维持。

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

app 侧配置边界现在按 `residentCore.channels` 建模。Telegram 仍然是当前第一个已落地渠道，但 settings/onboarding/runtime wiring 不再把 app 配置形状写死成 `residentCore.telegram`。
vendored `lettabot` 的 channel factory 现在也已经改成懒加载 adapter 模块，减少了 app 当前产品路径对未启用渠道的静态耦合，但还没有做完整插件化。

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
bun run build:letta-server:telegram-lite
bun run release:check:telegram-lite
bun run evals:desktop-renderer
```

默认 arm64 发布路径：

```bash
bun run dist:mac-arm64:telegram-lite
```

当前 `evals:desktop-renderer` 默认会覆盖：

- 首条消息
- 多轮聊天
- 多类工具调用
- 设置页校验错误提示
