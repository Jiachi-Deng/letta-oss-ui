# Update Playbook

## Daily development

1. 从 workspace 根目录开始
2. 跑：
   - `./scripts/doctor.sh`
   - `./scripts/repo-status.sh`
3. 默认先在 `app/letta-desktop` 工作

## When this repo should change

改 `app/letta-desktop`，如果问题属于：

- UI
- Electron
- diagnostics
- settings / onboarding
- Resident Core wiring
- startup orchestration
- packaging

## When another repo should change

- `vendor/letta-monorepo`
  - Python server / provider / API backend
- `vendor/letta-code`
  - runtime / tools / skills / MCP
- `vendor/letta-code-sdk`
  - SDK transport / runtime glue
- `vendor/lettabot`
  - Telegram / 其他 IM 渠道层
- `vendor/code-island`
  - companion app

## Required verification after cross-repo changes

```bash
# app
cd /Users/jachi/Desktop/letta-workspace/app/letta-desktop
bun run test:run
bun run typecheck:electron
bun run verify:resident-core

# lettabot
cd /Users/jachi/Desktop/letta-workspace/vendor/lettabot
bunx vitest run
bunx tsc --noEmit
bun run build
```

`verify:resident-core` 覆盖完整 Resident Core 切片：session backend、service、runtime host、safety、session owner/store、channels host、main runtime、IPC 和设置保存链路。
