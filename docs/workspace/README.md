# Letta Workspace 新手操作指南

这是 workspace 根目录 `README.md` 的 repo-managed 副本。

如果你在 `app/letta-desktop` 里工作，优先看这份。

## 1. 先用一句话理解现在的项目

这个项目现在是一个桌面产品工作区，不只是一个单独的 Electron UI。

核心层包括：

1. `app/letta-desktop`
   - desktop UI / 设置 / 诊断 / 打包
2. `Resident Core`
   - 持有 session / runtime / channels host
3. `vendor/letta-monorepo`
   - Letta Python server
4. `vendor/letta-code` + `vendor/letta-code-sdk`
   - runtime / SDK
5. `vendor/lettabot`
   - Telegram 和其他 IM 渠道层
6. `vendor/code-island`
   - companion app

## 2. 工作入口

- Workspace root:
  - `/Users/jachi/Desktop/letta-workspace`
- Main product repo:
  - `/Users/jachi/Desktop/letta-workspace/app/letta-desktop`

## 3. 对 app repo 来说，最重要的理解

`app/letta-desktop` 现在负责：

- Electron
- React UI
- diagnostics
- settings / onboarding
- Resident Core wiring
- bundled Letta server startup
- bundled CodeIsland startup
- channels runtime 设置保存和热重载接线（Telegram 是当前第一个实现）

大多数产品行为问题，先从这里开始看。

## 4. 什么时候要去别的 repo

- `vendor/letta-monorepo`
  - Python Letta server / provider / API backend
- `vendor/letta-code`
  - runtime / tools / skills / MCP
- `vendor/letta-code-sdk`
  - SDK transport / create-resume glue
- `vendor/lettabot`
  - Telegram / Discord / Slack / Signal / WhatsApp 等渠道层
- `vendor/code-island`
  - companion app 本体

## 5. 常用脚本

在 workspace 根目录运行：

```bash
./scripts/doctor.sh
./scripts/repo-status.sh
./scripts/dev.sh
./scripts/release-pipeline.sh
./scripts/build-release.sh
./scripts/verify-release.sh
./scripts/retest-first-install.sh
```

## 6. 当前测试口径

现在不要只盯 desktop UI。

至少有这些测试面：

1. desktop app 内聊天
2. Telegram -> Resident Core -> runtime
3. CodeIsland 拉起
4. packaging / release

如果是 packaged / 首装问题，先读：

- `/Users/jachi/Desktop/letta-workspace/docs/packaging-playbook.md`

真实 release/eval 凭据优先放：

- `/Users/jachi/Desktop/letta-workspace/release-config.local.json`
- 或 `LETTA_RELEASE_CONFIG_PATH=/absolute/path/to/release-config.json`

常用命令：

```bash
# app
bunx vitest run
bunx tsc --project src/electron/tsconfig.json --noEmit

# vendored lettabot
cd /Users/jachi/Desktop/letta-workspace/vendor/lettabot
bunx vitest run
bunx tsc --noEmit
bun run build
```

如果你在 `app/letta-desktop` repo 里做 packaged 验收，再补一条：

```bash
bun run release:check
```

## 7. Telegram 配置

当前产品路径里：

- 优先使用 desktop 设置页里保存的配置
- env 仅用于开发 fallback

保存设置后，channels host 会热重载，不必重启整个 app。

## 8. 推荐继续阅读

- `/Users/jachi/Desktop/letta-workspace/docs/current-state.md`
- `/Users/jachi/Desktop/letta-workspace/docs/repo-ownership.md`
- `/Users/jachi/Desktop/letta-workspace/docs/update-playbook.md`
- `/Users/jachi/Desktop/letta-workspace/docs/observability.md`
- `/Users/jachi/Desktop/letta-workspace/docs/llm-triage-playbook.md`
- `/Users/jachi/Desktop/letta-workspace/app/letta-desktop/docs/workspace/testing-guide.md`
