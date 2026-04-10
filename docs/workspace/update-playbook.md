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
bunx vitest run
bunx tsc --project src/electron/tsconfig.json --noEmit

# lettabot
cd /Users/jachi/Desktop/letta-workspace/vendor/lettabot
bunx vitest run
bunx tsc --noEmit
bun run build
```
